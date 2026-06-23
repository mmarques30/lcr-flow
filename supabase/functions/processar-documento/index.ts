// Edge Function: processar-documento (TO-BE 23/06)
// Pipeline: lê o PDF/imagem do storage → classifica com Claude Sonnet 4.6 →
// cria os lançamentos contábeis sugeridos no banco.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string) => json(200, { ok: false, error });

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `Você é o classificador de documentos contábeis da LCR Contadores.
Analise o documento enviado por um cliente e:
1. Identifique o TIPO entre: 'extrato_bancario', 'nfe_servico', 'nfe_produto', 'planilha_financeira', 'darf', 'guia_inss_fgts', 'recibo', 'fatura', 'comprovante', 'outro'.
2. Extraia os dados estruturados relevantes (resumo no campo dados_extraidos).
3. Sugira os LANÇAMENTOS contábeis correspondentes.

Regras:
- Use EXCLUSIVAMENTE códigos de conta e de histórico que existem no plano de contas e na lista de históricos passados no contexto (contas analíticas/folhas).
- Extrato bancário: cada movimentação vira um lançamento.
- NF-e: separe receita do serviço e retenções de impostos em lançamentos distintos.
- Planilha financeira: cada linha pode virar 1+ lançamentos.
- DARF/GPS: 1 lançamento de despesa tributária. Recibo: 1 lançamento de despesa operacional.
- valor sempre positivo. data_lancamento em AAAA-MM-DD. competencia em AAAA-MM.
- Se não tiver certeza da conta, use a conta do grupo correto mais próxima e marque confidence < 0.7.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo_documento: { type: "string" },
    cliente_identificado: { type: "string" },
    competencia: { type: "string", description: "AAAA-MM" },
    confidence_geral: { type: "number" },
    dados_extraidos: { type: "string", description: "Resumo/JSON dos dados extraídos" },
    lancamentos_sugeridos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          data_lancamento: { type: "string" },
          valor: { type: "number" },
          tipo_movimento: { type: "string", description: "debito ou credito" },
          conta_codigo: { type: "string" },
          historico_codigo: { type: "string" },
          descricao: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["data_lancamento", "valor", "conta_codigo", "descricao"],
      },
    },
    observacoes: { type: "string" },
  },
  required: ["tipo_documento", "lancamentos_sugeridos"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const IMG: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const TEXTUAL = new Set(["xml", "csv", "txt", "json", "ofx"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("Secret ANTHROPIC_API_KEY não configurado.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  let body: { documento_id?: string };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const documento_id = body.documento_id;
  if (!documento_id) return fail("documento_id obrigatório");

  const { data: doc, error: docErr } = await admin
    .from("documentos")
    .select("id, empresa_id, tipo, competencia, arquivo_url, arquivo_nome, storage_path, empresa:empresas(razao_social, cnpj)")
    .eq("id", documento_id)
    .maybeSingle();
  if (docErr) return fail(docErr.message);
  if (!doc) return fail("Documento não encontrado");

  const empresa = doc.empresa as { razao_social?: string; cnpj?: string } | null;
  await admin.from("documentos").update({ status_processamento: "processando" }).eq("id", documento_id);

  const markErro = async (msg: string) => {
    await admin.from("documentos").update({ status_processamento: "erro", classificacao_ia: { error: msg } }).eq("id", documento_id);
    return fail(msg);
  };

  // baixa o arquivo: prefere storage_path (bucket documentos-clientes), senão arquivo_url (bucket documentos)
  const bucket = doc.storage_path ? "documentos-clientes" : "documentos";
  const path = doc.storage_path ?? doc.arquivo_url;
  if (!path) return markErro("Documento sem arquivo para processar.");
  const { data: file, error: dlErr } = await admin.storage.from(bucket).download(path);
  if (dlErr || !file) return markErro(dlErr?.message ?? "Falha ao baixar o arquivo.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (doc.arquivo_nome ?? path).split(".").pop()?.toLowerCase() ?? "";

  let contentBlock: Record<string, unknown>;
  if (ext === "pdf") contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } };
  else if (IMG[ext]) contentBlock = { type: "image", source: { type: "base64", media_type: IMG[ext], data: toBase64(bytes) } };
  else if (TEXTUAL.has(ext)) contentBlock = { type: "text", text: `Conteúdo do arquivo (${ext}):\n\n${new TextDecoder().decode(bytes).slice(0, 100_000)}` };
  else return markErro(`Tipo .${ext} não suportado (use PDF, imagem ou XML/CSV).`);

  // contexto: plano de contas + históricos
  const [{ data: contas }, { data: historicos }] = await Promise.all([
    admin.from("plano_contas").select("codigo, descricao, tipo").eq("ativo", true).range(0, 4999),
    admin.from("historicos_contabeis").select("codigo, descricao").range(0, 1999),
  ]);
  const ctx =
    `Plano de contas (${(contas ?? []).length}):\n${(contas ?? []).map((c) => `${c.codigo} | ${c.descricao} | ${c.tipo}`).join("\n")}\n\n` +
    `Históricos (${(historicos ?? []).length}):\n${(historicos ?? []).map((h) => `${h.codigo} | ${h.descricao}`).join("\n")}`;

  let classificacao: {
    tipo_documento: string; competencia?: string; confidence_geral?: number;
    dados_extraidos?: string; observacoes?: string;
    lancamentos_sugeridos: { data_lancamento: string; valor: number; tipo_movimento?: string; conta_codigo: string; historico_codigo?: string; descricao: string; confidence?: number }[];
  };
  try {
    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            contentBlock,
            { type: "text", text: `Empresa atual: ${empresa?.razao_social ?? "?"} (CNPJ ${empresa?.cnpj ?? "?"}).\n\n${ctx}\n\nClassifique este documento e sugira os lançamentos.` },
          ],
        }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    if (!apiResp.ok) return markErro(`Claude API ${apiResp.status}: ${(await apiResp.text()).slice(0, 400)}`);
    const dataApi = await apiResp.json();
    if (dataApi.stop_reason === "refusal") return markErro("A IA recusou processar este documento.");
    const tb = (dataApi.content ?? []).find((b: { type: string }) => b.type === "text");
    classificacao = JSON.parse(tb?.text ?? "{}");
  } catch (e) {
    return markErro(`Falha na Claude API: ${e instanceof Error ? e.message : String(e)}`);
  }

  const competencia = (classificacao.competencia && /^\d{4}-\d{2}$/.test(classificacao.competencia))
    ? classificacao.competencia
    : (doc.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

  // resolve contas e históricos por código (em lote)
  const contaCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.conta_codigo).filter(Boolean))];
  const histCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.historico_codigo).filter(Boolean) as string[])];
  const [{ data: contaRows }, { data: histRows }] = await Promise.all([
    contaCods.length ? admin.from("plano_contas").select("id, codigo").in("codigo", contaCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
    histCods.length ? admin.from("historicos_contabeis").select("id, codigo").in("codigo", histCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
  ]);
  const contaId = new Map((contaRows ?? []).map((c) => [c.codigo, c.id]));
  const histId = new Map((histRows ?? []).map((h) => [h.codigo, h.id]));

  const rows = (classificacao.lancamentos_sugeridos ?? []).map((s) => ({
    empresa_id: doc.empresa_id,
    conta_id: contaId.get(s.conta_codigo) ?? null,
    historico_id: s.historico_codigo ? (histId.get(s.historico_codigo) ?? null) : null,
    data_lancamento: /^\d{4}-\d{2}-\d{2}$/.test(s.data_lancamento) ? s.data_lancamento : null,
    valor: Math.abs(Number(s.valor) || 0),
    descricao: (s.descricao ?? "").slice(0, 200),
    competencia,
    status: "gerada" as const,
    confidence: typeof s.confidence === "number" ? s.confidence : null,
    documento_id,
  }));

  let lancCriados = 0;
  if (rows.length) {
    const { error: insErr, count } = await admin.from("lancamentos").insert(rows, { count: "exact" });
    if (insErr) return markErro(`Falha ao inserir lançamentos: ${insErr.message}`);
    lancCriados = count ?? rows.length;
  }

  await admin.from("documentos").update({
    status: "processado",
    status_processamento: "classificado",
    classificacao_ia: classificacao,
    dados_extraidos: classificacao,
    processado_em: new Date().toISOString(),
    lancamentos_gerados: lancCriados,
  }).eq("id", documento_id);

  return json(200, { ok: true, lancamentos_gerados: lancCriados, classificacao });
});

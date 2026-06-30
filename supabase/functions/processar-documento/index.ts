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

// Haiku 4.5: limite de tokens/min bem maior que o Sonnet no mesmo tier (evita o
// rate_limit_error de 10k tokens/min) + mais barato e rápido p/ classificar docs.
const MODEL = "claude-haiku-4-5";

// Subconjunto curado de contas/históricos enviado como contexto (em vez das 1187
// contas + 559 históricos) p/ caber no limite de 10k tokens input/min. Fonte:
// Mapa de Transações Típicas + bancos + impostos/despesas/receitas comuns
// (docs/contas-curadas-ia.json no repo da automação). Conta rara fora da lista →
// a IA marca confidence<0.7 e o item vai p/ revisão humana no front.
const CONTAS_IA = ["7","8","9","10","15","16","17","18","19","20","29","32","33","34","35","37","38","39","40","41","43","44","45","46","47","48","49","50","51","69","70","71","72","75","76","77","84","146","147","148","149","150","160","161","162","163","167","169","171","172","173","176","177","178","179","180","181","184","185","187","188","189","190","191","194","195","196","197","200","201","202","203","211","213","216","277","278","279","280","283","284","285","293","322","334","387","417","420","421","422","424","426","427","428","429","432","434","435","440","442","448","456","457","459","460","465","467","468","469","470","471","473","475","476","481","497","498","523","536","555","565","572","575","578","579","580","606","608","614","628","629","631","648","649","650","651","657","658","659","672","673","676","678","696","697","698","699","702","704","707","717","721","724","726","738","739","741","748","749","750","751","752","755","756","766","767","768","775","777","779","780","784","794","795","796","797","809","821","823","839","859","865","883","889","892","893","896","898","899","900","901","902","903","906","907","908","910","925","926","932","933","946","949","952","962","968","1010","1013","1025","1027","1030","1031","1042","1044","1060","1061","1062","1070","1073","1075","1076","1085","1095","1107","1121","1129","1130","1150","1151","1165","1175","1181","1185","1189","1194","1195","1243","1268","1290","1304","1341","1342","1347","1348","1349","1350","1357","1358"];
const HIST_IA = ["7","159","267","297","317","427","437","442","447","478","497","811","1001","1643","1767","1961","2003","2020","2054","2089","2178","2216","2283","2321","2330","2569","2623","2801","2844","2925","3671","3672","3673","3677","3678","3679","3682","3683","3685","3686","3687","3688","3689","3690","3692","3693","3694","3699","3700","3702","3707","3710","3719","3733","3746","9999"];

const SYSTEM_PROMPT = `Você é o classificador de documentos contábeis da LCR Contadores.
Analise o documento enviado por um cliente e:
1. Identifique o TIPO entre: 'extrato_bancario', 'nfe_servico', 'nfe_produto', 'planilha_financeira', 'darf', 'guia_inss_fgts', 'recibo', 'fatura', 'comprovante', 'outro'.
   * 'extrato_bancario' = EXTRATO de CONTA CORRENTE bancária com saldo inicial,
     movimentações cronológicas do período (entradas E saídas) e saldo final.
     É um documento contínuo emitido pelo banco que serve de fonte para
     conciliar TODA a movimentação do mês.
   * 'planilha_financeira' = posição consolidada de investimentos (CDB, renda
     fixa, poupança), extratos de aplicações financeiras, fluxos de caixa em
     planilha. NÃO confundir com extrato bancário.
   * 'comprovante' = comprovantes avulsos de pagamento/transferência (1 PIX,
     1 TED, 1 DOC), ainda que agrupados num PDF — são apenas a prova de uma
     operação, NÃO substituem o extrato bancário.
2. Extraia os dados estruturados relevantes (resumo no campo dados_extraidos).
3. Sugira os LANÇAMENTOS contábeis correspondentes.

Regras:
- Use EXCLUSIVAMENTE códigos de conta e de histórico que existem no plano de contas e na lista de históricos passados no contexto (contas analíticas/folhas).
- Extrato bancário: cada movimentação vira um lançamento.
- NF-e: separe receita do serviço e retenções de impostos em lançamentos distintos.
- Planilha financeira: cada linha pode virar 1+ lançamentos.
- DARF/GPS: 1 lançamento de despesa tributária. Recibo: 1 lançamento de despesa operacional.
- valor sempre positivo. data_lancamento em AAAA-MM-DD. competencia em AAAA-MM.
- Se não tiver certeza da conta, use a conta do grupo correto mais próxima e marque confidence < 0.7.
- IMPORTANTE — tipo_movimento (perspectiva do BANCO no extrato): preencha SEMPRE
  com 'debito' (banco debitou = saída de dinheiro: pagamentos, transferências
  enviadas, tarifas, taxas) ou 'credito' (banco creditou = entrada de dinheiro:
  recebimentos, depósitos, rendimentos). Para NF/recibo/DARF que ainda não
  refletem no banco: use 'debito' para despesas/saídas previstas e 'credito'
  para receitas/entradas previstas. Esse campo determina a inversão D/C
  contábil — é crítico que esteja sempre preenchido.`;

// Mapeia o tipo_documento que a IA retorna (texto livre) para o ENUM
// documento_tipo do banco. Reconhece sinônimos comuns.
// Mapeamento conservador: só promove para 'extrato' quando a IA diz
// explicitamente extrato bancário/movimento bancário. Comprovantes,
// transferências avulsas e posição consolidada de investimentos NÃO viram
// extrato — são tipos distintos (outros/planilha_financeira).
const TIPO_ALIAS: Record<string, string | null> = {
  extrato: "extrato",
  extrato_bancario: "extrato",
  extrato_consolidado: "extrato",
  movimento_bancario: "extrato",
  // posição/aplicações financeiras → planilha
  posicao_consolidada: "planilha_financeira",
  posicao_investimentos: "planilha_financeira",
  planilha_financeira: "planilha_financeira",
  planilha: "planilha_financeira",
  fluxo_caixa: "planilha_financeira",
  // comprovantes avulsos → outros (não há enum 'comprovante')
  comprovante: "outros",
  comprovantes: "outros",
  comprovante_bancario: "outros",
  transferencia: "outros",
  transferencias: "outros",
  darf: "darf",
  guia_inss_fgts: "darf",
  gps: "darf",
  guia: "darf",
  recibo: "recibo",
  recibo_pagamento: "recibo",
  fatura: "fatura_cartao",
  fatura_cartao: "fatura_cartao",
  movimento_contabil: "movimento_contabil",
  // NFs: deixa como null = preserva o tipo cadastrado no upload (nf_entrada
  // vs nf_saida depende do papel do cliente, a IA não tem como decidir).
  nfe_servico: null,
  nfe_produto: null,
  nf_entrada: "nf_entrada",
  nf_saida: "nf_saida",
  outro: "outros",
  outros: "outros",
};

function mapearTipoIa(tipo: string | undefined | null): string | null {
  if (!tipo) return null;
  const k = tipo.toLowerCase().replace(/[\s-]+/g, "_");
  if (k in TIPO_ALIAS) return TIPO_ALIAS[k];
  // Heurística de fallback por substring (mais conservadora: comprovante
  // vira "outros", não "extrato").
  if (k.includes("extrato") || k.includes("movimento_banc")) return "extrato";
  if (k.includes("posicao") || k.includes("aplicacao") || k.includes("investimento")) return "planilha_financeira";
  if (k.includes("planilha") || k.includes("fluxo")) return "planilha_financeira";
  if (k.includes("comprovante") || k.includes("transferencia")) return "outros";
  if (k.includes("darf") || k.includes("gps") || k.includes("guia")) return "darf";
  if (k.includes("recibo")) return "recibo";
  if (k.includes("fatura")) return "fatura_cartao";
  return null;
}

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
          tipo_movimento: { type: "string", description: "'debito' = saída de dinheiro do banco (pagamento, transferência enviada); 'credito' = entrada (recebimento, depósito). SEMPRE preencher." },
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

  // Sobe o arquivo pro bucket de conciliações e vincula como extrato_csv_url.
  // Chamado quando confirmado (pelo upload OU pela IA) que o documento é
  // EXTRATO BANCÁRIO. Não cria lançamentos aqui — isso acontece no pós-IA.
  async function uploadExtratoBucket(competenciaExtrato: string): Promise<string | null> {
    const safeName = (doc.arquivo_nome ?? "extrato").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const concPath = `${doc.empresa_id}/${competenciaExtrato}/extrato-${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await admin.storage.from("conciliacoes").upload(concPath, bytes, { upsert: false, cacheControl: "3600", contentType: file.type || "text/csv" });
    if (upErr) { await markErro(`Falha ao vincular extrato à conciliação: ${upErr.message}`); return null; }

    const { data: existente } = await admin.from("conciliacoes").select("id").eq("empresa_id", doc.empresa_id).eq("competencia", competenciaExtrato).maybeSingle();
    if (existente) {
      await admin.from("conciliacoes").update({ extrato_csv_url: concPath, status: "em_andamento" }).eq("id", existente.id);
    } else {
      await admin.from("conciliacoes").insert({ empresa_id: doc.empresa_id, competencia: competenciaExtrato, extrato_csv_url: concPath, status: "em_andamento" });
    }
    return concPath;
  }

  let contentBlock: Record<string, unknown>;
  if (ext === "pdf") contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } };
  else if (IMG[ext]) contentBlock = { type: "image", source: { type: "base64", media_type: IMG[ext], data: toBase64(bytes) } };
  else if (TEXTUAL.has(ext)) contentBlock = { type: "text", text: `Conteúdo do arquivo (${ext}):\n\n${new TextDecoder().decode(bytes).slice(0, 100_000)}` };
  else return markErro(`Tipo .${ext} não suportado (use PDF, imagem ou XML/CSV).`);

  // contexto: plano de contas + históricos
  const [{ data: contas }, { data: historicos }] = await Promise.all([
    admin.from("plano_contas").select("codigo, descricao, tipo").eq("ativo", true).in("codigo", CONTAS_IA),
    admin.from("historicos_contabeis").select("codigo, descricao").in("codigo", HIST_IA),
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
    const reqBody = JSON.stringify({
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
    });
    // Retry no 529 (overloaded) — sobrecarga transiente da Anthropic, backoff curto (10/20/30s).
    // O 429 (rate_limit) NÃO é retentado aqui: a espera de ~1min estouraria o timeout da edge;
    // quem chama (bridge_front.processar_documento_edge) reinvoca a edge após 65s.
    let apiResp: Response | undefined;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: reqBody,
      });
      if (apiResp.ok || apiResp.status !== 529) break;
      await new Promise((r) => setTimeout(r, 10000 * (tentativa + 1)));
    }
    if (!apiResp || !apiResp.ok) {
      return markErro(`Claude API ${apiResp?.status ?? "?"}: ${apiResp ? (await apiResp.text()).slice(0, 400) : "sem resposta"}`);
    }
    const dataApi = await apiResp.json();
    if (dataApi.stop_reason === "refusal") return markErro("A IA recusou processar este documento.");
    const tb = (dataApi.content ?? []).find((b: { type: string }) => b.type === "text");
    classificacao = JSON.parse(tb?.text ?? "{}");
  } catch (e) {
    return markErro(`Falha na Claude API: ${e instanceof Error ? e.message : String(e)}`);
  }

  const tipoMapeado = mapearTipoIa(classificacao.tipo_documento);
  const isExtrato = doc.tipo === "extrato" || tipoMapeado === "extrato";
  const tipoFinal = isExtrato ? "extrato" : (tipoMapeado && tipoMapeado !== doc.tipo ? tipoMapeado : doc.tipo);
  if (tipoFinal !== doc.tipo) {
    await admin.from("documentos").update({ tipo: tipoFinal }).eq("id", documento_id);
  }

  const competencia = (classificacao.competencia && /^\d{4}-\d{2}$/.test(classificacao.competencia))
    ? classificacao.competencia
    : (doc.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

  // ─────────────── DOC SUPORTE (NF/recibo/planilha/comprovante) ───────────────
  // Não gera lançamentos. Os dados extraídos serão usados para enriquecer as
  // linhas do extrato quando ele chegar.
  if (!isExtrato) {
    await admin.from("documentos").update({
      status: "processado",
      status_processamento: "classificado",
      classificacao_ia: classificacao,
      dados_extraidos: classificacao,
      processado_em: new Date().toISOString(),
      lancamentos_gerados: 0,
    }).eq("id", documento_id);

    admin.functions.invoke("enriquecer-extrato", { body: { empresa_id: doc.empresa_id, competencia } })
      .catch(() => { /* não-fatal */ });

    return json(200, { ok: true, documento_suporte: true, lancamentos_gerados: 0, classificacao });
  }

  // ───────────────── EXTRATO BANCÁRIO (fonte única de verdade) ──────────────
  const concPath = await uploadExtratoBucket(competencia);
  if (!concPath) return fail("Falha ao vincular extrato.");
  await admin.from("lancamentos").delete().eq("documento_id", documento_id);

  const contaCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.conta_codigo).filter(Boolean))];
  const histCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.historico_codigo).filter(Boolean) as string[])];
  const [{ data: contaRows }, { data: histRows }] = await Promise.all([
    contaCods.length ? admin.from("plano_contas").select("id, codigo").in("codigo", contaCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
    histCods.length ? admin.from("historicos_contabeis").select("id, codigo").in("codigo", histCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
  ]);
  const contaId = new Map((contaRows ?? []).map((c) => [c.codigo, c.id]));
  const histId = new Map((histRows ?? []).map((h) => [h.codigo, h.id]));

  function normMov(s?: string | null): string | null {
    if (!s) return null;
    const v = String(s).toLowerCase().trim();
    if (v.startsWith("d")) return "debito";
    if (v.startsWith("c")) return "credito";
    return null;
  }

  const rows = (classificacao.lancamentos_sugeridos ?? []).map((s) => ({
    empresa_id: doc.empresa_id,
    conta_id: contaId.get(s.conta_codigo) ?? null,
    historico_id: s.historico_codigo ? (histId.get(s.historico_codigo) ?? null) : null,
    data_lancamento: /^\d{4}-\d{2}-\d{2}$/.test(s.data_lancamento) ? s.data_lancamento : null,
    valor: Math.abs(Number(s.valor) || 0),
    descricao: (s.descricao ?? "").slice(0, 200),
    natureza_movimento: normMov(s.tipo_movimento),
    competencia,
    status: "gerada" as const,
    confidence: typeof s.confidence === "number" ? s.confidence : null,
    documento_id,
    fonte_extrato: true,
    enriquecido: false,
  }));

  let lancCriados = 0;
  if (rows.length) {
    const { error: insErr, count } = await admin.from("lancamentos").insert(rows, { count: "exact" });
    if (insErr) return markErro(`Falha ao inserir lançamentos do extrato: ${insErr.message}`);
    lancCriados = count ?? rows.length;
  }

  await admin.from("documentos").update({
    tipo: "extrato",
    status: "processado",
    status_processamento: "classificado",
    classificacao_ia: classificacao,
    dados_extraidos: classificacao,
    processado_em: new Date().toISOString(),
    lancamentos_gerados: lancCriados,
  }).eq("id", documento_id);

  admin.functions.invoke("enriquecer-extrato", { body: { empresa_id: doc.empresa_id, competencia } })
    .catch(() => { /* não-fatal */ });

  return json(200, {
    ok: true,
    extrato: true,
    extrato_csv_url: concPath,
    lancamentos_gerados: lancCriados,
    classificacao,
  });
});

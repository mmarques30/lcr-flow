// Edge Function: processar-documento
// Classifica e extrai dados de um documento (PDF/imagem/XML/CSV) com a Claude API.
// A chave vem do secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
// Usa fetch direto contra /v1/messages para controlar o shape exato (output_config).
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

// Schema da extração (json_schema — additionalProperties:false obrigatório)
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo_documento: { type: "string", description: "Ex.: nota fiscal, extrato bancário, DARF, fatura, recibo" },
    competencia: { type: "string", description: "Mês de referência no formato AAAA-MM, se identificável" },
    emitente: { type: "string" },
    cnpj_emitente: { type: "string" },
    destinatario: { type: "string" },
    numero_documento: { type: "string" },
    data_emissao: { type: "string", description: "AAAA-MM-DD se identificável" },
    valor_total: { type: "number" },
    moeda: { type: "string" },
    itens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { descricao: { type: "string" }, valor: { type: "number" } },
        required: ["descricao"],
      },
    },
    resumo: { type: "string", description: "Resumo do documento em uma frase" },
  },
  required: ["tipo_documento", "resumo"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const IMG: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const TEXTUAL = new Set(["xml", "csv", "txt", "json", "ofx"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("Secret ANTHROPIC_API_KEY não configurado no projeto.");

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // exige usuário autenticado
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
    .select("id, empresa_id, tipo, competencia, arquivo_url, arquivo_nome")
    .eq("id", documento_id)
    .maybeSingle();
  if (docErr) return fail(docErr.message);
  if (!doc) return fail("Documento não encontrado");
  if (!doc.arquivo_url) return fail("Documento sem arquivo para processar.");

  // baixa o arquivo do Storage
  const { data: file, error: dlErr } = await admin.storage.from("documentos").download(doc.arquivo_url);
  if (dlErr || !file) return fail(dlErr?.message ?? "Falha ao baixar o arquivo.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (doc.arquivo_nome ?? doc.arquivo_url).split(".").pop()?.toLowerCase() ?? "";

  // monta o bloco de conteúdo conforme o tipo de arquivo
  let contentBlock: Record<string, unknown>;
  if (ext === "pdf") {
    contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } };
  } else if (IMG[ext]) {
    contentBlock = { type: "image", source: { type: "base64", media_type: IMG[ext], data: toBase64(bytes) } };
  } else if (TEXTUAL.has(ext)) {
    const texto = new TextDecoder().decode(bytes).slice(0, 100_000);
    contentBlock = { type: "text", text: `Conteúdo do arquivo (${ext}):\n\n${texto}` };
  } else {
    return fail(`Tipo de arquivo .${ext} não suportado para extração por IA (use PDF, imagem ou XML/CSV).`);
  }

  // chama a Claude API (Messages) com JSON estrito via output_config.format
  let extraido: Record<string, unknown>;
  try {
    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system:
          "Você é um assistente contábil especializado em documentos fiscais e bancários brasileiros " +
          "(NF-e, NFS-e, extratos, DARF, faturas, recibos). Classifique o documento e extraia os campos " +
          "com precisão. Não invente valores: se um campo não estiver presente, omita-o.",
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: `Tipo informado pelo sistema: "${doc.tipo}". Classifique e extraia os dados deste documento.` },
            ],
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return fail(`Claude API ${apiResp.status}: ${errText.slice(0, 400)}`);
    }
    const data = await apiResp.json();
    if (data.stop_reason === "refusal") return fail("A IA recusou processar este documento.");
    const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === "text");
    extraido = JSON.parse(textBlock?.text ?? "{}");
  } catch (e) {
    return fail(`Falha na Claude API: ${e instanceof Error ? e.message : String(e)}`);
  }

  // grava o resultado e avança o status
  const { error: upErr } = await admin
    .from("documentos")
    .update({ dados_extraidos: extraido, status: "processado", processado_em: new Date().toISOString() })
    .eq("id", documento_id);
  if (upErr) return fail(upErr.message);

  return json(200, { ok: true, dados_extraidos: extraido });
});

// Edge Function: conciliar
// Motor de conciliação híbrido: pareia razão (SCI) x extrato bancário.
//   1) Regras: mesmo valor (centavos) + data próxima (±3 dias).
//   2) IA (Claude): tenta casar o que sobrou por descrição/valor aproximado.
// Grava o resultado em conciliacoes.resultado e atualiza status/divergências.
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

type Linha = { data: string | null; descricao: string; valor: number };

// ---- parsing helpers -------------------------------------------------
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseValor(s: string): number {
  if (!s) return NaN;
  let t = s.replace(/[R$\s]/gi, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const neg = /-/.test(t);
  t = t.replace(/-/g, "");
  if (t.includes(".") && t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const v = parseFloat(t);
  return isNaN(v) ? NaN : (neg ? -v : v);
}

function parseData(s: string, anoFallback: number): string | null {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    let ano = m[3]; if (ano.length === 2) ano = `20${ano}`;
    return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
  if (m) return `${anoFallback}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const idx = (header: string[], names: string[]) =>
  header.findIndex((h) => names.some((n) => h.includes(n)));

function parseCsv(texto: string, anoFallback: number): Linha[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return [];
  const delim = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitCsvLine(linhas[0], delim).map((h) => h.toLowerCase());
  const hasHeader = idx(head, ["data", "date", "dt"]) >= 0 || idx(head, ["valor", "value", "amount", "montante"]) >= 0;
  let ciData = 0, ciDesc = 1, ciValor = 2, ciCred = -1, ciDeb = -1, ciTipo = -1, start = 0;
  if (hasHeader) {
    ciData = idx(head, ["data", "date", "dt"]);
    // Prioriza coluna "descricao/descrição/description" sobre "historico_codigo" pra
    // não exibir códigos crípticos como descrição na UI.
    const ciDescricao = idx(head, ["descrição", "descricao", "description", "memo"]);
    const ciHistorico = idx(head, ["hist", "lançamento", "lancamento"]);
    ciDesc = ciDescricao >= 0 ? ciDescricao : ciHistorico;
    ciValor = idx(head, ["valor", "value", "amount", "montante"]);
    ciCred = idx(head, ["crédito", "credito", "credit", "entrada"]);
    ciDeb = idx(head, ["débito", "debito", "debit", "saída", "saida"]);
    ciTipo = idx(head, ["tipo", "type"]);
    start = 1;
  }
  const out: Linha[] = [];
  for (let i = start; i < linhas.length; i++) {
    const cols = splitCsvLine(linhas[i], delim);
    // Ignora linhas de saldo (inicial/final/anterior) que aparecem em alguns extratos
    // bancários e não representam transações.
    if (ciTipo >= 0 && /saldo/i.test(cols[ciTipo] ?? "")) continue;
    if (/^\s*saldo\b/i.test(cols[ciDesc] ?? "")) continue;
    let valor = NaN;
    if (ciValor >= 0 && cols[ciValor] != null) valor = parseValor(cols[ciValor]);
    if (isNaN(valor) && (ciCred >= 0 || ciDeb >= 0)) {
      const cred = ciCred >= 0 ? parseValor(cols[ciCred] ?? "") : 0;
      const deb = ciDeb >= 0 ? parseValor(cols[ciDeb] ?? "") : 0;
      valor = (isNaN(cred) ? 0 : cred) - (isNaN(deb) ? 0 : Math.abs(deb));
    }
    if (isNaN(valor)) continue;
    out.push({
      data: parseData(cols[ciData] ?? "", anoFallback),
      descricao: (cols[ciDesc] ?? cols.find((c, j) => j !== ciData && j !== ciValor && c) ?? "").slice(0, 200),
      valor,
    });
  }
  return out;
}

const cents = (v: number) => Math.round(Math.abs(v) * 100);
function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return 0; // sem data dos dois lados: não penaliza
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
}

// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  let body: { conciliacao_id?: string; empresa_id?: string; competencia?: string };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }

  // localiza a conciliação
  let q = admin.from("conciliacoes").select("id, competencia, razao_csv_url, extrato_csv_url");
  q = body.conciliacao_id
    ? q.eq("id", body.conciliacao_id)
    : q.eq("empresa_id", body.empresa_id ?? "").eq("competencia", body.competencia ?? "");
  const { data: conc, error: cErr } = await q.maybeSingle();
  if (cErr) return fail(cErr.message);
  if (!conc) return fail("Conciliação não encontrada.");
  if (!conc.razao_csv_url) return fail("Importe a razão (CSV) antes de conciliar.");
  if (!conc.extrato_csv_url) return fail("Importe o extrato bancário (CSV) antes de conciliar.");

  const anoFallback = parseInt((conc.competencia ?? "2026-01").slice(0, 4), 10) || 2026;
  const dl = async (path: string) => {
    const { data, error } = await admin.storage.from("conciliacoes").download(path);
    if (error || !data) throw new Error(error?.message ?? "Falha ao baixar arquivo.");
    return new TextDecoder().decode(new Uint8Array(await data.arrayBuffer()));
  };

  let razao: Linha[], extrato: Linha[];
  try {
    razao = parseCsv(await dl(conc.razao_csv_url), anoFallback);
    extrato = parseCsv(await dl(conc.extrato_csv_url), anoFallback);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Falha ao ler os CSVs.");
  }
  if (razao.length === 0 || extrato.length === 0) return fail("Razão ou extrato sem linhas válidas (verifique o CSV).");

  const usadoR = new Array(razao.length).fill(false);
  const usadoE = new Array(extrato.length).fill(false);
  const conciliados: { razao: Linha; extrato: Linha; fonte: string; motivo?: string }[] = [];

  // 1) Pareamento por regras: mesmo valor (centavos) + |data| <= 3 dias
  for (let i = 0; i < razao.length; i++) {
    let best = -1, bestDias = Infinity;
    for (let j = 0; j < extrato.length; j++) {
      if (usadoE[j]) continue;
      if (cents(razao[i].valor) !== cents(extrato[j].valor)) continue;
      const d = diasEntre(razao[i].data, extrato[j].data);
      if (d <= 3 && d < bestDias) { best = j; bestDias = d; }
    }
    if (best >= 0) {
      usadoR[i] = true; usadoE[best] = true;
      conciliados.push({ razao: razao[i], extrato: extrato[best], fonte: "regra" });
    }
  }

  // 2) Pareamento por IA com o que sobrou (limite p/ controlar custo)
  const restR = razao.map((l, i) => ({ l, i })).filter((x) => !usadoR[x.i]).slice(0, 60);
  const restE = extrato.map((l, i) => ({ l, i })).filter((x) => !usadoE[x.i]).slice(0, 60);
  if (apiKey && restR.length && restE.length) {
    try {
      const fmt = (arr: { l: Linha; i: number }[]) =>
        arr.map((x) => `#${x.i} | ${x.l.data ?? "?"} | ${x.l.descricao} | ${x.l.valor.toFixed(2)}`).join("\n");
      const SCHEMA = {
        type: "object", additionalProperties: false,
        properties: {
          pares: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              properties: { r: { type: "integer" }, e: { type: "integer" }, motivo: { type: "string" } },
              required: ["r", "e"],
            },
          },
        },
        required: ["pares"],
      };
      const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system:
            "Você concilia lançamentos contábeis (razão) com o extrato bancário. " +
            "Pareie linhas que representam a MESMA transação, mesmo com descrições diferentes ou pequena diferença de data. " +
            "Só una quando houver alta confiança (valores iguais ou muito próximos e descrição compatível). Não invente pares.",
          messages: [{
            role: "user",
            content: [{
              type: "text",
              text: `RAZÃO (índice | data | descrição | valor):\n${fmt(restR)}\n\nEXTRATO (índice | data | descrição | valor):\n${fmt(restE)}\n\nRetorne os pares (r = índice da razão, e = índice do extrato).`,
            }],
          }],
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
        }),
      });
      if (apiResp.ok) {
        const dataApi = await apiResp.json();
        const tb = (dataApi.content ?? []).find((b: { type: string }) => b.type === "text");
        const pares = JSON.parse(tb?.text ?? '{"pares":[]}').pares ?? [];
        for (const p of pares) {
          const r = p.r, e = p.e;
          if (Number.isInteger(r) && Number.isInteger(e) && razao[r] && extrato[e] && !usadoR[r] && !usadoE[e]) {
            usadoR[r] = true; usadoE[e] = true;
            conciliados.push({ razao: razao[r], extrato: extrato[e], fonte: "ia", motivo: p.motivo });
          }
        }
      }
    } catch { /* IA é best-effort: se falhar, segue só com regras */ }
  }

  const divergencias_razao = razao.filter((_, i) => !usadoR[i]);
  const divergencias_extrato = extrato.filter((_, i) => !usadoE[i]);
  const divergencias_count = divergencias_razao.length + divergencias_extrato.length;

  const resultado = {
    gerado_em: new Date().toISOString(),
    total_razao: razao.length,
    total_extrato: extrato.length,
    conciliados_count: conciliados.length,
    conciliados,
    divergencias_razao,
    divergencias_extrato,
  };

  const novoStatus = divergencias_count === 0 ? "concluida" : "divergencias";
  const { error: upErr } = await admin
    .from("conciliacoes")
    .update({
      resultado,
      divergencias_count,
      status: novoStatus,
      concluido_em: divergencias_count === 0 ? new Date().toISOString() : null,
    })
    .eq("id", conc.id);
  if (upErr) return fail(upErr.message);

  return json(200, { ok: true, divergencias_count, conciliados: conciliados.length, status: novoStatus });
});

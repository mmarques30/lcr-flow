// Edge Function: conciliar
// Motor de conciliação v3 (docs/conciliacao-v3-spec.md): conciliar NÃO é achar
// par débito/crédito linha a linha. É validar que o saldo bate (saldo_inicial +
// movimentação ≈ saldo_final, tolerância ±R$0,01) e que toda movimentação do
// extrato está classificada — ver saldo.ts (validarSaldo/detectarFaltantes).
//
// O pareamento por regras abaixo é mantido apenas como COMPAT temporário para
// os painéis "conciliados"/"divergências" ainda em uso pela UI v2 (será
// removido em #132, junto da limpeza de resultado.conciliados/divergencias_*).
// A chamada à IA (Claude) para pareamento foi removida — não faz mais parte
// do motor v3 (a classificação já acontece em processar-documento).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { detectarFaltantes, validarSaldo, type LancamentoConc, type LinhaExtrato } from "./saldo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string) => json(200, { ok: false, error });

type Linha = { data: string | null; descricao: string; valor: number; id?: string };

// Extrai saldo_inicial/saldo_final dos dados que a IA já parseou em
// processar-documento (mesma lógica de getConciliacaoDetalhe em lcr.functions.ts).
function pickNumero(obj: Record<string, unknown> | null | undefined, chaves: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of chaves) {
    const v = (obj as Record<string, unknown>)[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number"
      ? v
      : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

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
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  let body: { conciliacao_id?: string; empresa_id?: string; competencia?: string; modo?: "analisar" | "finalizar" };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const modo = body.modo === "finalizar" ? "finalizar" : "analisar";

  // localiza a conciliação
  let q = admin.from("conciliacoes").select("id, empresa_id, competencia, extrato_csv_url, resultado, divergencias_count");
  q = body.conciliacao_id
    ? q.eq("id", body.conciliacao_id)
    : q.eq("empresa_id", body.empresa_id ?? "").eq("competencia", body.competencia ?? "");
  const { data: conc, error: cErr } = await q.maybeSingle();
  if (cErr) return fail(cErr.message);
  if (!conc) return fail("Conciliação não encontrada.");
  if (!conc.extrato_csv_url) return fail("Importe o extrato bancário (CSV) antes de conciliar.");

  // Finalização: exige análise prévia + travas v3 (saldo confere + sem
  // faltantes) além da trava v2 (divergências de pareamento, mantida até #132).
  if (modo === "finalizar") {
    if (!conc.resultado) return fail("Analise as divergências antes de conciliar.");
    const pend = conc.divergencias_count ?? 0;
    if (pend > 0) return fail(`Existem ${pend} divergência(s) pendentes. Resolva antes de conciliar.`);
    const r = conc.resultado as {
      conciliados_count?: number;
      saldo?: { confere?: boolean; motivo?: string };
      faltantes?: { faltantes_count?: number };
    };
    if (r.saldo && r.saldo.confere !== true) {
      return fail(r.saldo.motivo ?? "Saldo não confere. Verifique o extrato antes de conciliar.");
    }
    const faltantesCount = r.faltantes?.faltantes_count ?? 0;
    if (faltantesCount > 0) {
      return fail(`Existem ${faltantesCount} transação(ões) faltante(s) (extrato sem classificação ou lançamento sem extrato). Resolva antes de conciliar.`);
    }
    const { error: finErr } = await admin
      .from("conciliacoes")
      .update({ status: "concluida", concluido_em: new Date().toISOString() })
      .eq("id", conc.id);
    if (finErr) return fail(finErr.message);
    return json(200, {
      ok: true,
      modo: "finalizar",
      divergencias_count: 0,
      conciliados: r.conciliados_count ?? 0,
      status: "concluida",
    });
  }

  const anoFallback = parseInt((conc.competencia ?? "2026-01").slice(0, 4), 10) || 2026;
  const dl = async (path: string) => {
    const { data, error } = await admin.storage.from("conciliacoes").download(path);
    if (error || !data) throw new Error(error?.message ?? "Falha ao baixar arquivo.");
    return new TextDecoder().decode(new Uint8Array(await data.arrayBuffer()));
  };

  // Razão = lançamentos da competência (gerados pela IA), direto do banco.
  // Não há mais upload de "razão SCI": a razão é a tabela de lançamentos da tela.
  const { data: lancRows, error: lErr } = await admin
    .from("lancamentos")
    .select("id, data_lancamento, valor, descricao, conta_id, fonte_extrato")
    .eq("empresa_id", conc.empresa_id)
    .eq("competencia", conc.competencia)
    .not("valor", "is", null)
    .range(0, 4999);
  if (lErr) return fail(lErr.message);
  const razao: Linha[] = (lancRows ?? []).map((r) => ({
    id: r.id as string,
    data: r.data_lancamento ?? null,
    descricao: (r.descricao ?? "").slice(0, 200),
    valor: Number(r.valor) || 0,
  }));
  const lancamentosConc: LancamentoConc[] = (lancRows ?? []).map((r) => ({
    id: r.id as string,
    data: r.data_lancamento ?? null,
    valor: Number(r.valor) || 0,
    contaId: (r.conta_id as string | null) ?? null,
    fonteExtrato: !!r.fonte_extrato,
    descricao: (r.descricao as string | null) ?? null,
  }));

  // Saldo inicial/final: extraído pela IA em processar-documento (documentos
  // tipo=extrato, dados_extraidos). Sem isso, validarSaldo() já retorna
  // confere=false com motivo explicativo (não derruba a análise).
  const { data: extratoDoc } = await admin
    .from("documentos")
    .select("id, classificacao_ia, dados_extraidos")
    .eq("empresa_id", conc.empresa_id)
    .eq("competencia", conc.competencia)
    .eq("tipo", "extrato")
    .order("recebido_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const dadosExtratoDoc = (extratoDoc?.classificacao_ia as Record<string, unknown> | null)?.dados_extraidos
    ?? extratoDoc?.dados_extraidos
    ?? null;
  const saldoInicial = pickNumero(dadosExtratoDoc as Record<string, unknown> | null, ["saldo_inicial", "saldo_inicio", "saldo_anterior", "opening_balance", "balance_start"]);
  const saldoFinal = pickNumero(dadosExtratoDoc as Record<string, unknown> | null, ["saldo_final", "saldo_atual", "saldo_disponivel", "closing_balance", "balance_end"]);

  let extrato: Linha[];
  try {
    extrato = parseCsv(await dl(conc.extrato_csv_url), anoFallback);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Falha ao ler o extrato.");
  }
  if (razao.length === 0) return fail("Não há lançamentos na razão desta competência. Processe um documento com IA antes de conciliar.");
  if (extrato.length === 0) return fail("Extrato sem linhas válidas (verifique o CSV).");

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

  const divergencias_razao = razao.filter((_, i) => !usadoR[i]);
  const divergencias_extrato = extrato.filter((_, i) => !usadoE[i]);
  const divergencias_count = divergencias_razao.length + divergencias_extrato.length;

  // Motor v3: saldo (inicial + movimentação ≈ final) e faltantes (extrato sem
  // classificação / lançamento fonte_extrato sem CSV correspondente).
  const extratoLinhas: LinhaExtrato[] = extrato.map((l) => ({ data: l.data, descricao: l.descricao, valor: l.valor }));
  const saldo = validarSaldo({ saldoInicial, saldoFinal, extrato: extratoLinhas });
  const faltantes = detectarFaltantes({ extrato: extratoLinhas, lancamentos: lancamentosConc });

  const resultado = {
    gerado_em: new Date().toISOString(),
    total_razao: razao.length,
    total_extrato: extrato.length,
    // Compat v2 (painéis de pareamento) — removido em #132.
    conciliados_count: conciliados.length,
    conciliados,
    divergencias_razao,
    divergencias_extrato,
    // Motor v3 (docs/conciliacao-v3-spec.md).
    saldo,
    faltantes,
  };

  // Análise: grava resultado; conclusão só via modo "finalizar".
  const novoStatus = divergencias_count === 0 ? "em_andamento" : "divergencias";
  const { error: upErr } = await admin
    .from("conciliacoes")
    .update({
      resultado,
      divergencias_count,
      status: novoStatus,
      concluido_em: null,
    })
    .eq("id", conc.id);
  if (upErr) return fail(upErr.message);

  return json(200, {
    ok: true,
    modo: "analisar",
    divergencias_count,
    conciliados: conciliados.length,
    status: novoStatus,
    saldo,
    faltantes_count: faltantes.faltantes_count,
  });
});

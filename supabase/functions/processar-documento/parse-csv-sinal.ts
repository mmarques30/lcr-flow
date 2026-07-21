// Cópia adaptada e reduzida de supabase/functions/conciliar/parse-csv.ts —
// mesma convenção já usada no repo de duplicar módulos puros pequenos entre
// edge functions (não há import cruzado entre pastas de supabase/functions/*
// hoje, e criar um _shared/ mudaria a forma como todas as functions são
// empacotadas; duplicar é o caminho de menor risco).
//
// Objetivo (code review 20/07 — "sinal 100% dependente da IA"): decidir, POR
// LINHA, se o CSV bruto do extrato estrutura o sinal débito/crédito de forma
// inequívoca (coluna tipo/débito/crédito dedicada, ou valor já assinado no
// texto) — quando for, processar-documento/index.ts pode confiar nisso pra
// sobrescrever o `tipo_movimento` que a IA sugeriu, em vez de depender 100%
// da interpretação da IA. Quando NÃO for inequívoco, `sinalExplicito=false`
// e o caller deve manter a decisão da IA.
export type LinhaComSinal = { data: string | null; valorAbs: number; sinal: -1 | 1; sinalExplicito: boolean };

function sanitizeTexto(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

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

/** Como parseValor (parse-csv.ts), mas também informa se o sinal veio
 *  explícito no próprio texto (menos/parênteses) — vs. inferido depois por
 *  outra coluna (tipo/débito/crédito) ou nem inferido (ambíguo). */
function parseValorComSinal(s: string): { valor: number; sinalExplicito: boolean } {
  if (!s) return { valor: NaN, sinalExplicito: false };
  let t = s.replace(/[R$\s]/gi, "");
  const temParenteses = /[()]/.test(t);
  t = t.replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const temMenos = /-/.test(t);
  t = t.replace(/-/g, "");
  if (t.includes(".") && t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const v = parseFloat(t);
  if (isNaN(v)) return { valor: NaN, sinalExplicito: false };
  const sinalExplicito = temMenos || temParenteses;
  return { valor: sinalExplicito ? -v : v, sinalExplicito };
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

function sinalPorTipo(tipo: string): -1 | 0 | 1 {
  const t = tipo.toLowerCase().trim();
  if (/^(d|débito|debito|saída|saida|pagamento)/.test(t)) return -1;
  if (/^(c|crédito|credito|entrada|recebimento)/.test(t)) return 1;
  return 0;
}

export function parseCsvComSinal(texto: string, anoFallback: number): LinhaComSinal[] {
  const linhas = sanitizeTexto(texto).split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return [];
  const delim = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitCsvLine(linhas[0], delim).map((h) => h.toLowerCase());
  const hasHeader = idx(head, ["data", "date", "dt"]) >= 0 || idx(head, ["valor", "value", "amount", "montante"]) >= 0;
  let ciData = 0, ciValor = 2, ciCred = -1, ciDeb = -1, ciTipo = -1, start = 0;
  if (hasHeader) {
    ciData = idx(head, ["data", "date", "dt"]);
    ciValor = idx(head, ["valor", "value", "amount", "montante"]);
    ciCred = idx(head, ["crédito", "credito", "credit", "entrada"]);
    ciDeb = idx(head, ["débito", "debito", "debit", "saída", "saida"]);
    ciTipo = idx(head, ["tipo", "type"]);
    start = 1;
  }
  const out: LinhaComSinal[] = [];
  for (let i = start; i < linhas.length; i++) {
    const cols = splitCsvLine(linhas[i], delim);
    if (ciTipo >= 0 && /saldo/i.test(cols[ciTipo] ?? "")) continue;

    let valor = NaN;
    let sinalExplicito = false;
    if (ciValor >= 0 && cols[ciValor] != null) {
      const r = parseValorComSinal(cols[ciValor]);
      valor = r.valor;
      sinalExplicito = r.sinalExplicito;
    }
    if (isNaN(valor) && (ciCred >= 0 || ciDeb >= 0)) {
      const cred = ciCred >= 0 ? parseValorComSinal(cols[ciCred] ?? "").valor : 0;
      const deb = ciDeb >= 0 ? parseValorComSinal(cols[ciDeb] ?? "").valor : 0;
      valor = (isNaN(cred) ? 0 : cred) - (isNaN(deb) ? 0 : Math.abs(deb));
      // Colunas débito/crédito separadas são, por definição, estrutura
      // inequívoca — não dependem de interpretar sinal nenhum.
      sinalExplicito = true;
    }
    if (isNaN(valor)) continue;
    // Coluna "tipo" dedicada também é estrutura inequívoca — sobrescreve
    // (não só complementa) o que quer que tenha sido lido da coluna valor.
    if (ciTipo >= 0) {
      const sinal = sinalPorTipo(cols[ciTipo] ?? "");
      if (sinal !== 0) {
        valor = Math.abs(valor) * sinal;
        sinalExplicito = true;
      }
    }
    out.push({
      data: parseData(cols[ciData] ?? "", anoFallback),
      valorAbs: Math.abs(valor),
      sinal: valor < 0 ? -1 : 1,
      sinalExplicito,
    });
  }
  return out;
}

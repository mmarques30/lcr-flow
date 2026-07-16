// Parsing puro do extrato CSV usado pelo motor de conciliação v3 (index.ts).
// Extraído para módulo separado pra permitir testes Deno sem disparar
// Deno.serve() (index.ts é o entrypoint da edge function).

export type Linha = { data: string | null; descricao: string; valor: number; id?: string };

// Detecta quando o arquivo em extrato_csv_url NÃO é um CSV de texto — ex.
// cliente subiu o extrato como PDF/XLS direto (sem gerar CSV), caso em que
// processar-documento já extraiu os lançamentos via IA, mas o arquivo bruto
// não pode ser reaproveitado aqui como segunda fonte (saldo/faltantes). Sem
// essa checagem, decodificar binário como UTF-8 produz lixo silencioso
// (ou, antes de sanitizeTexto, travava a gravação com \u0000 no Postgres).
const ASSINATURAS_BINARIAS: { bytes: number[]; formato: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], formato: "PDF" }, // %PDF
  { bytes: [0x50, 0x4b, 0x03, 0x04], formato: "XLSX/ZIP" }, // PK\x03\x04 (xlsx, docx, zip)
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], formato: "XLS (binário legado)" },
  { bytes: [0xff, 0xd8, 0xff], formato: "JPEG" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], formato: "PNG" },
];

export function formatoBinarioDetectado(bytes: Uint8Array): string | null {
  for (const { bytes: assinatura, formato } of ASSINATURAS_BINARIAS) {
    if (bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b)) return formato;
  }
  return null;
}

// Remove NUL e outros caracteres de controle que o Postgres rejeita em
// texto/jsonb ("unsupported Unicode escape sequence \u0000..."). Extratos
// exportados com encoding errado (ex. UTF-16 lido como UTF-8/Latin1) podem
// intercalar bytes \u0000 entre caracteres — sem isso, a análise inteira
// falha ao tentar salvar resultado.faltantes com essas descrições.
export function sanitizeTexto(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function splitCsvLine(line: string, delim: string): string[] {
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

export function parseValor(s: string): number {
  if (!s) return NaN;
  let t = s.replace(/[R$\s]/gi, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const neg = /-/.test(t);
  t = t.replace(/-/g, "");
  if (t.includes(".") && t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const v = parseFloat(t);
  return isNaN(v) ? NaN : (neg ? -v : v);
}

export function parseData(s: string, anoFallback: number): string | null {
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

export const idx = (header: string[], names: string[]) =>
  header.findIndex((h) => names.some((n) => h.includes(n)));

// #fix-sinal-csv: parsers próprios (Python bridge_front.montar_csv_extrato) e a IA
// sempre gravam "valor" em módulo, com o sinal só na coluna "tipo" — ver
// extrato_bancario.py ('tipo': 'debito' | 'credito'). Sem isto, movimentacao_liquida
// (soma direta em saldo.ts) fica sempre positiva, quebrando a validação de saldo.
// Retorna 0 (não altera o sinal já parseado) quando o valor de "tipo" não é
// reconhecido — CSVs de banco onde essa coluna significa outra coisa (ex. "PIX",
// "TED") não devem ter o sinal forçado.
export function sinalPorTipo(tipo: string): -1 | 0 | 1 {
  const t = tipo.toLowerCase().trim();
  if (/^(d|débito|debito|saída|saida|pagamento)/.test(t)) return -1;
  if (/^(c|crédito|credito|entrada|recebimento)/.test(t)) return 1;
  return 0;
}

export function parseCsv(texto: string, anoFallback: number): Linha[] {
  const linhas = sanitizeTexto(texto).split(/\r?\n/).filter((l) => l.trim().length > 0);
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
    // Coluna "valor" única + coluna "tipo" (formato Python/IA: valor sempre em
    // módulo) — reaplica o sinal correto pelo tipo em vez de confiar no sinal
    // (ausente) do próprio valor.
    if (ciTipo >= 0) {
      const sinal = sinalPorTipo(cols[ciTipo] ?? "");
      if (sinal !== 0) valor = Math.abs(valor) * sinal;
    }
    out.push({
      data: parseData(cols[ciData] ?? "", anoFallback),
      descricao: (cols[ciDesc] ?? cols.find((c, j) => j !== ciData && j !== ciValor && c) ?? "").slice(0, 200),
      valor,
    });
  }
  return out;
}

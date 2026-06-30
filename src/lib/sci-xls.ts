// Geração da planilha de importação SCI (.xls) por lançamento, no layout exato do
// modelo (config/08_-_Modelo_Planilha_Importacao_Lctos_SCI.xls): 11 colunas, uma
// linha por lançamento, códigos LCR diretos. Espelha src/sci/gerar_planilha_supabase.py.
import * as XLSX from "xlsx";

// banco (texto) → código LCR no plano de contas (contrapartida)
const BANCO_PARA_CODIGO: Record<string, number> = {
  bradesco: 9, brasil: 7, "bb ": 7, caixa: 8, santander: 10, itau: 657,
  inter: 658, sicoob: 659, sicredi: 775, original: 779, nubank: 821,
  "xp ": 823, c6: 809, stone: 910, pagbank: 946, btg: 1031,
};
const TIPOS_DEBITO = ["ativo", "despesa", "custo", "deducoes"];
const TIPOS_CREDITO = ["passivo", "receita", "resultado", "patrimonio"];

// Cabeçalho EXATO do modelo SCI (ordem e acentuação importam).
const COLUNAS = [
  "DATA", "DÉBITO", "CRÉDITO", "PART DÉB,", "PART, CRED", "VALOR",
  "HISTÓRICO", "COMPLEMENTO", "DOCUMENTO", "CENTRO DE CUSTO DÉB", "CENTRO DE CUSTO CRED",
];

export type SciLanc = {
  data_lancamento: string | null;
  valor: number | null;
  descricao: string | null;
  documento_numero?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; tipo: string | null; sci_apelido?: string | null } | null;
  historico: { codigo: string } | null;
};

/** Resolve o código LCR do banco a partir do nome da conta bancária. */
export function bancoCodigoDe(bancoNome: string | null | undefined): number | null {
  const b = (bancoNome ?? "").toLowerCase();
  for (const [nome, cod] of Object.entries(BANCO_PARA_CODIGO)) {
    if (b.includes(nome.trim())) return cod;
  }
  return null;
}

export function ladoConta(tipo: string | null): "debito" | "credito" {
  const t = (tipo ?? "").toLowerCase();
  if (TIPOS_DEBITO.some((x) => t.includes(x))) return "debito";
  if (TIPOS_CREDITO.some((x) => t.includes(x))) return "credito";
  return "debito"; // fallback conservador (igual ao Python)
}

// Inversão automática contábil. Decide em qual lado a CONTRAPARTIDA (a conta
// que não é o banco) entra. Ordem de prioridade:
//
//   1. natureza_movimento (vindo da IA na leitura do extrato — fonte de verdade):
//      - 'debito'  = banco debitou → saída do banco  → contrapartida no DÉBITO
//      - 'credito' = banco creditou → entrada no banco → contrapartida no CRÉDITO
//   2. sinal do valor (quando o sistema armazenar valor com sinal):
//      - valor < 0 → saída do banco  → contrapartida no DÉBITO
//      - valor > 0 → entrada no banco → contrapartida no CRÉDITO
//   3. ladoConta como último recurso (natureza por tipo de conta).
//
// IMPORTANTE: hoje o sistema grava valor sempre absoluto (Math.abs em
// createLancamento/editarLancamento), então o passo 2 vira inócuo. Daí a
// natureza_movimento ter virado obrigatória para a inversão funcionar.
export function ladoEfetivo(args: { natureza?: string | null; valor: number; tipoConta: string | null }): "debito" | "credito" {
  const n = (args.natureza ?? "").toLowerCase();
  if (n === "debito" || n === "débito" || n === "d") return "debito";
  if (n === "credito" || n === "crédito" || n === "c") return "credito";
  if (args.valor < 0) return "debito";
  if (args.valor > 0) return "credito";
  return ladoConta(args.tipoConta);
}

// Mantida para compatibilidade (chamadas antigas que não passavam natureza).
export function ladoPorValor(valor: number, tipoConta: string | null): "debito" | "credito" {
  return ladoEfetivo({ valor, tipoConta });
}

function fmtData(d: string | null): number | string {
  if (!d) return "";
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : String(d).replace(/-/g, "").slice(0, 8);
}

/** Monta as linhas do layout SCI (uma por lançamento com conta).
 *  Débito/crédito usam o apelido SCI (de-para) quando houver; `bancoSci` já vem
 *  resolvido para o apelido do banco. */
export function linhasSci(lancs: SciLanc[], bancoSci: number | string | "") {
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      const conta = codSci(l.conta!);
      const banco: number | string = bancoSci;
      const valor = Number(l.valor ?? 0);
      // Inversão automática contábil: natureza_movimento (IA) > sinal > tipo.
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      const debito = ld === "debito" ? conta : banco;
      const credito = ld === "debito" ? banco : conta;
      return {
        "DATA": fmtData(l.data_lancamento),
        "DÉBITO": debito,
        "CRÉDITO": credito,
        "PART DÉB,": "",
        "PART, CRED": "",
        // SCI espera valor absoluto na coluna VALOR — o sinal já foi
        // refletido no posicionamento débito/crédito acima.
        "VALOR": Math.abs(valor),
        "HISTÓRICO": l.historico?.codigo ?? "",
        "COMPLEMENTO": (l.descricao ?? "").slice(0, 80),
        "DOCUMENTO": l.documento_numero ?? "",
        "CENTRO DE CUSTO DÉB": "",
        "CENTRO DE CUSTO CRED": "",
      };
    });
}

/** Gera e dispara o download do .xls de importação SCI (formato BIFF8, igual ao modelo). */
export function baixarPlanilhaSciXls(
  empresaNome: string,
  competencia: string,
  lancs: SciLanc[],
  bancoSci: number | string | "",
): number {
  const rows = linhasSci(lancs, bancoSci);
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUNAS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planilha de importação");
  const nome = `${empresaNome} - Lancamentos ${competencia}.xls`;
  XLSX.writeFile(wb, nome, { bookType: "biff8" });
  return rows.length;
}

// ── Prévia para a UI (mesmo layout do modelo, com código + nome p/ leitura) ──
export type SciLancRico = {
  id?: string;
  data_lancamento: string | null;
  valor: number | null;
  descricao: string | null;
  documento_numero?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; descricao: string; tipo: string | null; sci_apelido?: string | null } | null;
  historico: { codigo: string; descricao: string; sci_apelido?: string | null } | null;
};

export type SciCelula = { codigo: number | string; nome: string };
export type SciPreviewRow = {
  id?: string;
  data: number | string;
  debito: SciCelula;
  credito: SciCelula;
  valor: number;
  historico: { codigo: string; apelido: string; nome: string };
  complemento: string;
  documento: string;
};

/** Código SCI da conta: apelido do de-para quando existir, senão o código LCR. */
function codSci(c: { codigo: string; sci_apelido?: string | null }): number | string {
  const v = c.sci_apelido && c.sci_apelido.trim() ? c.sci_apelido.trim() : c.codigo;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

/** Monta as linhas da prévia (uma por lançamento), reproduzindo o layout do modelo.
 *  Débito/crédito usam o apelido SCI (de-para) quando disponível; `bancoSci` já vem
 *  resolvido para o apelido do banco. */
export function linhasSciPreview(
  lancs: SciLancRico[],
  bancoSci: number | string | "",
  bancoNome: string,
): SciPreviewRow[] {
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      const conta: SciCelula = { codigo: codSci(l.conta!), nome: l.conta!.descricao };
      const banco: SciCelula = { codigo: bancoSci, nome: bancoNome || "Banco" };
      const valor = Number(l.valor ?? 0);
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      return {
        id: l.id,
        data: fmtData(l.data_lancamento),
        debito: ld === "debito" ? conta : banco,
        credito: ld === "debito" ? banco : conta,
        valor: Math.abs(valor),
        historico: {
          codigo: l.historico?.codigo ?? "",
          apelido: l.historico?.sci_apelido ?? "",
          nome: l.historico?.descricao ?? "",
        },
        complemento: (l.descricao ?? "").slice(0, 80),
        documento: (l.documento_numero ?? "").slice(0, 80),
      };
    });
}

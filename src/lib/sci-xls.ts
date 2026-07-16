// Geração da planilha de importação SCI (.xls) por lançamento, no layout exato do
// modelo (config/08_-_Modelo_Planilha_Importacao_Lctos_SCI.xls): 11 colunas, uma
// linha por lançamento, códigos reduzidos SCI (plano_de_contas_lcr.apelido).
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
  "DATA", "DÉBITO", "CRÉDITO", "PART DÉB", "PART CRED", "VALOR",
  "HISTÓRICO", "COMPLEMENTO", "DOCUMENTO", "CENTRO DE CUSTO DÉB", "CENTRO DE CUSTO CRED",
];

export type SciLanc = {
  data_lancamento: string | null;
  valor: number | null;
  descricao: string | null;
  documento_numero?: string | null;
  part_deb?: string | null;
  part_cred?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; tipo: string | null } | null;
  historico: { codigo: string; pula_complemento?: boolean | null } | null;
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
//   2. sinal do valor com SIGNED valor (negativo = saída, positivo = entrada).
//   3. ladoConta (natureza por tipo de conta: despesa/ativo → débito,
//      receita/passivo → crédito).
//
// IMPORTANTE: o sistema persiste valor sempre absoluto. Para o passo 2
// disparar, é preciso passar o sinal explicitamente (callers que sabem o
// sinal pré-Math.abs podem fazer isso). Caso contrário, vai direto para
// ladoConta, que é o fallback SEGURO — antes o código retornava "credito"
// quando valor>0 (sempre) e gerava inversão errada em despesas (TRSS,
// ICMS, tarifas).
export function ladoEfetivo(args: { natureza?: string | null; valor?: number; tipoConta: string | null }): "debito" | "credito" {
  const n = (args.natureza ?? "").toLowerCase();
  if (n.startsWith("d")) return "debito";
  if (n.startsWith("c")) return "credito";
  // Só usa sinal do valor se foi passado explicitamente com sinal preservado.
  if (typeof args.valor === "number" && args.valor < 0) return "debito";
  // valor > 0 NÃO usa mais "credito" — quase todos os callers passam
  // Math.abs(valor), então essa heurística enviesava despesas para o crédito.
  return ladoConta(args.tipoConta);
}

// Mantida para compatibilidade (chamadas antigas que não passavam natureza).
export function ladoPorValor(valor: number, tipoConta: string | null): "debito" | "credito" {
  return ladoEfetivo({ valor, tipoConta });
}

/** Formato de data para prévia e export .xls (DD/MM/AAAA), conforme uso da equipe LCR. */
export function fmtDataPreview(d: string | null): string {
  if (!d) return "";
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
}

/** Mapa codigo LCR → código reduzido SCI (plano_de_contas_lcr.apelido, col A PDC). */
export function mapaPdcApelidos(
  rows: readonly { codigo: number; apelido: number | null }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.apelido != null) m.set(String(r.codigo), r.apelido);
  }
  return m;
}

/** Código reduzido SCI da conta: plano_de_contas_lcr.apelido; fallback no código LCR. */
export function codSciReduzido(
  codigoLcr: string | null | undefined,
  apelidos: Map<string, number>,
): number | string {
  const c = String(codigoLcr ?? "").trim();
  if (!c) return "";
  const ap = apelidos.get(c);
  if (ap != null) return ap;
  const n = Number(c);
  return Number.isNaN(n) ? c : n;
}

/** Monta as linhas do layout SCI (uma por lançamento com conta).
 *  Débito/crédito usam código reduzido (plano_de_contas_lcr.apelido); banco = CC nº 1. */
export function linhasSci(
  lancs: SciLanc[],
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
) {
  const bancoSci = bancoCodigoLcr != null ? codSciReduzido(String(bancoCodigoLcr), pdcApelidos) : "";
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      const conta = codSciReduzido(l.conta!.codigo, pdcApelidos);
      const banco: number | string = bancoSci;
      const valor = Number(l.valor ?? 0);
      // Inversão automática contábil: natureza_movimento (IA) > sinal > tipo.
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      const debito = ld === "debito" ? conta : banco;
      const credito = ld === "debito" ? banco : conta;
      return {
        "DATA": fmtDataPreview(l.data_lancamento),
        "DÉBITO": debito,
        "CRÉDITO": credito,
        "PART DÉB": l.part_deb ?? "",
        "PART CRED": l.part_cred ?? "",
        // SCI espera valor absoluto na coluna VALOR — o sinal já foi
        // refletido no posicionamento débito/crédito acima.
        "VALOR": Math.abs(valor),
        // HISTÓRICO = código oficial (historicos_sci_lcr.codigo). Apelido histórico desconsiderado.
        "HISTÓRICO": histSciCodigo(l.historico?.codigo),
        // Complemento dispensado quando o histórico tem PulaComplemento=Sim.
        "COMPLEMENTO": l.historico?.pula_complemento ? "" : (l.descricao ?? "").slice(0, 80),
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
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
): number {
  const rows = linhasSci(lancs, bancoCodigoLcr, pdcApelidos);
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
  part_deb?: string | null;
  part_cred?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string; pula_complemento?: boolean | null } | null;
};

// ── Validação pré-envio: bloqueia exportação se algum código de conta usado
// nos lançamentos não existir no Plano de Contas oficial LCR (Anexo 1). O caller
// consulta plano_de_contas_lcr e passa o set de códigos válidos.
export type SciInvalido = { id?: string; codigo: string; descricao: string | null };
export function validarLancamentosSci(
  lancs: Array<{ id?: string; conta: { codigo: string; descricao?: string | null } | null }>,
  codigosValidos: Set<string>,
): SciInvalido[] {
  const out: SciInvalido[] = [];
  for (const l of lancs) {
    const c = l.conta?.codigo;
    if (!c) continue;
    if (!codigosValidos.has(String(c))) {
      out.push({ id: l.id, codigo: String(c), descricao: l.conta?.descricao ?? null });
    }
  }
  return out;
}

export type SciCelula = { codigo: number | string; nome: string };
export type SciPreviewRow = {
  id?: string;
  data: string;
  debito: SciCelula;
  credito: SciCelula;
  valor: number;
  historico: { codigo: string; nome: string };
  complemento: string;
  documento: string;
  part_deb: string;
  part_cred: string;
};

/** Código SCI do histórico: sempre historicos_sci_lcr.codigo (nunca sci_apelido). */
export function histSciCodigo(codigo: string | null | undefined): number | string {
  const c = (codigo ?? "").trim();
  if (!c) return "";
  const n = Number(c);
  return Number.isNaN(n) ? c : n;
}

/** Monta as linhas da prévia (uma por lançamento), reproduzindo o layout do modelo.
 *  Mesmos códigos reduzidos do export .xls (plano_de_contas_lcr.apelido). */
export function linhasSciPreview(
  lancs: SciLancRico[],
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
  bancoNome: string,
): SciPreviewRow[] {
  const bancoSci = bancoCodigoLcr != null ? codSciReduzido(String(bancoCodigoLcr), pdcApelidos) : "";
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      const conta: SciCelula = {
        codigo: codSciReduzido(l.conta!.codigo, pdcApelidos),
        nome: l.conta!.descricao,
      };
      const banco: SciCelula = { codigo: bancoSci, nome: bancoNome || "Banco" };
      const valor = Number(l.valor ?? 0);
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      return {
        id: l.id,
        data: fmtDataPreview(l.data_lancamento),
        debito: ld === "debito" ? conta : banco,
        credito: ld === "debito" ? banco : conta,
        valor: Math.abs(valor),
        historico: {
          codigo: l.historico?.codigo ?? "",
          nome: l.historico?.descricao ?? "",
        },
        complemento: l.historico?.pula_complemento ? "" : (l.descricao ?? "").slice(0, 80),
        documento: (l.documento_numero ?? "").slice(0, 80),
        part_deb: (l.part_deb ?? "").slice(0, 40),
        part_cred: (l.part_cred ?? "").slice(0, 40),
      };
    });
}

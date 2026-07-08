// Pós-processador determinístico: corrige erros recorrentes da IA no edge
// (PIX recebido ≠ internet; energia → hist 2330; etc.)

export type SugestaoMapa = {
  data_lancamento?: string;
  valor?: number;
  tipo_movimento?: string;
  conta_codigo?: string;
  historico_codigo?: string;
  descricao?: string;
  confidence?: number;
  regra_id?: string;
  justificativa?: string;
  participante?: string;
};

function isCredito(s: SugestaoMapa): boolean {
  const m = String(s.tipo_movimento ?? "").toLowerCase().trim();
  return m.startsWith("c");
}

function isDebito(s: SugestaoMapa): boolean {
  const m = String(s.tipo_movimento ?? "").toLowerCase().trim();
  return m.startsWith("d");
}

const ENERGIA_KW = /\b(energia|eletri|enel|cemig|copel|light|conta de luz|cpfl|eletropaulo|neoenergia)\b/i;
const PIX_RECEB_KW = /\bpix\b/i;
const PIX_SAIDA_KW = /\b(env|pag|sa[ií]da|transferencia env|pix env)\b/i;

export function corrigirSugestoesMapa(sugestoes: SugestaoMapa[]): SugestaoMapa[] {
  return (sugestoes ?? []).map((s) => {
    const desc = s.descricao ?? "";
    const descL = desc.toLowerCase();
    let out: SugestaoMapa = { ...s };

    // UT-01: energia elétrica → conta 475, hist 2330 (nunca 3671 genérico)
    if (isDebito(out) && ENERGIA_KW.test(descL)) {
      out = {
        ...out,
        conta_codigo: "475",
        historico_codigo: "2330",
        regra_id: out.regra_id ?? "UT-01",
        justificativa: out.justificativa ?? "Conta de energia elétrica (regra UT-01, histórico 2330)",
      };
    }

    // Crédito / PIX recebido: NÃO classificar como UT-02 (internet, hist 3692)
    const pixRecebido = isCredito(out) && PIX_RECEB_KW.test(descL) && !PIX_SAIDA_KW.test(descL);
    const creditoGenerico = isCredito(out) && /\b(receb|dep[oó]sito|credito|cr[eé]dito)\b/.test(descL);
    const pareceInternet = out.conta_codigo === "476" || out.historico_codigo === "3692" || out.regra_id === "UT-02";

    if ((pixRecebido || creditoGenerico) && pareceInternet) {
      out = {
        ...out,
        conta_codigo: "16",
        historico_codigo: "478",
        regra_id: "RC-01",
        justificativa: "Entrada bancária (PIX/recebimento) → receita de clientes RC-01, não despesa de internet UT-02",
      };
    }

    // PIX de saída sem NF → RC-04 (débito em adiantamento, não receita)
    if (isDebito(out) && PIX_RECEB_KW.test(descL) && PIX_SAIDA_KW.test(descL)) {
      out = {
        ...out,
        conta_codigo: out.conta_codigo && out.conta_codigo !== "476" ? out.conta_codigo : "216",
        regra_id: out.regra_id ?? "RC-04",
        justificativa: out.justificativa ?? "PIX enviado sem documento fiscal vinculado (RC-04)",
      };
    }

    // Folha / salário → FP-01
    if (isDebito(out) && /\b(folha|sal[aá]rio|pagamento folha|folha pagamento)\b/.test(descL)) {
      out = {
        ...out,
        conta_codigo: "160",
        historico_codigo: "267",
        regra_id: "FP-01",
        justificativa: out.justificativa ?? "Pagamento de folha mensal (FP-01)",
      };
    }

    return out;
  });
}

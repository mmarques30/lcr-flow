// Travas de Analisar/Conciliar (#133 — docs/conciliacao-v3-spec.md "Três travas").
// Funções puras usadas pelo backend (index.ts) para espelhar exatamente a
// mesma regra do front (conciliacao_.$empresaId.tsx: podeAnalisar/podeFinalizar).
//
// Trava 1 — revisão: todo lançamento precisa de conta + confiança >= 80%.
// Trava 2 — saldo: saldo_inicial + movimentação ≈ saldo_final (±0.01).
// Trava 3 — faltantes: extrato sem classificação OU classificado sem extrato.
// "Sem documento suporte" / docs órfãos NÃO entram aqui — não travam (spec).

export const CONF_MIN_REVISAO = 0.8;

export type LancRevisao = { confidence: number | null; contaId: string | null };

/** Espelha `precisaRevisao` do front (conciliacao_.$empresaId.tsx). */
export function precisaRevisaoLancamento(l: LancRevisao): boolean {
  return (l.confidence != null && l.confidence < CONF_MIN_REVISAO) || !l.contaId;
}

export function contarRevisaoPendente(lancs: LancRevisao[]): number {
  return lancs.filter(precisaRevisaoLancamento).length;
}

export type TravaResultado = { ok: true } | { ok: false; motivo: string };

/** Trava do botão "Analisar divergências": revisão zerada + extrato presente. */
export function avaliarTravaAnalisar(input: { temExtrato: boolean; revisaoPendente: number }): TravaResultado {
  if (!input.temExtrato) return { ok: false, motivo: "Importe o extrato bancário (CSV) antes de conciliar." };
  if (input.revisaoPendente > 0) {
    return { ok: false, motivo: `Existem ${input.revisaoPendente} lançamento(s) pendentes de revisão. Revise antes de analisar.` };
  }
  return { ok: true };
}

/** Trava do botão "Conciliar": revisão zerada + saldo confere + faltantes = 0 + análise feita. */
export function avaliarTravaFinalizar(input: {
  analisado: boolean;
  revisaoPendente: number;
  saldoConfere: boolean | null | undefined;
  saldoMotivo?: string | null;
  faltantesCount: number;
}): TravaResultado {
  if (input.revisaoPendente > 0) {
    return { ok: false, motivo: `Existem ${input.revisaoPendente} lançamento(s) pendentes de revisão.` };
  }
  if (!input.analisado) return { ok: false, motivo: "Analise as divergências antes de conciliar." };
  if (input.saldoConfere !== true) {
    return { ok: false, motivo: input.saldoMotivo || "Saldo não confere. Verifique o extrato antes de conciliar." };
  }
  if (input.faltantesCount > 0) {
    return { ok: false, motivo: `Existem ${input.faltantesCount} transação(ões) faltante(s) (extrato sem classificação ou lançamento sem extrato). Resolva antes de conciliar.` };
  }
  return { ok: true };
}

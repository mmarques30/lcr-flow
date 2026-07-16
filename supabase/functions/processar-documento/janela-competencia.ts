// Filtro de janela de competência p/ lançamentos extraídos de extrato/fatura.
// #139 — bug real: extratos (Bradesco e outros) trazem seção "Próximos
// Lançamentos"/movimentações do dia 1 do mês seguinte quando extraídos no
// início do mês seguinte (ex.: extrato 06/2026 extraído em 01/07 continha 7
// transações de 01/07 indevidamente na competência 06). meses_depois=0 corta
// isso; meses_antes=1 continua tolerando compras antigas em fatura/extrato
// multi-mês (não é o bug reportado). Espelha `_filtrar_janela_competencia` em
// src/parsers/extrato_bancario.py (repo de automação).

export type ComDataOpcional = { data_lancamento?: string | null };

function competenciaParaIndice(competencia: string): number | null {
  const m = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * Mantém só itens com data dentro de [competência - mesesAntes, competência + mesesDepois].
 * Item sem data válida passa (conservador — não dá p/ janelar).
 */
export function filtrarJanelaCompetencia<T extends ComDataOpcional>(
  itens: T[],
  competencia: string,
  opts?: { mesesAntes?: number; mesesDepois?: number },
): { mantidos: T[]; descartados: number } {
  const alvo = competenciaParaIndice(competencia);
  if (alvo == null) return { mantidos: itens, descartados: 0 };
  const mesesAntes = opts?.mesesAntes ?? 1;
  const mesesDepois = opts?.mesesDepois ?? 0;

  const mantidos = itens.filter((item) => {
    const data = item.data_lancamento;
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return true;
    const [y, m] = data.split("-").map(Number);
    const idx = y * 12 + (m - 1);
    const diff = idx - alvo;
    return diff >= -mesesAntes && diff <= mesesDepois;
  });
  return { mantidos, descartados: itens.length - mantidos.length };
}

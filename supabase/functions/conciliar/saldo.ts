// Motor de validação de saldo e detecção de transações faltantes (Conciliação v3).
// Espelha docs/conciliacao-v3-spec.md: conciliar não é achar par débito/crédito
// linha a linha — é garantir que (1) o saldo bate e (2) toda movimentação do
// extrato está classificada (e vice-versa).

export type LinhaExtrato = { data: string | null; descricao: string; valor: number };

export type LancamentoConc = {
  id: string;
  data: string | null;
  valor: number;
  contaId: string | null;
  fonteExtrato: boolean;
  descricao?: string | null;
};

const TOLERANCIA_SALDO = 0.01;
const JANELA_DIAS = 3;

// #fix-sinal-fallback-ia: `lancamentos.valor` é sempre gravado em módulo
// (Math.abs em processar-documento) — o sinal fica só em `natureza_movimento`
// ("debito" | "credito" | null). Sem aplicar este sinal, a movimentação líquida
// calculada a partir de lançamentos (fallback lancamentos_ia em index.ts, usado
// quando o extrato foi enviado como PDF/imagem sem CSV) fica sempre positiva,
// quebrando a validação de saldo (validarSaldo). "credito"/null/desconhecido
// mantêm o valor positivo (comportamento anterior para dados sem essa info).
export function sinalPorNatureza(natureza: string | null | undefined): 1 | -1 {
  return natureza === "debito" ? -1 : 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const cents = (v: number) => Math.round(Math.abs(v) * 100);

// #fix-sinal-cruzado (code review 20/07): cents() usa valor absoluto — sem esta
// checagem, um débito e um crédito de mesmo valor na mesma janela de dias
// (ex.: PIX enviado e PIX recebido de mesmo valor no mesmo dia) podiam casar
// incorretamente entre si em detectarFaltantes, escondendo um erro real de
// classificação D/C. Zero não tem sinal — trata como compatível com qualquer
// lado pra não travar casos legítimos de valor zero.
function mesmoSinal(a: number, b: number): boolean {
  if (a === 0 || b === 0) return true;
  return (a < 0) === (b < 0);
}

function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return 0; // falta data de algum dos lados: não penaliza (não dá p/ comparar)
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
}

export type ResultadoSaldo = {
  saldo_inicial: number | null;
  saldo_final: number | null;
  movimentacao_liquida: number;
  saldo_calculado: number | null;
  delta: number | null;
  confere: boolean;
  motivo?: string;
};

/**
 * delta = saldo_final - (saldo_inicial + movimentacao_liquida)
 * |delta| <= 0.01 → confere = true
 *
 * Sem saldo_inicial/saldo_final extraído do extrato, não há como validar —
 * trata como NÃO conferido (trava ativa) até o documento ser reprocessado
 * ou o saldo informado manualmente.
 */
export function validarSaldo(args: {
  saldoInicial: number | null;
  saldoFinal: number | null;
  extrato: LinhaExtrato[];
}): ResultadoSaldo {
  const movimentacao_liquida = round2(
    args.extrato.reduce((s, l) => s + (Number.isFinite(l.valor) ? l.valor : 0), 0),
  );
  const { saldoInicial, saldoFinal } = args;

  if (saldoInicial == null || saldoFinal == null) {
    return {
      saldo_inicial: saldoInicial,
      saldo_final: saldoFinal,
      movimentacao_liquida,
      saldo_calculado: null,
      delta: null,
      confere: false,
      motivo: "Saldo inicial e/ou final não identificado no extrato. Reprocesse o documento ou informe manualmente.",
    };
  }

  const saldo_calculado = round2(saldoInicial + movimentacao_liquida);
  const delta = round2(saldoFinal - saldo_calculado);
  const confere = Math.abs(delta) <= TOLERANCIA_SALDO;

  return {
    saldo_inicial: saldoInicial,
    saldo_final: saldoFinal,
    movimentacao_liquida,
    saldo_calculado,
    delta,
    confere,
    motivo: confere
      ? undefined
      : `Delta de R$ ${delta.toFixed(2)} entre o saldo final informado e o saldo calculado (inicial + movimentações do extrato).`,
  };
}

export type DivergenciaSinal = {
  data: string | null;
  valor: number;
  descricaoExtrato: string;
  descricaoLancamento: string | null;
  lancamentoId: string;
};

export type Faltantes = {
  extrato_sem_classificacao: LinhaExtrato[];
  classificado_sem_extrato: LancamentoConc[];
  faltantes_count: number;
  divergencias_sinal: DivergenciaSinal[];
};

// #fix-sinal-ia (code review 20/07): alerta não-bloqueante — NÃO é uma 3ª
// trava, não altera faltantes_count nem remove nada das duas listas acima.
// Cruza as "sobras" das duas travas (que já exigem MESMO sinal pra casar)
// buscando pares com mesma data (±JANELA_DIAS) e mesmo valor em centavos
// absoluto, porém sinal OPOSTO — exatamente o padrão que o fix de sinal
// cruzado (mesmoSinal, acima) passou a rejeitar como match. Cobre os casos
// que a correção determinística na ingestão (processar-documento) não
// resolve: extrato enviado como PDF/imagem, ou CSV sem estrutura inequívoca
// de sinal (sem coluna tipo/débito/crédito dedicada nem valor já assinado).
function detectarDivergenciaSinal(
  extratoSobra: readonly LinhaExtrato[],
  lancamentosSobra: readonly LancamentoConc[],
): DivergenciaSinal[] {
  const usados = new Array(lancamentosSobra.length).fill(false);
  const divergencias: DivergenciaSinal[] = [];
  for (const linha of extratoSobra) {
    let best = -1, bestDias = Infinity;
    for (let j = 0; j < lancamentosSobra.length; j++) {
      if (usados[j]) continue;
      const l = lancamentosSobra[j];
      if (cents(linha.valor) !== cents(l.valor)) continue;
      if (mesmoSinal(linha.valor, l.valor)) continue; // mesmo sinal já teria casado na trava normal
      const d = diasEntre(linha.data, l.data);
      if (d <= JANELA_DIAS && d < bestDias) { best = j; bestDias = d; }
    }
    if (best >= 0) {
      usados[best] = true;
      divergencias.push({
        data: linha.data,
        valor: Math.abs(linha.valor),
        descricaoExtrato: linha.descricao,
        descricaoLancamento: lancamentosSobra[best].descricao ?? null,
        lancamentoId: lancamentosSobra[best].id,
      });
    }
  }
  return divergencias;
}

/**
 * Duas travas independentes (ambas contam como "faltante", spec ~12:19):
 *
 * 1. Extrato sem classificação — linha do CSV do extrato sem lançamento
 *    correspondente (mesmo valor em centavos + data dentro de ±3 dias) QUE
 *    TENHA CONTA atribuída. Movimento do banco que ainda não foi classificado.
 *
 * 2. Classificado sem extrato — lançamento com fonte_extrato=true (criado a
 *    partir do extrato) sem nenhuma linha do CSV atual correspondente.
 *    Indica lançamento órfão (ex.: CSV reenviado sem aquele movimento).
 *
 * NFs/recibos (fonteExtrato=false) nunca entram na trava 2.
 */
export function detectarFaltantes(args: {
  extrato: LinhaExtrato[];
  lancamentos: LancamentoConc[];
}): Faltantes {
  const { extrato, lancamentos } = args;

  // Trava 1: extrato → lançamento COM conta.
  const usadoLancComConta = new Array(lancamentos.length).fill(false);
  const extratoClassificado = new Array(extrato.length).fill(false);
  for (let i = 0; i < extrato.length; i++) {
    let best = -1, bestDias = Infinity;
    for (let j = 0; j < lancamentos.length; j++) {
      if (usadoLancComConta[j] || !lancamentos[j].contaId) continue;
      if (cents(extrato[i].valor) !== cents(lancamentos[j].valor)) continue;
      if (!mesmoSinal(extrato[i].valor, lancamentos[j].valor)) continue;
      const d = diasEntre(extrato[i].data, lancamentos[j].data);
      if (d <= JANELA_DIAS && d < bestDias) { best = j; bestDias = d; }
    }
    if (best >= 0) { usadoLancComConta[best] = true; extratoClassificado[i] = true; }
  }
  const extrato_sem_classificacao = extrato.filter((_, i) => !extratoClassificado[i]);

  // Trava 2: lançamento fonte_extrato=true → linha do CSV atual (sem exigir conta).
  const usadoExtrato = new Array(extrato.length).fill(false);
  const lancComExtrato = new Array(lancamentos.length).fill(false);
  for (let j = 0; j < lancamentos.length; j++) {
    if (!lancamentos[j].fonteExtrato) continue;
    let best = -1, bestDias = Infinity;
    for (let i = 0; i < extrato.length; i++) {
      if (usadoExtrato[i]) continue;
      if (cents(extrato[i].valor) !== cents(lancamentos[j].valor)) continue;
      if (!mesmoSinal(extrato[i].valor, lancamentos[j].valor)) continue;
      const d = diasEntre(extrato[i].data, lancamentos[j].data);
      if (d <= JANELA_DIAS && d < bestDias) { best = i; bestDias = d; }
    }
    if (best >= 0) { usadoExtrato[best] = true; lancComExtrato[j] = true; }
  }
  const classificado_sem_extrato = lancamentos.filter((l, j) => l.fonteExtrato && !lancComExtrato[j]);

  return {
    extrato_sem_classificacao,
    classificado_sem_extrato,
    faltantes_count: extrato_sem_classificacao.length + classificado_sem_extrato.length,
    divergencias_sinal: detectarDivergenciaSinal(extrato_sem_classificacao, classificado_sem_extrato),
  };
}

// Testes do motor de saldo/faltantes (Conciliação v3). Roda com `deno test`
// (mesmo runtime da Edge Function, sem dependências externas).
import { assertEquals, assertAlmostEquals } from "jsr:@std/assert@1";
import { detectarFaltantes, sinalPorNatureza, validarSaldo, type LancamentoConc, type LinhaExtrato } from "./saldo.ts";

Deno.test("sinalPorNatureza — debito é negativo, credito/null/desconhecido é positivo", () => {
  assertEquals(sinalPorNatureza("debito"), -1);
  assertEquals(sinalPorNatureza("credito"), 1);
  assertEquals(sinalPorNatureza(null), 1);
  assertEquals(sinalPorNatureza(undefined), 1);
  assertEquals(sinalPorNatureza("outra_coisa"), 1);
});

Deno.test("validarSaldo — delta 0.01 confere", () => {
  const r = validarSaldo({
    saldoInicial: 1000,
    saldoFinal: 1099.99,
    extrato: [{ data: "2026-07-05", descricao: "PIX recebido", valor: 100 }],
  });
  // 1000 + 100 = 1100; final informado 1099.99 → delta = -0.01 (dentro da tolerância)
  assertEquals(r.confere, true);
  assertAlmostEquals(r.delta ?? NaN, -0.01, 1e-9);
});

Deno.test("validarSaldo — delta 0.02 não confere", () => {
  const r = validarSaldo({
    saldoInicial: 1000,
    saldoFinal: 1099.98,
    extrato: [{ data: "2026-07-05", descricao: "PIX recebido", valor: 100 }],
  });
  assertEquals(r.confere, false);
  assertAlmostEquals(r.delta ?? NaN, -0.02, 1e-9);
});

Deno.test("validarSaldo — sem saldo inicial/final não confere (trava ativa)", () => {
  const r = validarSaldo({ saldoInicial: null, saldoFinal: null, extrato: [] });
  assertEquals(r.confere, false);
  assertEquals(r.delta, null);
  assertEquals(typeof r.motivo, "string");
});

Deno.test("validarSaldo — movimentação líquida soma valores com sinal", () => {
  const r = validarSaldo({
    saldoInicial: 500,
    saldoFinal: 450,
    extrato: [
      { data: "2026-07-01", descricao: "Recebimento", valor: 200 },
      { data: "2026-07-02", descricao: "Pagamento fornecedor", valor: -250 },
    ],
  });
  assertAlmostEquals(r.movimentacao_liquida, -50, 1e-9);
  assertAlmostEquals(r.saldo_calculado ?? NaN, 450, 1e-9);
  assertEquals(r.confere, true);
});

Deno.test("detectarFaltantes — extrato sem lançamento com conta é faltante", () => {
  const extrato: LinhaExtrato[] = [
    { data: "2026-07-10", descricao: "TARIFA BANCARIA", valor: -25 },
  ];
  const lancamentos: LancamentoConc[] = []; // nada classificado
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.extrato_sem_classificacao.length, 1);
  assertEquals(r.classificado_sem_extrato.length, 0);
  assertEquals(r.faltantes_count, 1);
});

Deno.test("detectarFaltantes — extrato com lançamento SEM conta continua faltante", () => {
  const extrato: LinhaExtrato[] = [
    { data: "2026-07-10", descricao: "TARIFA BANCARIA", valor: -25 },
  ];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-10", valor: -25, contaId: null, fonteExtrato: true },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.extrato_sem_classificacao.length, 1, "sem conta não conta como classificado");
});

Deno.test("detectarFaltantes — match por valor em centavos + data dentro de 3 dias resolve", () => {
  const extrato: LinhaExtrato[] = [
    { data: "2026-07-10", descricao: "TARIFA BANCARIA", valor: -25.5 },
  ];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-12", valor: -25.5, contaId: "conta-1", fonteExtrato: true },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.extrato_sem_classificacao.length, 0);
  assertEquals(r.faltantes_count, 0);
});

Deno.test("detectarFaltantes — data fora da janela de 3 dias não casa", () => {
  const extrato: LinhaExtrato[] = [
    { data: "2026-07-01", descricao: "TARIFA BANCARIA", valor: -25 },
  ];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-10", valor: -25, contaId: "conta-1", fonteExtrato: true },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.extrato_sem_classificacao.length, 1);
});

Deno.test("detectarFaltantes — lancamento fonte_extrato=true sem CSV correspondente é órfão", () => {
  const extrato: LinhaExtrato[] = [];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-10", valor: -25, contaId: "conta-1", fonteExtrato: true },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.classificado_sem_extrato.length, 1);
  assertEquals(r.extrato_sem_classificacao.length, 0);
  assertEquals(r.faltantes_count, 1);
});

Deno.test("detectarFaltantes — NF/recibo (fonte_extrato=false) nunca entra em classificado_sem_extrato", () => {
  const extrato: LinhaExtrato[] = [];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-10", valor: -500, contaId: "conta-1", fonteExtrato: false },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.classificado_sem_extrato.length, 0);
  assertEquals(r.faltantes_count, 0);
});

Deno.test("detectarFaltantes — competência sem faltantes (extrato 100% classificado e coberto)", () => {
  const extrato: LinhaExtrato[] = [
    { data: "2026-07-05", descricao: "PIX recebido", valor: 100 },
    { data: "2026-07-06", descricao: "Pagamento fornecedor", valor: -300 },
  ];
  const lancamentos: LancamentoConc[] = [
    { id: "l1", data: "2026-07-05", valor: 100, contaId: "conta-1", fonteExtrato: true },
    { id: "l2", data: "2026-07-06", valor: -300, contaId: "conta-2", fonteExtrato: true },
  ];
  const r = detectarFaltantes({ extrato, lancamentos });
  assertEquals(r.faltantes_count, 0);
});

Deno.test("validarSaldo + sinalPorNatureza — fallback lancamentos_ia (extrato = lançamentos com valor em módulo) não fica sempre positivo", () => {
  // Espelha o fallback em conciliar/index.ts: lancamentos.valor é sempre módulo
  // (r.valor bruto do banco), natureza_movimento carrega o sinal real.
  const lancamentosBrutos = [
    { valor: 100, natureza: "debito" as const },
    { valor: 50, natureza: "debito" as const },
    { valor: 30, natureza: "credito" as const },
  ];
  const extrato: LinhaExtrato[] = lancamentosBrutos.map((l) => ({
    data: "2026-07-05",
    descricao: "",
    valor: sinalPorNatureza(l.natureza) * l.valor,
  }));
  const r = validarSaldo({ saldoInicial: 1000, saldoFinal: 880, extrato });
  assertEquals(r.movimentacao_liquida, -120);
  assertEquals(r.confere, true);
});

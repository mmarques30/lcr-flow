import { assertEquals } from "jsr:@std/assert@1";
import { avaliarTravaAnalisar, avaliarTravaFinalizar, contarRevisaoPendente, precisaRevisaoLancamento } from "./travas.ts";

Deno.test("precisaRevisaoLancamento — sem conta precisa revisao", () => {
  assertEquals(precisaRevisaoLancamento({ confidence: 0.95, contaId: null }), true);
});

Deno.test("precisaRevisaoLancamento — confianca baixa precisa revisao", () => {
  assertEquals(precisaRevisaoLancamento({ confidence: 0.5, contaId: "c1" }), true);
});

Deno.test("precisaRevisaoLancamento — confianca >= 0.8 com conta nao precisa revisao", () => {
  assertEquals(precisaRevisaoLancamento({ confidence: 0.8, contaId: "c1" }), false);
});

Deno.test("precisaRevisaoLancamento — sem confidence (null) e com conta nao precisa revisao", () => {
  assertEquals(precisaRevisaoLancamento({ confidence: null, contaId: "c1" }), false);
});

Deno.test("contarRevisaoPendente — conta quantos precisam revisao", () => {
  const n = contarRevisaoPendente([
    { confidence: 0.9, contaId: "c1" },
    { confidence: 0.5, contaId: "c2" },
    { confidence: 0.95, contaId: null },
  ]);
  assertEquals(n, 2);
});

Deno.test("avaliarTravaAnalisar — sem extrato bloqueia", () => {
  const r = avaliarTravaAnalisar({ temExtrato: false, revisaoPendente: 0 });
  assertEquals(r.ok, false);
});

Deno.test("avaliarTravaAnalisar — revisao pendente bloqueia", () => {
  const r = avaliarTravaAnalisar({ temExtrato: true, revisaoPendente: 2 });
  assertEquals(r.ok, false);
});

Deno.test("avaliarTravaAnalisar — extrato presente e revisao zerada libera", () => {
  const r = avaliarTravaAnalisar({ temExtrato: true, revisaoPendente: 0 });
  assertEquals(r.ok, true);
});

Deno.test("avaliarTravaFinalizar — revisao pendente bloqueia mesmo com saldo ok", () => {
  const r = avaliarTravaFinalizar({ analisado: true, revisaoPendente: 1, saldoConfere: true, faltantesCount: 0 });
  assertEquals(r.ok, false);
});

Deno.test("avaliarTravaFinalizar — sem analise bloqueia", () => {
  const r = avaliarTravaFinalizar({ analisado: false, revisaoPendente: 0, saldoConfere: null, faltantesCount: 0 });
  assertEquals(r.ok, false);
});

Deno.test("avaliarTravaFinalizar — saldo nao confere bloqueia com motivo", () => {
  const r = avaliarTravaFinalizar({ analisado: true, revisaoPendente: 0, saldoConfere: false, saldoMotivo: "delta 5.00", faltantesCount: 0 });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "delta 5.00");
});

Deno.test("avaliarTravaFinalizar — faltantes > 0 bloqueia", () => {
  const r = avaliarTravaFinalizar({ analisado: true, revisaoPendente: 0, saldoConfere: true, faltantesCount: 3 });
  assertEquals(r.ok, false);
});

Deno.test("avaliarTravaFinalizar — tudo ok libera", () => {
  const r = avaliarTravaFinalizar({ analisado: true, revisaoPendente: 0, saldoConfere: true, faltantesCount: 0 });
  assertEquals(r.ok, true);
});

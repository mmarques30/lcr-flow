import { assertEquals } from "jsr:@std/assert@1";
import { extrairSaldosDeTexto, extrairSaldosDocumento, parseValorBr } from "./extrair-saldo.ts";

Deno.test("parseValorBr — formato BR com milhar e centavos", () => {
  assertEquals(parseValorBr("23.577,98"), 23577.98);
  assertEquals(parseValorBr("0,16"), 0.16);
  assertEquals(parseValorBr("1000.50"), 1000.5);
});

Deno.test("extrairSaldosDeTexto — prosa típica da IA", () => {
  const texto = "Período: 01/01/2026 a 31/01/2026. Saldo inicial: R$ 0,16. Saldo final: R$ 0,47. Total entradas: R$ 23.577,98.";
  const r = extrairSaldosDeTexto(texto);
  assertEquals(r.inicial, 0.16);
  assertEquals(r.final, 0.47);
});

Deno.test("extrairSaldosDeTexto — milhares no saldo", () => {
  const texto = "Saldo inicial: R$ 12.345,67. Saldo final: R$ 10.000,00.";
  const r = extrairSaldosDeTexto(texto);
  assertEquals(r.inicial, 12345.67);
  assertEquals(r.final, 10000);
});

Deno.test("extrairSaldosDeTexto — Santander Saldo anterior/final com data", () => {
  const texto =
    "Extrato Santander Empresas - fevereiro/2026. Saldo anterior (31/01): R$ 0,00. Saldo final (28/02): R$ 25,79. Total de Créditos: R$ 120.806,21.";
  const r = extrairSaldosDeTexto(texto);
  assertEquals(r.inicial, 0);
  assertEquals(r.final, 25.79);
});

Deno.test("extrairSaldosDeTexto — Saldo em DD/MM", () => {
  const r = extrairSaldosDeTexto("Saldo em 31/01 = 0. Saldo em 28/02: 2.579,00");
  assertEquals(r.inicial, 0);
  assertEquals(r.final, 2579);
});

Deno.test("extrairSaldosDocumento — chaves estruturadas têm prioridade", () => {
  const r = extrairSaldosDocumento({ saldo_inicial: 10, saldo_final: 20, dados_extraidos: "Saldo inicial: R$ 1,00. Saldo final: R$ 2,00." });
  assertEquals(r.inicial, 10);
  assertEquals(r.final, 20);
});

Deno.test("extrairSaldosDocumento — fallback na prosa aninhada (OPT-0005)", () => {
  const r = extrairSaldosDocumento({
    conta: "558716615-0",
    dados_extraidos: "Extrato Nubank. Saldo inicial: R$ 0,16. Saldo final: R$ 0,47. Movimentações: 12 PIX.",
  });
  assertEquals(r.inicial, 0.16);
  assertEquals(r.final, 0.47);
});

Deno.test("extrairSaldosDocumento — lê prosa em classificacao_ia string", () => {
  const r = extrairSaldosDocumento(
    { observacoes: "sem saldo aqui" },
    "Saldo inicial: R$ 100,00. Saldo final: R$ 80,50.",
  );
  assertEquals(r.inicial, 100);
  assertEquals(r.final, 80.5);
});

Deno.test("extrairSaldosDocumento — JSON stringificado com chaves", () => {
  const r = extrairSaldosDocumento({
    dados_extraidos: JSON.stringify({ saldo_inicial: 16161.72, saldo_final: 36060 }),
  });
  assertEquals(r.inicial, 16161.72);
  assertEquals(r.final, 36060);
});

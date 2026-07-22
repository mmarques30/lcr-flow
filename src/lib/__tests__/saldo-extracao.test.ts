import { describe, expect, it } from "vitest";
import { extrairSaldosDeTexto, extrairSaldosDocumento, parseValorBr } from "../saldo-extracao";

describe("saldo-extracao", () => {
  it("parseValorBr entende formato BR", () => {
    expect(parseValorBr("23.577,98")).toBe(23577.98);
    expect(parseValorBr("0,16")).toBe(0.16);
  });

  it("extrai saldos da prosa da IA (OPT-0005)", () => {
    const r = extrairSaldosDeTexto(
      "Saldo inicial: R$ 0,16. Saldo final: R$ 0,47. Total entradas: R$ 23.577,98.",
    );
    expect(r.inicial).toBe(0.16);
    expect(r.final).toBe(0.47);
  });

  it("extrai Saldo anterior/final com data entre parênteses (Santander)", () => {
    const r = extrairSaldosDeTexto(
      "Extrato Santander. Saldo anterior (31/01): R$ 0,00. Saldo final (28/02): R$ 25,79. Total de Créditos: R$ 120.806,21.",
    );
    expect(r.inicial).toBe(0);
    expect(r.final).toBe(25.79);
  });

  it("extrai Saldo em DD/MM (padrão visual do extrato)", () => {
    const r = extrairSaldosDeTexto("Saldo em 31/01 = 0. Saldo em 28/02: 2.579,00");
    expect(r.inicial).toBe(0);
    expect(r.final).toBe(2579);
  });

  it("extrai 'saldo final é R$' e 'saldo anterior zero'", () => {
    const r = extrairSaldosDeTexto(
      "O saldo inicial não aparece, mas saldo anterior zero e o saldo final é R$ 22,15.",
    );
    expect(r.inicial).toBe(0);
    expect(r.final).toBe(22.15);
  });

  it("usa chaves estruturadas quando existem", () => {
    const r = extrairSaldosDocumento({ saldo_inicial: 10, saldo_final: 20 });
    expect(r).toEqual({ inicial: 10, final: 20 });
  });

  it("faz fallback na prosa aninhada em dados_extraidos", () => {
    const r = extrairSaldosDocumento({
      dados_extraidos: "Extrato. Saldo inicial: R$ 1.234,56. Saldo final: R$ 900,00.",
    });
    expect(r.inicial).toBe(1234.56);
    expect(r.final).toBe(900);
  });

  it("lê chaves dentro de JSON stringificado", () => {
    const r = extrairSaldosDocumento({
      dados_extraidos: JSON.stringify({ saldo_inicial: 16161.72, saldo_final: 36060 }),
    });
    expect(r.inicial).toBe(16161.72);
    expect(r.final).toBe(36060);
  });
});

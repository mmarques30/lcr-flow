import { describe, expect, it } from "vitest";
import { bancoCodigoDe, ehBancoPlaceholder, melhorContaBancaria, resolverContaAnalitica, type PdcTC } from "./sci-xls";

describe("ehBancoPlaceholder", () => {
  it("trata string vazia, null e undefined como placeholder", () => {
    expect(ehBancoPlaceholder("")).toBe(true);
    expect(ehBancoPlaceholder(null)).toBe(true);
    expect(ehBancoPlaceholder(undefined)).toBe(true);
  });

  it('trata "N/A" (com variações de caixa/espaço) como placeholder', () => {
    expect(ehBancoPlaceholder("N/A")).toBe(true);
    expect(ehBancoPlaceholder(" n/a ")).toBe(true);
  });

  it('reconhece os placeholders reais conhecidos ("Não identificado", "Desconhecido", etc.)', () => {
    expect(ehBancoPlaceholder("Não identificado")).toBe(true);
    expect(ehBancoPlaceholder("Banco não especificado")).toBe(true);
    expect(ehBancoPlaceholder("Desconhecido")).toBe(true);
    expect(ehBancoPlaceholder("Banco não informado")).toBe(true);
  });

  it("não marca um nome de banco real como placeholder", () => {
    expect(ehBancoPlaceholder("Itaú")).toBe(false);
    expect(ehBancoPlaceholder("Banco Inter")).toBe(false);
    expect(ehBancoPlaceholder("Bradesco")).toBe(false);
  });

  it('reconhece "não disponível"/"não explícito" como placeholder (achado auditoria 21/07, cliente PLENUS)', () => {
    expect(ehBancoPlaceholder("Informação não disponível no documento")).toBe(true);
    expect(ehBancoPlaceholder("Banco não explícito (conta com rendimentos de aplicação automática)")).toBe(true);
  });
});

describe("melhorContaBancaria", () => {
  it("retorna null para lista vazia", () => {
    expect(melhorContaBancaria([])).toBeNull();
  });

  it("quando só há placeholders, cai no mais recente mesmo assim", () => {
    const contas = [
      { id: "1", banco: "Não identificado", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", banco: "N/A", created_at: "2026-03-01T00:00:00Z" },
    ];
    expect(melhorContaBancaria(contas)?.id).toBe("2");
  });

  it("bug 21/07 (Cultive): prioriza o banco real mais novo sobre o placeholder mais antigo", () => {
    const contas = [
      { id: "1", banco: "Não identificado", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", banco: "Banco Inter", created_at: "2026-03-01T00:00:00Z" },
    ];
    expect(melhorContaBancaria(contas)?.id).toBe("2");
  });

  it("entre dois bancos reais, escolhe o de created_at mais recente independente da ordem de chegada", () => {
    const maisNovoPrimeiro = [
      { id: "novo", banco: "Banco Inter", created_at: "2026-05-01T00:00:00Z" },
      { id: "antigo", banco: "Itaú", created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(melhorContaBancaria(maisNovoPrimeiro)?.id).toBe("novo");

    const maisAntigoPrimeiro = [
      { id: "antigo", banco: "Itaú", created_at: "2026-01-01T00:00:00Z" },
      { id: "novo", banco: "Banco Inter", created_at: "2026-05-01T00:00:00Z" },
    ];
    expect(melhorContaBancaria(maisAntigoPrimeiro)?.id).toBe("novo");
  });

  it("empate de created_at é resolvido de forma determinística por id (fix code review 20/07)", () => {
    const ordemA = [
      { id: "b", banco: "Bradesco", created_at: "2026-01-01T00:00:00Z" },
      { id: "a", banco: "Itaú", created_at: "2026-01-01T00:00:00Z" },
    ];
    const ordemB = [
      { id: "a", banco: "Itaú", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", banco: "Bradesco", created_at: "2026-01-01T00:00:00Z" },
    ];
    // O resultado não pode depender da ordem de chegada do array.
    expect(melhorContaBancaria(ordemA)?.id).toBe(melhorContaBancaria(ordemB)?.id);
  });
});

describe("bancoCodigoDe", () => {
  it('resolve "Itaú" (com acento) para o código 657', () => {
    expect(bancoCodigoDe("Itaú")).toBe(657);
  });

  it("é tolerante a variações de caixa e espaço", () => {
    expect(bancoCodigoDe("BRADESCO S.A.")).toBe(9);
    expect(bancoCodigoDe("  santander  ")).toBe(10);
  });

  it("retorna null para banco não mapeado", () => {
    expect(bancoCodigoDe("Banco Qualquer Não Mapeado")).toBeNull();
    expect(bancoCodigoDe(null)).toBeNull();
    expect(bancoCodigoDe(undefined)).toBeNull();
  });

  it('não confunde "PagSeguro Internet S/A" com Banco Inter (achado auditoria 21/07, cliente VITALENTO)', () => {
    expect(bancoCodigoDe("PagSeguro Internet S/A")).toBe(946);
  });

  it("resolve os bancos adicionados na auditoria de 21/07 (Safra, Cora, Mercado Pago, Wise, BS2, Afinz, Nu Pagamentos)", () => {
    expect(bancoCodigoDe("Banco Safra S/A")).toBe(818);
    expect(bancoCodigoDe("Cora SCFI")).toBe(917);
    expect(bancoCodigoDe("Mercado Pago")).toBe(960);
    expect(bancoCodigoDe("Wise Payments Ltd.")).toBe(1292);
    expect(bancoCodigoDe("BS2 S.A.")).toBe(830);
    expect(bancoCodigoDe("Banco Afinz S.A.")).toBe(1197);
    expect(bancoCodigoDe("NU PAGAMENTOS S.A.")).toBe(821);
  });

  it('resolve "Banco 208" para BTG Pactual (código COMPE oficial, achado auditoria 21/07)', () => {
    expect(bancoCodigoDe("Banco 208")).toBe(1031);
  });

  it("aceita um mapa de apelidos customizado (ex. vindo da tabela bancos_apelidos_lcr)", () => {
    expect(bancoCodigoDe("Cooperativa XYZ", { cooperativa: 999 })).toBe(999);
    expect(bancoCodigoDe("Banco Qualquer", { bradesco: 9 })).toBeNull();
  });

  it('critério "alias mais longo vence" resolve a colisão PagSeguro/Inter independente da ordem do mapa', () => {
    // "inter" (5 chars) casa por acidente dentro de "internet"; "pagseguro"
    // (9 chars) é o match correto e mais longo — tem que vencer mesmo se
    // "inter" vier primeiro no objeto (ordem de iteração não é confiável
    // quando os apelidos vêm de uma tabela sem ORDER BY garantido).
    const apelidosInterPrimeiro = { inter: 658, pagseguro: 946 };
    expect(bancoCodigoDe("PagSeguro Internet S/A", apelidosInterPrimeiro)).toBe(946);
  });
});

describe("resolverContaAnalitica", () => {
  const pdc: PdcTC[] = [
    { codigo: 29, classificacao: "01.1.2.07", tipo: "T" },
    { codigo: 20, classificacao: "01.1.2.07.001", tipo: "analitica" },
    { codigo: 1170, classificacao: "02.1.1.05", tipo: "C" },
    { codigo: 1172, classificacao: "02.1.1.05.002", tipo: "analitica" },
    { codigo: 1173, classificacao: "02.1.1.05.003", tipo: "analitica" },
    { codigo: 999, classificacao: "03.9.9.99", tipo: "T" },
    { codigo: 50, classificacao: "04.1.1.01", tipo: "analitica" },
  ];

  it("conta T com uma única filha analítica resolve para a filha", () => {
    expect(resolverContaAnalitica(29, pdc)).toEqual({ status: "resolvido", codigoResolvido: 20 });
  });

  it("conta C (consolidada) com múltiplas filhas é ambígua — bug do 20/07, antes só T era tratado", () => {
    const r = resolverContaAnalitica(1170, pdc);
    expect(r.status).toBe("ambigua");
    expect(r.status === "ambigua" && r.candidatos).toEqual([1172, 1173]);
  });

  it("conta analítica direta não sofre nenhuma resolução", () => {
    expect(resolverContaAnalitica(50, pdc)).toEqual({ status: "analitica" });
  });

  it("conta T/C sem nenhuma filha cadastrada retorna sem_filha", () => {
    expect(resolverContaAnalitica(999, pdc)).toEqual({ status: "sem_filha" });
  });

  it("código inexistente no plano de contas retorna analitica (sem dado para resolver)", () => {
    expect(resolverContaAnalitica(123456, pdc)).toEqual({ status: "analitica" });
  });
});

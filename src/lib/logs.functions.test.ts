import { describe, expect, it } from "vitest";
import { calcularTempoRevisaoSci, mediaTempoRevisaoSci, type LogRow } from "./logs.functions";

function log(acao: string, criado_em: string, cliente_id: string | null = "c1"): LogRow {
  return {
    id: `${acao}-${criado_em}`,
    user_id: "u1",
    cliente_id,
    acao,
    tela: null,
    detalhes: {},
    criado_em,
  };
}

describe("calcularTempoRevisaoSci", () => {
  it("soma a duração ativa entre eventos consecutivos até o gerou_sci", () => {
    const logs = [
      log("abriu_conciliacao", "2026-07-01T10:00:00Z"),
      log("analisou_divergencias", "2026-07-01T10:03:00Z"), // +3min
      log("finalizou_conciliacao", "2026-07-01T10:05:00Z"), // +2min
      log("gerou_sci", "2026-07-01T10:06:00Z"), // +1min
    ];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(1);
    expect(processos[0].cliente_id).toBe("c1");
    expect(processos[0].inicio).toBe("2026-07-01T10:00:00Z");
    expect(processos[0].fim).toBe("2026-07-01T10:06:00Z");
    expect(processos[0].duracao_ativa_ms).toBe(6 * 60_000);
  });

  it("pausa a contagem (não soma) quando o gap entre eventos é > 5min", () => {
    const logs = [
      log("abriu_conciliacao", "2026-07-01T10:00:00Z"),
      log("analisou_divergencias", "2026-07-01T10:02:00Z"), // +2min (conta)
      // gap de 20min — usuário ficou com a aba aberta sem fazer nada
      log("finalizou_conciliacao", "2026-07-01T10:22:00Z"),
      log("gerou_sci", "2026-07-01T10:23:00Z"), // +1min (conta)
    ];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(1);
    // início reinicia no evento pós-pausa; só os gaps <=5min entram na soma
    expect(processos[0].inicio).toBe("2026-07-01T10:22:00Z");
    expect(processos[0].duracao_ativa_ms).toBe(1 * 60_000);
  });

  it("ignora eventos sem cliente_id e ações fora do escopo de revisão/SCI", () => {
    const logs = [
      log("abriu_conciliacao", "2026-07-01T10:00:00Z"),
      log("perguntou_cerebro", "2026-07-01T10:01:00Z"), // fora do escopo
      log("gerou_sci", "2026-07-01T10:02:00Z", null), // sem cliente — descartado
      log("gerou_sci", "2026-07-01T10:03:00Z"),
    ];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(1);
    expect(processos[0].duracao_ativa_ms).toBe(3 * 60_000);
  });

  it("gera um processo por cliente distinto, independentemente da ordem de chegada", () => {
    const logs = [
      log("abriu_conciliacao", "2026-07-01T10:00:00Z", "c2"),
      log("abriu_conciliacao", "2026-07-01T10:00:00Z", "c1"),
      log("gerou_sci", "2026-07-01T10:05:00Z", "c1"),
      log("analisou_divergencias", "2026-07-01T10:08:00Z", "c2"),
      log("gerou_sci", "2026-07-01T10:10:00Z", "c2"),
    ];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(2);
    const porCliente = new Map(processos.map((p) => [p.cliente_id, p]));
    expect(porCliente.get("c1")?.duracao_ativa_ms).toBe(5 * 60_000);
    // c2: gap abriu(10:00)->analisou(10:08) = 8min > 5min → pausa (não soma,
    // bloco reinicia em 10:08); gap analisou(10:08)->gerou_sci(10:10) = 2min → soma.
    expect(porCliente.get("c2")?.duracao_ativa_ms).toBe(2 * 60_000);
  });

  it("um gap grande entre o último evento e o gerou_sci não conta como tempo ativo", () => {
    const logs = [
      log("abriu_conciliacao", "2026-07-01T10:00:00Z"),
      log("gerou_sci", "2026-07-01T10:10:00Z"), // +10min — pausa, não soma
    ];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(1);
    expect(processos[0].duracao_ativa_ms).toBe(0);
  });

  it("um gerou_sci isolado (sem eventos anteriores no período) fica com duração 0", () => {
    const logs = [log("gerou_sci", "2026-07-01T10:00:00Z")];
    const processos = calcularTempoRevisaoSci(logs);
    expect(processos).toHaveLength(1);
    expect(processos[0].duracao_ativa_ms).toBe(0);
  });
});

describe("mediaTempoRevisaoSci", () => {
  it("retorna 0 quando não há processos", () => {
    expect(mediaTempoRevisaoSci([])).toBe(0);
  });

  it("ignora processos com duração 0 (sem sinal) no cálculo da média", () => {
    const processos = [
      { cliente_id: "c1", inicio: "a", fim: "b", duracao_ativa_ms: 0 },
      { cliente_id: "c2", inicio: "a", fim: "b", duracao_ativa_ms: 10 * 60_000 },
      { cliente_id: "c3", inicio: "a", fim: "b", duracao_ativa_ms: 20 * 60_000 },
    ];
    expect(mediaTempoRevisaoSci(processos)).toBe(15 * 60_000);
  });
});

import { assertEquals } from "jsr:@std/assert@1";
import { filtrarJanelaCompetencia } from "./janela-competencia.ts";

Deno.test("filtrarJanelaCompetencia — descarta dia 1 do mes seguinte (bug #139)", () => {
  const itens = [
    { data_lancamento: "2026-06-05" },
    { data_lancamento: "2026-06-30" },
    { data_lancamento: "2026-07-01" }, // "próximos lançamentos" — deve cair
    { data_lancamento: "2026-07-01" },
  ];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-06");
  assertEquals(mantidos.length, 2);
  assertEquals(descartados, 2);
});

Deno.test("filtrarJanelaCompetencia — mantem 1 mes antes (compras antigas em fatura)", () => {
  const itens = [
    { data_lancamento: "2026-05-31" },
    { data_lancamento: "2026-06-15" },
  ];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-06");
  assertEquals(mantidos.length, 2);
  assertEquals(descartados, 0);
});

Deno.test("filtrarJanelaCompetencia — descarta 2+ meses antes e depois", () => {
  const itens = [
    { data_lancamento: "2026-04-30" }, // 2 meses antes
    { data_lancamento: "2026-08-01" }, // 2 meses depois
    { data_lancamento: "2026-06-10" },
  ];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-06");
  assertEquals(mantidos.length, 1);
  assertEquals(mantidos[0].data_lancamento, "2026-06-10");
  assertEquals(descartados, 2);
});

Deno.test("filtrarJanelaCompetencia — item sem data valida sempre passa", () => {
  const itens = [{ data_lancamento: null }, { data_lancamento: "" }, {}];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-06");
  assertEquals(mantidos.length, 3);
  assertEquals(descartados, 0);
});

Deno.test("filtrarJanelaCompetencia — competencia invalida e no-op", () => {
  const itens = [{ data_lancamento: "2026-07-01" }, { data_lancamento: "2020-01-01" }];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "invalida");
  assertEquals(mantidos.length, 2);
  assertEquals(descartados, 0);
});

Deno.test("filtrarJanelaCompetencia — robusto a virada dez/jan", () => {
  const itens = [
    { data_lancamento: "2025-12-31" }, // 1 mes antes de jan/2026
    { data_lancamento: "2026-01-15" },
    { data_lancamento: "2026-02-01" }, // 1 mes depois — deve cair
  ];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-01");
  assertEquals(mantidos.length, 2);
  assertEquals(descartados, 1);
});

Deno.test("filtrarJanelaCompetencia — opts customizados (meses_depois > 0)", () => {
  const itens = [{ data_lancamento: "2026-07-01" }];
  const { mantidos, descartados } = filtrarJanelaCompetencia(itens, "2026-06", { mesesDepois: 1 });
  assertEquals(mantidos.length, 1);
  assertEquals(descartados, 0);
});

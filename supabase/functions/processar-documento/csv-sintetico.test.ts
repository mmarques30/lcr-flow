import { assertEquals } from "jsr:@std/assert@1";
import { montarCsvSintetico } from "./csv-sintetico.ts";

Deno.test("montarCsvSintetico — header + linhas no formato data;descricao;valor;tipo", () => {
  const csv = montarCsvSintetico([
    { data_lancamento: "2026-03-01", descricao: "Pagamento fornecedor", valor: 250.5, natureza_movimento: "debito" },
    { data_lancamento: "2026-03-02", descricao: "Recebimento cliente", valor: 1000, natureza_movimento: "credito" },
  ]);
  const linhas = csv.split("\n");
  assertEquals(linhas[0], "data;descricao;valor;tipo");
  assertEquals(linhas[1], "2026-03-01;Pagamento fornecedor;250.50;debito");
  assertEquals(linhas[2], "2026-03-02;Recebimento cliente;1000.00;credito");
});

Deno.test("montarCsvSintetico — valor sempre em módulo (sinal só na coluna tipo)", () => {
  const csv = montarCsvSintetico([
    { data_lancamento: "2026-03-01", descricao: "x", valor: -250.5, natureza_movimento: "debito" },
  ]);
  assertEquals(csv.split("\n")[1], "2026-03-01;x;250.50;debito");
});

Deno.test("montarCsvSintetico — sem lançamentos gera só o header (extrato.length=0 downstream)", () => {
  assertEquals(montarCsvSintetico([]), "data;descricao;valor;tipo");
});

Deno.test("montarCsvSintetico — escapa ; na descrição (evita quebrar colunas)", () => {
  const csv = montarCsvSintetico([
    { data_lancamento: "2026-03-01", descricao: "Pix; ref 123", valor: 10, natureza_movimento: "credito" },
  ]);
  assertEquals(csv.split("\n")[1], "2026-03-01;Pix, ref 123;10.00;credito");
});

Deno.test("montarCsvSintetico — natureza_movimento null preserva valor positivo (tipo vazio)", () => {
  const csv = montarCsvSintetico([
    { data_lancamento: "2026-03-01", descricao: "x", valor: 10, natureza_movimento: null },
  ]);
  assertEquals(csv.split("\n")[1], "2026-03-01;x;10.00;");
});

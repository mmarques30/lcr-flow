import { assertEquals } from "jsr:@std/assert@1";
import { parseCsvComSinal } from "./parse-csv-sinal.ts";

Deno.test("parseCsvComSinal — coluna tipo dedicada é sinal explícito", () => {
  const csv = "data;descricao;valor;tipo\n2026-07-10;PIX enviado;100,00;debito\n2026-07-11;PIX recebido;50,00;credito";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas.length, 2);
  assertEquals(linhas[0], { data: "2026-07-10", valorAbs: 100, sinal: -1, sinalExplicito: true });
  assertEquals(linhas[1], { data: "2026-07-11", valorAbs: 50, sinal: 1, sinalExplicito: true });
});

Deno.test("parseCsvComSinal — colunas débito/crédito separadas são sinal explícito", () => {
  const csv = "data;descricao;debito;credito\n2026-07-10;Pagamento boleto;200,00;\n2026-07-11;Recebimento cliente;;300,00";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas.length, 2);
  assertEquals(linhas[0], { data: "2026-07-10", valorAbs: 200, sinal: -1, sinalExplicito: true });
  assertEquals(linhas[1], { data: "2026-07-11", valorAbs: 300, sinal: 1, sinalExplicito: true });
});

Deno.test("parseCsvComSinal — valor já assinado (menos literal) é sinal explícito", () => {
  const csv = "data;descricao;valor\n2026-07-10;Débito diversos;-150,00\n2026-07-11;Crédito diversos;80,00";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas[0], { data: "2026-07-10", valorAbs: 150, sinal: -1, sinalExplicito: true });
  assertEquals(linhas[1], { data: "2026-07-11", valorAbs: 80, sinal: 1, sinalExplicito: false });
});

Deno.test("parseCsvComSinal — valor com parênteses (contábil) é sinal explícito", () => {
  const csv = "data;descricao;valor\n2026-07-10;Tarifa;(25,00)";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas[0], { data: "2026-07-10", valorAbs: 25, sinal: -1, sinalExplicito: true });
});

Deno.test("parseCsvComSinal — só valor positivo sem coluna de apoio é ambíguo (sinalExplicito=false)", () => {
  const csv = "data;descricao;valor\n2026-07-10;Movimentação diversa;100,00";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas[0].sinalExplicito, false);
  assertEquals(linhas[0].valorAbs, 100);
});

Deno.test("parseCsvComSinal — ignora linhas de saldo mesmo com coluna tipo", () => {
  const csv = "data;descricao;valor;tipo\n2026-07-01;Saldo anterior;1000,00;saldo\n2026-07-10;PIX enviado;100,00;debito";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].data, "2026-07-10");
});

Deno.test("parseCsvComSinal — CSV sem cabeçalho (posicional) ainda extrai valor absoluto", () => {
  const csv = "2026-07-10,Compra no débito,100.50\n2026-07-11,Recebimento,200.00";
  const linhas = parseCsvComSinal(csv, 2026);
  assertEquals(linhas.length, 2);
  assertEquals(linhas[0].valorAbs, 100.5);
  assertEquals(linhas[0].sinalExplicito, false);
});

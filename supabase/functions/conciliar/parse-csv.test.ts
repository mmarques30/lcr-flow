import { assertEquals } from "jsr:@std/assert@1";
import { formatoBinarioDetectado, parseCsv, parseData, parseValor, sanitizeTexto, sinalPorTipo } from "./parse-csv.ts";

Deno.test("sanitizeTexto — remove NUL bytes intercalados (UTF-16 lido como UTF-8)", () => {
  const corrompido = "A\u0000L\u0000O\u0000;1\u0000,\u000000\u0000\n";
  const limpo = sanitizeTexto(corrompido);
  assertEquals(limpo.includes("\u0000"), false);
  assertEquals(limpo, "ALO;1,00\n");
});

Deno.test("sanitizeTexto — preserva tab/LF/CR, remove outros controles", () => {
  assertEquals(sanitizeTexto("a\tb\nc\rd\u0001e"), "a\tb\nc\rde");
});

Deno.test("parseCsv — extrato com NUL bytes (bug real: 'unsupported Unicode escape sequence') não quebra e produz descrição legível", () => {
  const csv = "DATA;DESCRIÇÃO;VALOR\n\u000001\u0000/\u000003\u0000/\u00002026\u0000;\u0000PIX\u0000 \u0000RECEBIDO\u0000;\u0000100\u0000,\u000000\u0000\n";
  const linhas = parseCsv(csv, 2026);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].descricao, "PIX RECEBIDO");
  assertEquals(linhas[0].valor, 100);
  assertEquals(linhas[0].data, "2026-03-01");
});

Deno.test("parseCsv — CSV normal (sem corrupção) continua funcionando", () => {
  const csv = "DATA;DESCRIÇÃO;VALOR\n05/03/2026;Pagamento fornecedor;-250,50\n06/03/2026;Recebimento cliente;1000,00\n";
  const linhas = parseCsv(csv, 2026);
  assertEquals(linhas.length, 2);
  assertEquals(linhas[0].valor, -250.5);
  assertEquals(linhas[1].valor, 1000);
});

Deno.test("parseValor — formatos BR (vírgula decimal, milhar com ponto)", () => {
  assertEquals(parseValor("1.234,56"), 1234.56);
  assertEquals(parseValor("-10,00"), -10);
  assertEquals(parseValor("(10,00)"), -10);
});

Deno.test("parseData — dd/mm/aaaa e fallback de ano", () => {
  assertEquals(parseData("05/03/2026", 2026), "2026-03-05");
  assertEquals(parseData("05/03", 2026), "2026-03-05");
  assertEquals(parseData("", 2026), null);
});

Deno.test("formatoBinarioDetectado — reconhece PDF (extrato enviado como PDF, não CSV)", () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
  assertEquals(formatoBinarioDetectado(pdfBytes), "PDF");
});

Deno.test("formatoBinarioDetectado — reconhece XLSX (zip) e XLS legado", () => {
  assertEquals(formatoBinarioDetectado(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "XLSX/ZIP");
  assertEquals(formatoBinarioDetectado(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "XLS (binário legado)");
});

Deno.test("formatoBinarioDetectado — CSV de texto normal não é detectado como binário", () => {
  const csvBytes = new TextEncoder().encode("DATA;DESCRIÇÃO;VALOR\n05/03/2026;Pagamento;10,00\n");
  assertEquals(formatoBinarioDetectado(csvBytes), null);
});

Deno.test("sinalPorTipo — reconhece débito/crédito (com e sem acento) e variantes", () => {
  assertEquals(sinalPorTipo("debito"), -1);
  assertEquals(sinalPorTipo("Débito"), -1);
  assertEquals(sinalPorTipo("D"), -1);
  assertEquals(sinalPorTipo("saida"), -1);
  assertEquals(sinalPorTipo("credito"), 1);
  assertEquals(sinalPorTipo("Crédito"), 1);
  assertEquals(sinalPorTipo("C"), 1);
  assertEquals(sinalPorTipo("entrada"), 1);
  assertEquals(sinalPorTipo("PIX"), 0);
  assertEquals(sinalPorTipo(""), 0);
});

Deno.test("parseCsv — formato Python/IA (valor sempre em módulo + coluna tipo) reaplica o sinal correto", () => {
  // Espelha bridge_front.montar_csv_extrato: "data;descricao;valor;tipo", valor
  // sempre positivo, sinal só na coluna tipo.
  const csv = "data;descricao;valor;tipo\n01/03/2026;Pagamento fornecedor;250,50;debito\n02/03/2026;Recebimento cliente;1000,00;credito\n";
  const linhas = parseCsv(csv, 2026);
  assertEquals(linhas.length, 2);
  assertEquals(linhas[0].valor, -250.5);
  assertEquals(linhas[1].valor, 1000);
});

Deno.test("parseCsv — movimentação líquida do formato Python/IA não fica sempre positiva", () => {
  const csv = "data;descricao;valor;tipo\n01/03/2026;Saída 1;100,00;debito\n02/03/2026;Saída 2;50,00;debito\n03/03/2026;Entrada 1;30,00;credito\n";
  const linhas = parseCsv(csv, 2026);
  const movimentacaoLiquida = linhas.reduce((s, l) => s + l.valor, 0);
  assertEquals(movimentacaoLiquida, -120);
});

Deno.test("parseCsv — coluna tipo com valor não reconhecido não altera o sinal já parseado", () => {
  const csv = "data;descricao;valor;tipo\n01/03/2026;Pix recebido;-100,00;PIX\n";
  const linhas = parseCsv(csv, 2026);
  assertEquals(linhas[0].valor, -100);
});

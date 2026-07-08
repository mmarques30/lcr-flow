// Testes do dedup por identidade do edge processar-documento.
// Rodar: `deno test supabase/functions/processar-documento/dedup.test.ts`
import { assertEquals } from "jsr:@std/assert@1";
import {
  _ehInvestimentoNome,
  chaveExtrato,
  _normConta,
  _sobreposicao,
  chaveDedupParaDoc,
  deveMarcarDuplicata,
  dedupIntraDocumento,
  OVERLAP_MIN_DEDUP,
} from "./dedup.ts";

Deno.test("_ehInvestimentoNome detecta termos de investimento no nome", () => {
  assertEquals(_ehInvestimentoNome("posicao-cdb.pdf"), true);
  assertEquals(_ehInvestimentoNome("Extrato Posição Investimentos.pdf"), true);
  assertEquals(_ehInvestimentoNome("Aplicação Renda Fixa Jun.xlsx"), true);
  assertEquals(_ehInvestimentoNome("CDB Banco X.pdf"), true);
  // Extrato de conta corrente comum NÃO é investimento.
  assertEquals(_ehInvestimentoNome("extrato-junho.pdf"), false);
  assertEquals(_ehInvestimentoNome("Extrato CC 33033-2.pdf"), false);
  assertEquals(_ehInvestimentoNome(null), false);
});

Deno.test("_normConta remove dígito verificador e zeros à esquerda", () => {
  assertEquals(_normConta("0033033-2"), "33033");
  assertEquals(_normConta("33033-2"), "33033");
  assertEquals(_normConta("33033"), "33033"); // IA já soltou o DV
  assertEquals(_normConta(""), null);
});

Deno.test("chaveExtrato monta agencia|conta|mês (campos estruturados)", () => {
  const c = { agencia: "4465", conta: "33033-2" };
  assertEquals(chaveExtrato(c, "2026-06"), "4465|33033|2026-06");
});

Deno.test("chaveExtrato: fallback ao dados_extraidos (string JSON) e null sem agência/conta", () => {
  const c = { dados_extraidos: JSON.stringify({ agencia: "0044", conta: "12345-6" }) };
  assertEquals(chaveExtrato(c, "2026-06"), "44|12345|2026-06");
  assertEquals(chaveExtrato({ agencia: "4465" }, "2026-06"), null); // sem conta
  assertEquals(chaveExtrato({ agencia: "4465", conta: "1" }, "2026"), null); // competência inválida
});

Deno.test("_sobreposicao: mesmo conjunto ~1.0, disjunto 0", () => {
  const cc = [
    { data_lancamento: "2026-06-01", valor: 100 },
    { data_lancamento: "2026-06-05", valor: -50 },
  ];
  assertEquals(_sobreposicao(cc, cc), 1);
  const outro = [
    { data_lancamento: "2026-06-02", valor: 999 },
    { data_lancamento: "2026-06-09", valor: 777 },
  ];
  assertEquals(_sobreposicao(cc, outro), 0);
});

// ─────────── #4: investimento fora do dedup por identidade ───────────
Deno.test("#4 CDB nomeado 'posicao-cdb.pdf' NÃO entra no dedup (chave null)", () => {
  // Mesmo tipado como extrato bancário pela IA, o nome de investimento tira do dedup.
  const cdb = { agencia: "4465", conta: "33033-2" };
  assertEquals(chaveDedupParaDoc(true, "posicao-cdb.pdf", cdb, "2026-06"), null);
});

Deno.test("CC comum entra no dedup (chave computada)", () => {
  const cc = { agencia: "4465", conta: "33033-2" };
  assertEquals(chaveDedupParaDoc(true, "Extrato CC Junho.pdf", cc, "2026-06"), "4465|33033|2026-06");
});

Deno.test("não-extrato-bancário (fatura) nunca deduplica", () => {
  const c = { agencia: "4465", conta: "33033-2" };
  assertEquals(chaveDedupParaDoc(false, "fatura-cartao.pdf", c, "2026-06"), null);
});

Deno.test("(a) CDB de nome genérico + CC mesmo mês → nenhum marcado duplicata", () => {
  // Cenário do reviewer: CDB sobe como 'extrato-junho.pdf' (nome genérico) → cai no
  // chaveDedup e depende do backstop de sobreposição. Como as transações do CDB não
  // batem com as da CC, o overlap fica abaixo do mínimo → NÃO marca duplicata.
  const ccLancs = [
    { data_lancamento: "2026-06-01", valor: 1000 },
    { data_lancamento: "2026-06-10", valor: -250 },
    { data_lancamento: "2026-06-20", valor: 80 },
  ];
  const cdbLancs = [
    { data_lancamento: "2026-06-15", valor: 50000 }, // aplicação — não bate com a CC
    { data_lancamento: "2026-06-30", valor: 123 },
  ];
  const chave = chaveDedupParaDoc(true, "extrato-junho.pdf", { agencia: "4465", conta: "33033-2" }, "2026-06");
  // A chave existe (nome genérico), mas a decisão final de marcar duplicata é falsa.
  assertEquals(chave === null, false);
  assertEquals(deveMarcarDuplicata(chave, true, ccLancs, cdbLancs), false);
});

Deno.test("(b) mesmo extrato reprocessado → marcado duplicata", () => {
  const lancs = [
    { data_lancamento: "2026-06-01", valor: 1000 },
    { data_lancamento: "2026-06-10", valor: -250 },
    { data_lancamento: "2026-06-20", valor: 80 },
  ];
  const chave = chaveDedupParaDoc(true, "Extrato CC Junho.pdf", { agencia: "4465", conta: "33033-2" }, "2026-06");
  assertEquals(deveMarcarDuplicata(chave, true, lancs, lancs), true);
});

Deno.test("deveMarcarDuplicata: sem original ou sem razão no original → falso", () => {
  const lancs = [{ data_lancamento: "2026-06-01", valor: 100 }];
  assertEquals(deveMarcarDuplicata("4465|33033|2026-06", false, lancs, lancs), false); // sem original
  assertEquals(deveMarcarDuplicata("4465|33033|2026-06", true, [], lancs), false); // original sem razão
  assertEquals(deveMarcarDuplicata(null, true, lancs, lancs), false); // sem chave (investimento)
});

Deno.test("dedupIntraDocumento remove repetidas mesma data+valor", () => {
  const items = [
    { data_lancamento: "2026-06-01", valor: 1443.0, descricao: "PIX recebido" },
    { data_lancamento: "2026-06-01", valor: 1443.0, descricao: "PIX recebido dup" },
    { data_lancamento: "2026-06-02", valor: 100 },
  ];
  const out = dedupIntraDocumento(items);
  assertEquals(out.length, 2);
  assertEquals(out[0].valor, 1443);
  assertEquals(out[1].valor, 100);
});

Deno.test("limiar de overlap coerente com OVERLAP_MIN_DEDUP", () => {
  // 3 de 5 iguais = 0.6 (>= limiar) → marca; 2 de 5 = 0.4 (< limiar) → não marca.
  const base = [
    { data_lancamento: "2026-06-01", valor: 1 },
    { data_lancamento: "2026-06-02", valor: 2 },
    { data_lancamento: "2026-06-03", valor: 3 },
    { data_lancamento: "2026-06-04", valor: 4 },
    { data_lancamento: "2026-06-05", valor: 5 },
  ];
  const tres = base.slice(0, 3); // 3/3 do menor conjunto batem → 1.0
  assertEquals(_sobreposicao(tres, base) >= OVERLAP_MIN_DEDUP, true);
  const doisNovos = [
    { data_lancamento: "2026-06-01", valor: 1 },
    { data_lancamento: "2026-06-02", valor: 2 },
    { data_lancamento: "2026-07-09", valor: 99 },
    { data_lancamento: "2026-07-10", valor: 98 },
    { data_lancamento: "2026-07-11", valor: 97 },
  ]; // 2 de 5 batem → 0.4
  assertEquals(_sobreposicao(doisNovos, base) < OVERLAP_MIN_DEDUP, true);
});

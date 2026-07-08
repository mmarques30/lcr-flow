// Rodar: deno test supabase/functions/processar-documento/parse-resposta.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { extrairJsonBruto, normalizarClassificacao, parseClassificacaoResposta } from "./parse-resposta.ts";

Deno.test("extrairJsonBruto remove fences markdown", () => {
  const t = '```json\n{"tipo_documento":"recibo","lancamentos_sugeridos":[]}\n```';
  assertEquals(extrairJsonBruto(t), '{"tipo_documento":"recibo","lancamentos_sugeridos":[]}');
});

Deno.test("parseClassificacaoResposta tolera texto antes do JSON", () => {
  const t = 'Aqui está:\n{"tipo_documento":"darf","lancamentos_sugeridos":[]}';
  const r = parseClassificacaoResposta(t);
  assertEquals(r.tipo_documento, "darf");
  assertEquals(r.lancamentos_sugeridos.length, 0);
});

Deno.test("normalizarClassificacao garante lancamentos_sugeridos array", () => {
  const r = normalizarClassificacao({ tipo_documento: "outro" });
  assertEquals(r.lancamentos_sugeridos, []);
});

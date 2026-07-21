-- Tabela de apelidos de banco → código LCR (Plano de Contas), para resolver a
-- "CC nº 1" (contrapartida bancária) na Planilha SCI a partir do texto livre
-- extraído pela IA em contas_bancarias.banco (ex. "Itaú Unibanco S.A." → 657).
--
-- Substitui o dicionário hardcoded BANCO_PARA_CODIGO (duplicado em
-- src/lib/sci-xls.ts e src/sci/gerar_planilha_supabase.py na VPS) por uma
-- fonte única editável sem deploy: pra adicionar um banco novo, basta um
-- INSERT aqui — front e VPS já leem a tabela na próxima chamada.
--
-- `alias` já deve estar normalizado (minúsculo, sem acento, mesma regra de
-- semAcento()/_sem_acento()) — é comparado como substring dentro do texto
-- livre do banco. Aliases com espaço à direita (ex. "bb ", "xp ") existem
-- de propósito, pra evitar colisão com palavras maiores que só começam com
-- essas letras (ver `observacao`).
CREATE TABLE IF NOT EXISTS public.bancos_apelidos_lcr (
  alias text PRIMARY KEY,
  codigo_lcr integer NOT NULL REFERENCES public.plano_de_contas_lcr(codigo) ON DELETE RESTRICT,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bancos_apelidos_lcr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bancos_apelidos_lcr_select_authenticated" ON public.bancos_apelidos_lcr;
CREATE POLICY "bancos_apelidos_lcr_select_authenticated"
  ON public.bancos_apelidos_lcr FOR SELECT TO authenticated USING (true);

-- Seed: os 24 aliases hoje hardcoded no dicionário BANCO_PARA_CODIGO
-- (auditoria 21/07 — ver docs/conciliacao-v3-spec.md).
INSERT INTO public.bancos_apelidos_lcr (alias, codigo_lcr, observacao) VALUES
  ('bradesco', 9, NULL),
  ('brasil', 7, NULL),
  ('bb ', 7, 'espaço à direita de propósito — evita colidir com palavras que só começam com "bb"'),
  ('caixa', 8, NULL),
  ('santander', 10, NULL),
  ('itau', 657, NULL),
  ('pagseguro', 946, 'checar ANTES de "inter" — "PagSeguro Internet S/A" contém "internet"'),
  ('pagbank', 946, NULL),
  ('inter', 658, NULL),
  ('sicoob', 659, NULL),
  ('sicredi', 775, NULL),
  ('original', 779, NULL),
  ('nu pagamentos', 821, NULL),
  ('nubank', 821, NULL),
  ('xp ', 823, 'espaço à direita de propósito — mesmo motivo do "bb "'),
  ('c6', 809, NULL),
  ('stone', 910, NULL),
  ('btg', 1031, NULL),
  ('safra', 818, NULL),
  ('cora', 917, NULL),
  ('mercado pago', 960, NULL),
  ('wise', 1292, NULL),
  ('bs2', 830, NULL),
  ('afinz', 1197, NULL),
  ('208', 1031, 'código COMPE oficial do BTG Pactual — a IA às vezes extrai o número em vez do nome')
ON CONFLICT (alias) DO NOTHING;

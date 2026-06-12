-- =====================================================================
-- LCR Contábil — Motor de conciliação (híbrido regras + IA)
--   * extrato_csv_url: CSV do extrato bancário enviado ao Storage
--   * resultado: saída do motor (conciliados, divergências, fonte do match)
-- =====================================================================
ALTER TABLE public.conciliacoes ADD COLUMN IF NOT EXISTS extrato_csv_url text;
ALTER TABLE public.conciliacoes ADD COLUMN IF NOT EXISTS resultado jsonb;

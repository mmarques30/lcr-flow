-- =====================================================================
-- De-para SCI nas tabelas globais (plano_contas / historicos_contabeis)
--   * plano_contas.sci_apelido          → apelido SCI da conta (ex.: 657 → 11001)
--   * plano_contas.sci_historico_padrao → histórico padrão do de-para
--   * historicos_contabeis.sci_apelido  → apelido do histórico SCI (ex.: 19 → AQUISINVEST)
-- Popular via scripts/carregar_depara_supabase.py (lê os .xls/.csv de config/).
-- =====================================================================
ALTER TABLE public.plano_contas        ADD COLUMN IF NOT EXISTS sci_apelido          text;
ALTER TABLE public.plano_contas        ADD COLUMN IF NOT EXISTS sci_historico_padrao text;
ALTER TABLE public.historicos_contabeis ADD COLUMN IF NOT EXISTS sci_apelido         text;

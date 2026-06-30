ALTER TABLE public.plano_contas ADD COLUMN IF NOT EXISTS sci_apelido text;
ALTER TABLE public.plano_contas ADD COLUMN IF NOT EXISTS sci_historico_padrao text;
ALTER TABLE public.historicos_contabeis ADD COLUMN IF NOT EXISTS sci_apelido text;
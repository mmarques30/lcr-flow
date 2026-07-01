-- Fase 3: referências diretas ao Plano de Contas oficial LCR (Anexo 1) e
-- Plano de Históricos SCI (Anexo 2) nos lançamentos.
-- - pdc_codigo:      codigo em plano_de_contas_lcr (autoritativo)
-- - hist_sci_codigo: codigo em historicos_sci_lcr (autoritativo)
-- - requer_participante: replicado da conta oficial no momento da geração,
--                        para o front sinalizar edição manual quando o
--                        participante não foi extraído automaticamente.
ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS pdc_codigo integer REFERENCES public.plano_de_contas_lcr(codigo) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hist_sci_codigo integer REFERENCES public.historicos_sci_lcr(codigo) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requer_participante boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS lancamentos_pdc_codigo_idx ON public.lancamentos(pdc_codigo) WHERE pdc_codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_hist_sci_codigo_idx ON public.lancamentos(hist_sci_codigo) WHERE hist_sci_codigo IS NOT NULL;

-- Plano de Históricos SCI (Anexo 2) — fonte oficial de códigos de histórico
CREATE TABLE IF NOT EXISTS public.historicos_sci_lcr (
  codigo integer PRIMARY KEY,
  apelido text,
  nome text NOT NULL,
  pula_complemento boolean NOT NULL DEFAULT false
);

-- Plano de Contas oficial LCR (Anexo 1) — fonte oficial de contas contábeis
CREATE TABLE IF NOT EXISTS public.plano_de_contas_lcr (
  codigo integer PRIMARY KEY,
  classificacao text NOT NULL,
  tipo text,
  nome text NOT NULL,
  apelido integer,
  grupo text,
  historico_padrao integer REFERENCES public.historicos_sci_lcr(codigo) ON DELETE SET NULL,
  numero_documento text,
  competencia text,
  requer_participante boolean NOT NULL DEFAULT false,
  requer_historico_complementar boolean NOT NULL DEFAULT false,
  comentarios text
);

CREATE INDEX IF NOT EXISTS plano_de_contas_lcr_apelido_idx
  ON public.plano_de_contas_lcr(apelido)
  WHERE apelido IS NOT NULL;
CREATE INDEX IF NOT EXISTS plano_de_contas_lcr_grupo_idx
  ON public.plano_de_contas_lcr(grupo);
CREATE INDEX IF NOT EXISTS plano_de_contas_lcr_hist_padrao_idx
  ON public.plano_de_contas_lcr(historico_padrao);

ALTER TABLE public.historicos_sci_lcr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plano_de_contas_lcr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "historicos_sci_lcr_select_authenticated" ON public.historicos_sci_lcr;
CREATE POLICY "historicos_sci_lcr_select_authenticated"
  ON public.historicos_sci_lcr FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "plano_de_contas_lcr_select_authenticated" ON public.plano_de_contas_lcr;
CREATE POLICY "plano_de_contas_lcr_select_authenticated"
  ON public.plano_de_contas_lcr FOR SELECT TO authenticated USING (true);

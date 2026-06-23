-- Colunas para storage real + status de processamento do pipeline IA (TO-BE 23/06)
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS tamanho_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS hash_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS classificacao_ia JSONB,
  ADD COLUMN IF NOT EXISTS status_processamento TEXT DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS lancamentos_gerados INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_documentos_status ON public.documentos(status_processamento);
CREATE INDEX IF NOT EXISTS idx_documentos_empresa ON public.documentos(empresa_id, created_at DESC);

-- Conciliação sobre lançamentos reais (TO-BE 23/06 · Tarefa 7)
ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS conciliado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3);
CREATE INDEX IF NOT EXISTS idx_lancamentos_conciliado ON public.lancamentos(empresa_id, competencia, conciliado);

-- Agregação real para a planilha SCI (TO-BE 23/06 · Tarefa 6)
CREATE OR REPLACE FUNCTION public.agregar_lancamentos_sci(p_empresa_id UUID, p_competencia TEXT)
RETURNS TABLE (conta_codigo TEXT, conta_descricao TEXT, conta_tipo TEXT, total NUMERIC, qtd_lancamentos INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pc.codigo, pc.descricao, pc.tipo, SUM(l.valor)::numeric, COUNT(*)::integer
  FROM public.lancamentos l
  JOIN public.plano_contas pc ON pc.id = l.conta_id
  WHERE l.empresa_id = p_empresa_id AND l.competencia = p_competencia
  GROUP BY pc.codigo, pc.descricao, pc.tipo
  ORDER BY pc.codigo;
$$;
GRANT EXECUTE ON FUNCTION public.agregar_lancamentos_sci(uuid, text) TO authenticated, service_role;

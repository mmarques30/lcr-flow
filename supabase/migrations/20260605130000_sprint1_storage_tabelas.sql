-- =====================================================================
-- LCR Contábil — Sprint 1
-- Tabelas contábeis (competencias, plano_contas, historicos_contabeis),
-- normalização de competencia (text → FK competencia_id) com backfill,
-- e buckets de Storage com policies.
-- Aditivo / não-destrutivo: a coluna competencia (text) é mantida.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 Tabelas contábeis faltantes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo date NOT NULL,
  status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta','em_processamento','conciliada','fechada','cancelada')),
  iniciado_em timestamptz,
  fechado_em timestamptz,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_competencias_empresa_periodo ON competencias(empresa_id, periodo);

CREATE TABLE IF NOT EXISTS plano_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descricao text NOT NULL,
  tipo text CHECK (tipo IN ('ativo','passivo','receita','despesa','patrimonio')),
  conta_pai_id uuid REFERENCES plano_contas(id),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_plano_contas_empresa ON plano_contas(empresa_id);

CREATE TABLE IF NOT EXISTS historicos_contabeis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descricao text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_historicos_empresa ON historicos_contabeis(empresa_id);

-- ---------------------------------------------------------------------
-- 1.2 Triggers updated_at nas novas (atualizam a coluna atualizado_em)
-- ---------------------------------------------------------------------
-- A função update_updated_at_column() escreve em NEW.updated_at; as novas
-- tabelas usam atualizado_em, então usamos uma função dedicada.
CREATE OR REPLACE FUNCTION public.update_atualizado_em_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_competencias_updated ON competencias;
CREATE TRIGGER trg_competencias_updated BEFORE UPDATE ON competencias
  FOR EACH ROW EXECUTE FUNCTION public.update_atualizado_em_column();

DROP TRIGGER IF EXISTS trg_plano_contas_updated ON plano_contas;
CREATE TRIGGER trg_plano_contas_updated BEFORE UPDATE ON plano_contas
  FOR EACH ROW EXECUTE FUNCTION public.update_atualizado_em_column();

-- ---------------------------------------------------------------------
-- 1.3 RLS nas novas
-- ---------------------------------------------------------------------
ALTER TABLE competencias         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano_contas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE historicos_contabeis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_competencias_authd ON competencias;
CREATE POLICY p_competencias_authd ON competencias        FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_plano_contas_authd ON plano_contas;
CREATE POLICY p_plano_contas_authd ON plano_contas        FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_historicos_authd ON historicos_contabeis;
CREATE POLICY p_historicos_authd   ON historicos_contabeis FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 1.4 Normalizar competencia TEXT → FK (mantém a coluna text por ora)
--     + coluna de tamanho do arquivo (necessária ao upload real)
-- ---------------------------------------------------------------------
ALTER TABLE documentos    ADD COLUMN IF NOT EXISTS competencia_id uuid REFERENCES competencias(id);
ALTER TABLE lancamentos   ADD COLUMN IF NOT EXISTS competencia_id uuid REFERENCES competencias(id);
ALTER TABLE conciliacoes  ADD COLUMN IF NOT EXISTS competencia_id uuid REFERENCES competencias(id);
ALTER TABLE tarefas       ADD COLUMN IF NOT EXISTS competencia_id uuid REFERENCES competencias(id);

ALTER TABLE documentos    ADD COLUMN IF NOT EXISTS arquivo_tamanho_bytes bigint;

CREATE INDEX IF NOT EXISTS idx_documentos_competencia_id   ON documentos(competencia_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_competencia_id  ON lancamentos(competencia_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_competencia_id ON conciliacoes(competencia_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_competencia_id      ON tarefas(competencia_id);

-- ---------------------------------------------------------------------
-- 1.5 Backfill: cria competencias e popula competencia_id a partir do
--     competencia text 'YYYY-MM' existente em cada tabela
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; comp_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT empresa_id, competencia FROM documentos    WHERE competencia IS NOT NULL AND competencia ~ '^\d{4}-\d{2}$' UNION
    SELECT DISTINCT empresa_id, competencia FROM lancamentos   WHERE competencia IS NOT NULL AND competencia ~ '^\d{4}-\d{2}$' UNION
    SELECT DISTINCT empresa_id, competencia FROM conciliacoes  WHERE competencia IS NOT NULL AND competencia ~ '^\d{4}-\d{2}$' UNION
    SELECT DISTINCT empresa_id, competencia FROM tarefas       WHERE competencia IS NOT NULL AND competencia ~ '^\d{4}-\d{2}$'
  LOOP
    INSERT INTO competencias (empresa_id, periodo, status)
    VALUES (r.empresa_id, to_date(r.competencia || '-01', 'YYYY-MM-DD'), 'aberta')
    ON CONFLICT (empresa_id, periodo) DO NOTHING
    RETURNING id INTO comp_id;
    IF comp_id IS NULL THEN
      SELECT id INTO comp_id FROM competencias WHERE empresa_id = r.empresa_id AND periodo = to_date(r.competencia || '-01', 'YYYY-MM-DD');
    END IF;
    UPDATE documentos    SET competencia_id = comp_id WHERE empresa_id = r.empresa_id AND competencia = r.competencia;
    UPDATE lancamentos   SET competencia_id = comp_id WHERE empresa_id = r.empresa_id AND competencia = r.competencia;
    UPDATE conciliacoes  SET competencia_id = comp_id WHERE empresa_id = r.empresa_id AND competencia = r.competencia;
    UPDATE tarefas       SET competencia_id = comp_id WHERE empresa_id = r.empresa_id AND competencia = r.competencia;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 1.6 Trigger: criar competência do mês ao criar empresa
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION criar_competencia_atual() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO competencias (empresa_id, periodo, status)
  VALUES (NEW.id, date_trunc('month', current_date)::date, 'aberta')
  ON CONFLICT (empresa_id, periodo) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_competencia ON empresas;
CREATE TRIGGER trg_empresa_competencia AFTER INSERT ON empresas
  FOR EACH ROW EXECUTE FUNCTION criar_competencia_atual();

-- ---------------------------------------------------------------------
-- 1.7 Storage buckets (privados) + policies
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('documentos','documentos',false),
  ('planilhas-sci','planilhas-sci',false),
  ('conciliacoes','conciliacoes',false),
  ('balancetes','balancetes',false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS p_storage_select ON storage.objects;
CREATE POLICY p_storage_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id IN ('documentos','planilhas-sci','conciliacoes','balancetes')
);
DROP POLICY IF EXISTS p_storage_insert ON storage.objects;
CREATE POLICY p_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id IN ('documentos','planilhas-sci','conciliacoes','balancetes')
);
DROP POLICY IF EXISTS p_storage_update ON storage.objects;
CREATE POLICY p_storage_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id IN ('documentos','planilhas-sci','conciliacoes','balancetes')
);
DROP POLICY IF EXISTS p_storage_delete ON storage.objects;
CREATE POLICY p_storage_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id IN ('documentos','planilhas-sci','conciliacoes','balancetes')
  AND EXISTS (SELECT 1 FROM usuarios_perfil WHERE user_id = auth.uid() AND perfil = 'admin' AND ativo)
);

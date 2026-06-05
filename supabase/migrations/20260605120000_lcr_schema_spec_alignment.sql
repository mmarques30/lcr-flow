-- =====================================================================
-- LCR Contábil — Alinhamento do schema com a especificação ("spec por cima")
-- Estratégia: ADITIVA / NÃO-DESTRUTIVA.
--   * Mantém colunas e enums já usados pelo frontend (Lovable).
--   * Apenas ADICIONA valores de enum, colunas, índices, tabelas,
--     triggers e políticas que faltavam na spec.
--   * competencia permanece TEXT ('YYYY-MM') para não quebrar o app
--     (a spec pedia DATE — ver README, seção "Desvios conscientes").
--
-- IMPORTANTE: este arquivo NÃO usa os novos valores de enum (regra do
-- PostgreSQL: não se pode usar um valor de enum recém-criado na mesma
-- transação). Os seeds que dependem deles vivem na migração seguinte.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------

-- Trigger de updated_at já existe (public.update_updated_at_column).
-- Garantimos sua existência caso a migração anterior não tenha rodado.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Verifica se o usuário autenticado é admin (SECURITY DEFINER evita
-- recursão de RLS ao consultar usuarios_perfil).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_perfil
    WHERE user_id = auth.uid() AND perfil = 'admin' AND ativo = true
  );
$$;

-- ---------------------------------------------------------------------
-- 1. ENUMS — adicionar valores faltantes da spec (idempotente)
-- ---------------------------------------------------------------------
ALTER TYPE public.documento_tipo   ADD VALUE IF NOT EXISTS 'outros';

ALTER TYPE public.documento_origem ADD VALUE IF NOT EXISTS 'upload_manual';
ALTER TYPE public.documento_origem ADD VALUE IF NOT EXISTS 'email';

ALTER TYPE public.documento_status ADD VALUE IF NOT EXISTS 'erro';

ALTER TYPE public.lancamento_status ADD VALUE IF NOT EXISTS 'pendente';
ALTER TYPE public.lancamento_status ADD VALUE IF NOT EXISTS 'planilha_gerada';
ALTER TYPE public.lancamento_status ADD VALUE IF NOT EXISTS 'enviado_leveldrive';
ALTER TYPE public.lancamento_status ADD VALUE IF NOT EXISTS 'importado_sci';
ALTER TYPE public.lancamento_status ADD VALUE IF NOT EXISTS 'validado';

ALTER TYPE public.tarefa_tipo   ADD VALUE IF NOT EXISTS 'cobranca_movimento';
ALTER TYPE public.tarefa_tipo   ADD VALUE IF NOT EXISTS 'lancamentos_contabeis';
ALTER TYPE public.tarefa_tipo   ADD VALUE IF NOT EXISTS 'conciliacao_balancete';

ALTER TYPE public.tarefa_status ADD VALUE IF NOT EXISTS 'aberta';
ALTER TYPE public.tarefa_status ADD VALUE IF NOT EXISTS 'em_andamento';
ALTER TYPE public.tarefa_status ADD VALUE IF NOT EXISTS 'concluida';
ALTER TYPE public.tarefa_status ADD VALUE IF NOT EXISTS 'bloqueada';

-- ---------------------------------------------------------------------
-- 2. EMPRESAS — coluna ativo (spec)
-- ---------------------------------------------------------------------
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- 3. CONTAS_BANCARIAS — tipo + updated_at/trigger
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conta_tipo') THEN
    CREATE TYPE public.conta_tipo AS ENUM ('corrente','aplicacao','poupanca');
  END IF;
END $$;

ALTER TABLE public.contas_bancarias
  ADD COLUMN IF NOT EXISTS tipo public.conta_tipo NOT NULL DEFAULT 'corrente';
ALTER TABLE public.contas_bancarias
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_contas_bancarias_updated ON public.contas_bancarias;
CREATE TRIGGER trg_contas_bancarias_updated
  BEFORE UPDATE ON public.contas_bancarias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 4. DOCUMENTOS_ESPERADOS — updated_at/trigger
-- ---------------------------------------------------------------------
ALTER TABLE public.documentos_esperados
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_documentos_esperados_updated ON public.documentos_esperados;
CREATE TRIGGER trg_documentos_esperados_updated
  BEFORE UPDATE ON public.documentos_esperados
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 5. DOCUMENTOS — colunas da spec + índices
-- ---------------------------------------------------------------------
ALTER TABLE public.documentos ADD COLUMN IF NOT EXISTS gestta_ref text;
ALTER TABLE public.documentos ADD COLUMN IF NOT EXISTS processado_em timestamptz;
ALTER TABLE public.documentos ADD COLUMN IF NOT EXISTS documento_id uuid;
ALTER TABLE public.documentos ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_emp_comp_status
  ON public.documentos(empresa_id, competencia, status);
CREATE INDEX IF NOT EXISTS idx_documentos_origem ON public.documentos(origem);
CREATE INDEX IF NOT EXISTS idx_documentos_gestta_ref ON public.documentos(gestta_ref);

-- ---------------------------------------------------------------------
-- 6. LANCAMENTOS — documento_id, linhas_count + índice
-- ---------------------------------------------------------------------
ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS documento_id uuid REFERENCES public.documentos(id) ON DELETE SET NULL;
ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS linhas_count integer;

CREATE INDEX IF NOT EXISTS idx_lancamentos_emp_comp_status
  ON public.lancamentos(empresa_id, competencia, status);

-- ---------------------------------------------------------------------
-- 7. CONCILIACOES — URLs da spec + índice
-- ---------------------------------------------------------------------
ALTER TABLE public.conciliacoes ADD COLUMN IF NOT EXISTS razao_csv_url text;
ALTER TABLE public.conciliacoes ADD COLUMN IF NOT EXISTS planilha_conciliacao_url text;

-- (empresa_id, competencia) já é UNIQUE => índice existe; criamos só por garantia.
CREATE INDEX IF NOT EXISTS idx_conciliacoes_emp_comp
  ON public.conciliacoes(empresa_id, competencia);

-- ---------------------------------------------------------------------
-- 8. TAREFAS — competencia, gestta_task_id + índices
-- ---------------------------------------------------------------------
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS competencia text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS gestta_task_id text;

CREATE INDEX IF NOT EXISTS idx_tarefas_consultor_status
  ON public.tarefas(consultor_id, status);
CREATE INDEX IF NOT EXISTS idx_tarefas_emp_comp
  ON public.tarefas(empresa_id, competencia);

-- ---------------------------------------------------------------------
-- 9. INTEGRACOES — ultima_sync + updated_at/trigger
-- ---------------------------------------------------------------------
ALTER TABLE public.integracoes ADD COLUMN IF NOT EXISTS ultima_sync timestamptz;
ALTER TABLE public.integracoes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_integracoes_updated ON public.integracoes;
CREATE TRIGGER trg_integracoes_updated
  BEFORE UPDATE ON public.integracoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 10. AUDIT_LOG — tabela nova
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,
  acao         text NOT NULL,            -- UPDATE | DELETE
  tabela       text NOT NULL,
  registro_id  uuid,
  dados_antes  jsonb,
  dados_depois jsonb,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tabela_registro
  ON public.audit_log(tabela, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_criado_em
  ON public.audit_log(criado_em);

-- audit_log NÃO recebe GRANT de INSERT/UPDATE/DELETE para authenticated:
-- a escrita acontece apenas via trigger SECURITY DEFINER (abaixo).
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL    ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log somente admin lê" ON public.audit_log;
CREATE POLICY "audit_log somente admin lê"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- 11. TRIGGER de auditoria
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- escreve em audit_log driblando o RLS
SET search_path = public
AS $$
DECLARE
  v_registro_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    BEGIN v_registro_id := OLD.id; EXCEPTION WHEN undefined_column THEN v_registro_id := NULL; END;
    INSERT INTO public.audit_log (user_id, acao, tabela, registro_id, dados_antes, dados_depois)
    VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, v_registro_id, to_jsonb(OLD), NULL);
    RETURN OLD;
  ELSE -- UPDATE
    BEGIN v_registro_id := NEW.id; EXCEPTION WHEN undefined_column THEN v_registro_id := NULL; END;
    INSERT INTO public.audit_log (user_id, acao, tabela, registro_id, dados_antes, dados_depois)
    VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, v_registro_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$;

-- Anexa o trigger às tabelas auditadas (UPDATE e DELETE).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas','documentos','lancamentos','conciliacoes','tarefas']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%1$s
         AFTER UPDATE OR DELETE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 12. RLS — garantir que TODAS as tabelas têm RLS habilitado
--     (as tabelas existentes já têm políticas FOR ALL para authenticated;
--      aqui só reforçamos o ENABLE para as que possam faltar)
-- ---------------------------------------------------------------------
ALTER TABLE public.empresas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_bancarias     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_esperados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_perfil      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracoes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;

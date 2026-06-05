-- =====================================================================
-- LCR Contábil — Seeds complementares da spec
--   * 1 admin (Mariana) + 2 consultores fictícios
--   * consultor_id atribuído às empresas demo
--   * garante 2 contas bancárias por empresa demo
--   * 3 tarefas por empresa demo para a competência atual (2026-06)
--
-- Arquivo separado da migração de schema porque usa valores de enum
-- recém-criados (tarefa_tipo / tarefa_status), o que o PostgreSQL não
-- permite na mesma transação em que o valor foi adicionado.
--
-- Todos os blocos são idempotentes (guardas NOT EXISTS / ON CONFLICT).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. USUÁRIOS (auth.users + usuarios_perfil)
-- ---------------------------------------------------------------------
-- Inserimos em auth.users; o trigger on_auth_user_created cria o
-- registro em usuarios_perfil automaticamente (perfil 'assistente').
-- Em seguida ajustamos nome/perfil. Guardado por NOT EXISTS para ser
-- seguro em produção (onde o usuário pode já existir via signup).
DO $$
DECLARE
  v_users jsonb := jsonb_build_array(
    jsonb_build_object('email','mariana.mrcabral@gmail.com',   'nome','Mariana Cabral',     'perfil','admin'),
    jsonb_build_object('email','carlos.mendes@lcrcontabil.com.br','nome','Carlos Mendes',    'perfil','consultor'),
    jsonb_build_object('email','ana.souza@lcrcontabil.com.br',   'nome','Ana Paula Souza',  'perfil','consultor')
  );
  u jsonb;
  v_uid uuid;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(v_users)
  LOOP
    -- já existe um perfil com este e-mail? então só normaliza nome/perfil
    IF EXISTS (SELECT 1 FROM public.usuarios_perfil WHERE email = u->>'email') THEN
      UPDATE public.usuarios_perfil
        SET nome = u->>'nome', perfil = (u->>'perfil')::public.perfil_usuario, ativo = true
        WHERE email = u->>'email';
      CONTINUE;
    END IF;

    -- usuário existe em auth.users mas sem perfil?
    SELECT id INTO v_uid FROM auth.users WHERE email = u->>'email' LIMIT 1;

    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      -- encrypted_password fica NULL de propósito: as contas-semente são
      -- ativadas por magic-link / "esqueci minha senha" (sem depender da
      -- extensão pgcrypto no search_path da migração).
      INSERT INTO auth.users (
        id, instance_id, aud, role, email,
        email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        v_uid,
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', u->>'email',
        now(),
        jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
        jsonb_build_object('nome', u->>'nome'),
        now(), now()
      );
    END IF;

    -- o trigger handle_new_user pode já ter criado o perfil; garantimos.
    INSERT INTO public.usuarios_perfil (user_id, nome, email, perfil)
    VALUES (v_uid, u->>'nome', u->>'email', (u->>'perfil')::public.perfil_usuario)
    ON CONFLICT (user_id) DO UPDATE
      SET nome = EXCLUDED.nome, perfil = EXCLUDED.perfil, email = EXCLUDED.email, ativo = true;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Atribui consultor_id às empresas demo (distribui os 2 consultores)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_consultores uuid[];
  e record;
  i int := 0;
BEGIN
  SELECT array_agg(id ORDER BY nome) INTO v_consultores
  FROM public.usuarios_perfil WHERE perfil = 'consultor';

  IF v_consultores IS NULL OR array_length(v_consultores,1) = 0 THEN
    RETURN; -- sem consultores, nada a fazer
  END IF;

  FOR e IN SELECT id FROM public.empresas WHERE is_demo = true AND consultor_id IS NULL ORDER BY razao_social
  LOOP
    UPDATE public.empresas
      SET consultor_id = v_consultores[(i % array_length(v_consultores,1)) + 1]
      WHERE id = e.id;
    i := i + 1;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Garante 2 contas bancárias por empresa demo
--    (insere as que faltam, sem duplicar)
-- ---------------------------------------------------------------------
-- conta corrente: cria onde não houver nenhuma 'corrente'
INSERT INTO public.contas_bancarias (empresa_id, banco, agencia, conta, tipo)
SELECT e.id, 'Banco do Brasil', '0001-0', '10000-0', 'corrente'
FROM public.empresas e
WHERE e.is_demo = true
  AND NOT EXISTS (
    SELECT 1 FROM public.contas_bancarias c
    WHERE c.empresa_id = e.id AND c.tipo = 'corrente'
  );

-- conta aplicação: cria onde não houver nenhuma 'aplicacao'
INSERT INTO public.contas_bancarias (empresa_id, banco, agencia, conta, tipo)
SELECT e.id, 'Itaú', '0002-0', '20000-0', 'aplicacao'
FROM public.empresas e
WHERE e.is_demo = true
  AND NOT EXISTS (
    SELECT 1 FROM public.contas_bancarias c
    WHERE c.empresa_id = e.id AND c.tipo = 'aplicacao'
  );

-- ---------------------------------------------------------------------
-- 4. 3 tarefas por empresa demo para a competência atual (2026-06)
--    usa os novos valores de enum (tipo *_contabeis etc. / status spec)
-- ---------------------------------------------------------------------
INSERT INTO public.tarefas (empresa_id, tipo, status, titulo, competencia, prazo, consultor_id, ordem)
SELECT e.id, 'cobranca_movimento'::public.tarefa_tipo, 'aberta'::public.tarefa_status,
       'Cobrar movimento bancário 06/2026', '2026-06', DATE '2026-06-15', e.consultor_id, 1
FROM public.empresas e
WHERE e.is_demo = true
  AND NOT EXISTS (SELECT 1 FROM public.tarefas t WHERE t.empresa_id = e.id AND t.competencia = '2026-06');

INSERT INTO public.tarefas (empresa_id, tipo, status, titulo, competencia, prazo, consultor_id, ordem)
SELECT e.id, 'lancamentos_contabeis'::public.tarefa_tipo, 'em_andamento'::public.tarefa_status,
       'Lançamentos contábeis 06/2026', '2026-06', DATE '2026-06-20', e.consultor_id, 2
FROM public.empresas e
WHERE e.is_demo = true
  AND (SELECT count(*) FROM public.tarefas t WHERE t.empresa_id = e.id AND t.competencia = '2026-06') = 1;

INSERT INTO public.tarefas (empresa_id, tipo, status, titulo, competencia, prazo, consultor_id, ordem)
SELECT e.id, 'conciliacao_balancete'::public.tarefa_tipo, 'aberta'::public.tarefa_status,
       'Conciliação e balancete 06/2026', '2026-06', DATE '2026-06-28', e.consultor_id, 3
FROM public.empresas e
WHERE e.is_demo = true
  AND (SELECT count(*) FROM public.tarefas t WHERE t.empresa_id = e.id AND t.competencia = '2026-06') = 2;

-- ---------------------------------------------------------------------
-- 5. Integração claude_api (faltava na seed original)
-- ---------------------------------------------------------------------
INSERT INTO public.integracoes (tipo, config, status)
VALUES ('claude_api', '{"api_key":"","model":"claude-opus-4-8"}'::jsonb, 'desconectado')
ON CONFLICT (tipo) DO NOTHING;

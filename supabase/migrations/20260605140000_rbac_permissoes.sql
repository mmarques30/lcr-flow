-- =====================================================================
-- LCR Contábil — Controle de acesso (RBAC híbrido)
--   * permissoes_perfil: preset de acessos por perfil (admin/consultor/assistente)
--   * usuarios_perfil.permissoes_custom: override por usuário (NULL = herda do perfil)
--   * RLS: admin pode gerir usuarios_perfil e os presets
-- As chaves de acesso (menus/abas) são definidas no código (src/lib/acessos.ts).
-- =====================================================================

-- Override por usuário (NULL = usa o preset do perfil)
ALTER TABLE public.usuarios_perfil
  ADD COLUMN IF NOT EXISTS permissoes_custom text[];

-- Presets por perfil
CREATE TABLE IF NOT EXISTS public.permissoes_perfil (
  perfil text PRIMARY KEY,
  chaves text[] NOT NULL DEFAULT '{}',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.permissoes_perfil TO authenticated;
GRANT ALL ON public.permissoes_perfil TO service_role;
ALTER TABLE public.permissoes_perfil ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_permissoes_perfil_select ON public.permissoes_perfil;
CREATE POLICY p_permissoes_perfil_select ON public.permissoes_perfil
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_permissoes_perfil_admin ON public.permissoes_perfil;
CREATE POLICY p_permissoes_perfil_admin ON public.permissoes_perfil
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Presets iniciais
INSERT INTO public.permissoes_perfil (perfil, chaves) VALUES
  ('admin', ARRAY['dashboard','clientes','documentos','lancamentos','conciliacao','tarefas','configuracoes','configuracoes:integracoes','configuracoes:usuarios','configuracoes:plano']),
  ('consultor', ARRAY['dashboard','clientes','documentos','lancamentos','conciliacao','tarefas']),
  ('assistente', ARRAY['dashboard','documentos','conciliacao','tarefas'])
ON CONFLICT (perfil) DO NOTHING;

-- RLS: admin pode gerir qualquer usuario_perfil (criar/editar/excluir perfis e permissões)
DROP POLICY IF EXISTS "admin gere usuarios" ON public.usuarios_perfil;
CREATE POLICY "admin gere usuarios" ON public.usuarios_perfil
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

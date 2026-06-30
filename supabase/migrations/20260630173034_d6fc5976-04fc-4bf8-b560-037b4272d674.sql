
-- Restringe SELECT em usuarios_perfil: usuário só vê seu próprio perfil; admins veem todos.
DROP POLICY IF EXISTS "perfis visíveis aos autenticados" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "perfis visiveis aos autenticados" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "Authenticated can view perfis" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "usuarios_perfil_select_all" ON public.usuarios_perfil;

CREATE POLICY "usuarios_perfil_select_self_or_admin"
  ON public.usuarios_perfil FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- Bloqueia privilege escalation no INSERT: usuário só insere seu próprio perfil como 'assistente'
DROP POLICY IF EXISTS "perfil inserido no signup" ON public.usuarios_perfil;
CREATE POLICY "perfil inserido no signup"
  ON public.usuarios_perfil FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND perfil = 'assistente');

-- Bloqueia escalonamento via UPDATE: usuário não pode mudar próprio perfil/permissões; admin pode tudo.
DROP POLICY IF EXISTS "usuarios_perfil_update_self" ON public.usuarios_perfil;
DROP POLICY IF EXISTS "Atualizar proprio perfil" ON public.usuarios_perfil;
CREATE POLICY "usuarios_perfil_update_self_no_escalation"
  ON public.usuarios_perfil FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (
    public.is_admin()
    OR (
      auth.uid() = user_id
      AND perfil = (SELECT perfil FROM public.usuarios_perfil WHERE user_id = auth.uid())
      AND permissoes_custom IS NOT DISTINCT FROM (SELECT permissoes_custom FROM public.usuarios_perfil WHERE user_id = auth.uid())
    )
  );

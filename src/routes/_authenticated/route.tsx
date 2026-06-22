import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { CerebroAssistant } from "@/components/CerebroAssistant";
import { getMeuPerfil } from "@/lib/lcr.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() }),
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { data: perfil } = useSuspenseQuery({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() });
  return (
    <AppShell userName={perfil?.nome} userRole={perfil?.perfil} userAvatar={perfil?.avatar_url} acessos={perfil?.acessos}>
      <Outlet />
      <CerebroAssistant />
    </AppShell>
  );
}

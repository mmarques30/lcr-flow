import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getMeuPerfil } from "@/lib/lcr.functions";

// Ordem do menu — usada para escolher o destino quando o acesso é negado.
const ORDER: { key: string; to: string }[] = [
  { key: "dashboard", to: "/app" },
  { key: "clientes", to: "/clientes" },
  { key: "documentos", to: "/documentos" },
  { key: "lancamentos", to: "/lancamentos" },
  { key: "conciliacao", to: "/conciliacao" },
  { key: "tarefas", to: "/tarefas" },
  { key: "configuracoes", to: "/configuracoes" },
];

/**
 * Guarda de rota: garante que o usuário tem o acesso `acesso`.
 * Admin tem acesso total. Sem acesso → redireciona para o primeiro menu liberado.
 * `selfTo` evita loop de redirecionamento para a própria rota.
 */
export async function requireAcesso(queryClient: QueryClient, acesso: string, selfTo: string) {
  const perfil = await queryClient.ensureQueryData({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() });
  if (perfil?.perfil === "admin") return;
  const acessos: string[] = perfil?.acessos ?? [];
  if (acessos.includes(acesso)) return;

  const first = ORDER.find((o) => acessos.includes(o.key));
  if (!first || first.to === selfTo) return; // sem destino seguro: deixa renderizar (a página trata o vazio)
  throw redirect({ to: first.to });
}

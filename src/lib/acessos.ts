// Catálogo de acessos (menus / abas) do sistema — fonte única para RBAC.
export type AcessoNode = { key: string; label: string; filhos?: AcessoNode[] };

export const ACESSOS: AcessoNode[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clientes", label: "Clientes" },
  { key: "documentos", label: "Documentos" },
  { key: "lancamentos", label: "Lançamentos" },
  { key: "conciliacao", label: "Conciliação" },
  { key: "tarefas", label: "Tarefas" },
  { key: "knowledge", label: "Base de Conhecimento" },
  { key: "consultive", label: "Consultivo" },
  { key: "cx", label: "CX · Experiência" },
  { key: "historico", label: "Histórico do Cérebro" },
  {
    key: "configuracoes",
    label: "Configurações",
    filhos: [
      { key: "configuracoes:integracoes", label: "Integrações" },
      { key: "configuracoes:usuarios", label: "Usuários" },
      { key: "configuracoes:plano", label: "Plano de contas" },
    ],
  },
];

export const TODAS_CHAVES: string[] = ACESSOS.flatMap((a) => [a.key, ...(a.filhos?.map((f) => f.key) ?? [])]);

export const PERFIS = ["admin", "consultor", "assistente"] as const;
export type Perfil = (typeof PERFIS)[number];

export function temAcesso(acessos: string[] | undefined | null, key: string): boolean {
  return !!acessos && acessos.includes(key);
}

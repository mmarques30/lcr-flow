import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, FileText, BookOpen, GitCompare, ListChecks, Settings, LogOut } from "lucide-react";
import { LcrLogo } from "./brand";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: Building2 },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/lancamentos", label: "Lançamentos", icon: BookOpen },
  { to: "/conciliacao", label: "Conciliação", icon: GitCompare },
  { to: "/tarefas", label: "Tarefas", icon: ListChecks },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppShell({ children, userName }: { children: ReactNode; userName?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <LcrLogo size={36} />
          <div className="leading-tight">
            <div className="font-display text-base text-sidebar-foreground">LCR Contábil</div>
            <div className="text-[11px] text-sidebar-foreground/60">Integração & Conciliação</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.to || (item.to !== "/app" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-sidebar-foreground">{userName ?? "Equipe LCR"}</div>
              <div className="text-[11px] text-sidebar-foreground/60">Conectado</div>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="ml-60 flex-1">
        <div className="mx-auto max-w-[1400px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, emphasis, description, actions }: { title: string; emphasis?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          {title}
          {emphasis ? <> <span className="emphasis">{emphasis}</span></> : null}
        </h1>
        {description ? <p className="mt-1 text-sm text-soft-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function DemoFlag() {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      [DEMO]
    </span>
  );
}

import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, FileText, BookOpen, GitCompare, ListChecks, Settings, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LcrLogo } from "./brand";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, acesso: "dashboard" },
  { to: "/clientes", label: "Clientes", icon: Building2, acesso: "clientes" },
  { to: "/documentos", label: "Documentos", icon: FileText, acesso: "documentos" },
  { to: "/lancamentos", label: "Lançamentos", icon: BookOpen, acesso: "lancamentos" },
  { to: "/conciliacao", label: "Conciliação", icon: GitCompare, acesso: "conciliacao" },
  { to: "/tarefas", label: "Tarefas", icon: ListChecks, acesso: "tarefas" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, acesso: "configuracoes" },
] as const;

export function AppShell({ children, userName, acessos }: { children: ReactNode; userName?: string; acessos?: string[] }) {
  const navItems = acessos ? NAV.filter((i) => acessos.includes(i.acesso)) : NAV;
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);

  // lê a preferência do usuário após montar (evita mismatch de hidratação)
  useEffect(() => {
    setCollapsed(localStorage.getItem("lcr-sidebar-collapsed") === "1");
  }, []);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("lcr-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const ToggleBtn = (
    <button
      onClick={toggle}
      className="rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      title={collapsed ? "Expandir menu" : "Recolher menu"}
    >
      {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar text-sidebar-foreground bg-gradient-to-b from-sidebar to-deep shadow-elevated transition-[width] duration-200",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        {/* Header */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 px-2 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 shadow-soft"><LcrLogo size={30} /></div>
            {ToggleBtn}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-5 py-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 shadow-soft"><LcrLogo size={30} /></div>
            <div className="leading-tight">
              <div className="font-display text-base text-sidebar-foreground">LCR Contábil</div>
              <div className="text-[11px] text-sidebar-foreground/55">Integração &amp; Conciliação</div>
            </div>
            <div className="ml-auto">{ToggleBtn}</div>
          </div>
        )}

        <nav className="flex-1 px-3 py-3 space-y-1">
          {!collapsed && (
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Menu</div>
          )}
          {navItems.map((item) => {
            const active = pathname === item.to || (item.to !== "/app" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center rounded-lg text-sm transition-all duration-150",
                  collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground font-medium shadow-soft"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                )}
                <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "text-sidebar-primary" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground")} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* Usuário */}
        <div className="p-3">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-semibold uppercase text-sidebar-primary" title={userName ?? "Equipe LCR"}>
                {(userName ?? "LCR").slice(0, 2)}
              </div>
              <button onClick={handleSignOut} className="rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sair" title="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-sidebar-accent/50 px-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-semibold uppercase text-sidebar-primary">
                  {(userName ?? "LCR").slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-sidebar-foreground">{userName ?? "Equipe LCR"}</div>
                  <div className="text-[11px] text-sidebar-foreground/55">Conectado</div>
                </div>
              </div>
              <button onClick={handleSignOut} className="rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className={cn("flex-1 transition-[margin] duration-200", collapsed ? "ml-[72px]" : "ml-64")}>
        <div className="w-full px-6 py-8 lg:px-12 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, emphasis, description, actions }: { title: string; emphasis?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl text-foreground sm:text-[2rem]">
          {title}
          {emphasis ? <> <span className="emphasis">{emphasis}</span></> : null}
        </h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-soft-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function DemoFlag() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground shadow-soft">
      [DEMO]
    </span>
  );
}

/** Resumo consolidado no topo da tela — uma linha de mini-cards. */
export function ResumoTela({ itens }: { itens: { label: string; value: number | string; tone?: "default" | "warn" | "ok" }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {itens.map((it) => (
        <div key={it.label} className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-soft">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{it.label}</div>
          <div className={cn(
            "mt-1 font-display text-2xl leading-none",
            it.tone === "warn" ? "text-destructive" : it.tone === "ok" ? "text-primary" : "text-foreground",
          )}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

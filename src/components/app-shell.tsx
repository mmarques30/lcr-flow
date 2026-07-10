import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, ListChecks, Settings, LogOut, PanelLeftClose, PanelLeftOpen,
  Brain, LineChart, HeartHandshake, Plug, Users, ListTree, ChevronDown, Bell, UserPen, Camera,
  History, Check, ChevronRight, Search, Activity, Info, SlidersHorizontal, Lightbulb, type LucideIcon,
} from "lucide-react";
import { LcrLogo } from "./brand";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateMeuPerfil, getNotificacoes } from "@/lib/lcr.functions";
import { toast } from "sonner";

function Avatar({ url, nome, size = 36, className }: { url?: string | null; nome?: string; size?: number; className?: string }) {
  const iniciais = (nome ?? "LCR").slice(0, 2).toUpperCase();
  if (url) {
    return <img src={url} alt={nome ?? "Perfil"} width={size} height={size} style={{ width: size, height: size }} className={cn("rounded-full object-cover", className)} />;
  }
  return (
    <span style={{ width: size, height: size }} className={cn("flex items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary", className)}>
      {iniciais}
    </span>
  );
}

function MeuPerfilDialog({ open, onOpenChange, nomeInicial, avatarInicial }: { open: boolean; onOpenChange: (o: boolean) => void; nomeInicial?: string; avatarInicial?: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(nomeInicial ?? "");
  const [avatar, setAvatar] = useState<string | null>(avatarInicial ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setNome(nomeInicial ?? ""); setAvatar(avatarInicial ?? null); } }, [open, nomeInicial, avatarInicial]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatar(data.publicUrl);
      toast.success("Foto carregada.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function salvar() {
    if (!nome.trim()) { toast.error("Informe seu nome."); return; }
    setBusy(true);
    try {
      await updateMeuPerfil({ data: { nome: nome.trim(), avatar_url: avatar } });
      await qc.invalidateQueries({ queryKey: ["meu-perfil"] });
      toast.success("Perfil atualizado.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-2xl">Meu perfil</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar url={avatar} nome={nome} size={64} />
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Camera className="mr-1 h-4 w-4" /> {avatar ? "Trocar foto" : "Adicionar foto"}
              </Button>
              {avatar && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAvatar(null)}>Remover</Button>}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nome</label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type NavLeaf = { to: string; label: string; icon: LucideIcon; acesso: string; tab?: string };
type NavGroup = { group: string; icon: LucideIcon; itens: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

// Navegação organizada em seções. Itens soltos aparecem como leafs principais;
// grupos colapsáveis para sub-áreas (Cérebro / Configurações).
const NAV: NavItem[] = [
  { to: "/app", label: "Início", icon: LayoutDashboard, acesso: "dashboard" },
  { group: "Carteira", icon: Building2, itens: [
    { to: "/clientes", label: "Clientes", icon: Building2, acesso: "clientes" },
    { to: "/tarefas",  label: "Tarefas",  icon: ListChecks, acesso: "tarefas" },
  ] },
  { group: "Cérebro LCR", icon: Brain, itens: [
    { to: "/cx", label: "CX", icon: HeartHandshake, acesso: "cx" },
    { to: "/mestre", label: "Mestre", icon: Brain, acesso: "knowledge" },
    { to: "/consultive", label: "Consultivo", icon: LineChart, acesso: "consultive" },
    { to: "/knowledge", label: "Base de Conhecimento", icon: ListTree, acesso: "knowledge" },
  ] },
  { group: "Gestão", icon: SlidersHorizontal, itens: [
    { to: "/gestao/logs",          label: "Logs de uso",       icon: Activity,  acesso: "gestao:logs" },
    { to: "/gestao/oportunidades", label: "Oportunidades",     icon: Lightbulb, acesso: "gestao:oportunidades" },
    { to: "/historico",            label: "Histórico Cérebro", icon: History,   acesso: "historico" },
  ] },
  { group: "Configurações", icon: Settings, itens: [
    { to: "/configuracoes", tab: "integracoes", label: "Integrações", icon: Plug, acesso: "configuracoes:integracoes" },
    { to: "/configuracoes", tab: "usuarios", label: "Usuários", icon: Users, acesso: "configuracoes:usuarios" },
    { to: "/configuracoes", tab: "plano", label: "Plano de contas", icon: ListTree, acesso: "configuracoes:plano" },
  ] },
];

function leafAtiva(leaf: NavLeaf, pathname: string, tabAtual: string | undefined): boolean {
  if (leaf.to === "/configuracoes") return pathname.startsWith("/configuracoes") && tabAtual === leaf.tab;
  if (leaf.to === "/clientes") return pathname.startsWith("/clientes");
  return pathname === leaf.to || (leaf.to !== "/app" && pathname.startsWith(leaf.to));
}

// Item de navegação principal (sidebar) — densidade EZ Blockchain: ícone +
// label, barra accent à esquerda no ativo, sem all-caps em chips.
function NavLeafLink({ leaf, active, indented = false }: { leaf: NavLeaf; active: boolean; indented?: boolean }) {
  const Icon = leaf.icon;
  const className = cn(
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
    active
      ? "bg-sidebar-primary/15 text-sidebar-foreground"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
    indented && "pl-10",
  );
  const inner = (
    <>
      {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-lime" />}
      {!indented && (
        <span className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          active ? "bg-accent-lime/20 text-accent-lime" : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground",
        )}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="truncate">{leaf.label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-lime shadow-[0_0_8px_var(--color-accent-lime)]" />}
    </>
  );
  if (leaf.to === "/configuracoes") {
    return <Link to="/configuracoes" search={{ tab: leaf.tab }} className={className}>{inner}</Link>;
  }
  return <Link to={leaf.to as "/app"} className={className}>{inner}</Link>;
}

const ROUTE_TITLES: Record<string, string> = {
  "/app": "Visão geral",
  "/clientes": "Carteira",
  "/tarefas": "Tarefas",
  "/cx": "CX",
  "/mestre": "Mestre",
  "/consultive": "Consultivo",
  "/historico": "Histórico Geral",
  "/knowledge": "Base de Conhecimento",
  "/configuracoes": "Configurações",
  "/documentos": "Documentos",
  "/lancamentos": "Lançamentos",
  "/conciliacao": "Conciliação",
  "/gestao/logs": "Logs de uso",
  "/gestao/oportunidades": "Oportunidades",
};

function tituloDaRota(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const root = "/" + pathname.split("/")[1];
  if (ROUTE_TITLES[root]) {
    if (pathname.includes("/clientes/")) return "Cliente";
    if (pathname.includes("/cx/")) return "Cliente · CX";
    if (pathname.includes("/consultive/")) return "Cliente · Consultivo";
    if (pathname.includes("/conciliacao/")) return "Conciliação · Cliente";
    return ROUTE_TITLES[root];
  }
  return "LCR";
}

// Top bar moderno: breadcrumb à esquerda, busca central, status real-time +
// notificações + perfil à direita.
function TopBar({ userName, userRole, userAvatar, collapsed, onToggle, onSignOut, pathname }: {
  userName?: string; userRole?: string; userAvatar?: string | null;
  collapsed: boolean; onToggle: () => void; onSignOut: () => void; pathname: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notificacoes"], queryFn: () => getNotificacoes(), staleTime: 5 * 60_000 });
  const notifItems = notif?.items ?? [];
  const [lidas, setLidas] = useState<Record<string, number>>({});
  useEffect(() => { try { setLidas(JSON.parse(localStorage.getItem("lcr-notif-lidas") || "{}")); } catch { /* noop */ } }, []);
  const persistLidas = (d: Record<string, number>) => { setLidas(d); localStorage.setItem("lcr-notif-lidas", JSON.stringify(d)); };
  const visiveis = notifItems.filter((n) => lidas[n.tipo] !== n.count);
  const marcarLida = (tipo: string, count: number) => persistLidas({ ...lidas, [tipo]: count });
  const marcarTodas = () => persistLidas(Object.fromEntries(notifItems.map((n) => [n.tipo, n.count])));

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > last && y > 80) setHidden(true);
      else if (y < last) setHidden(false);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const titulo = tituloDaRota(pathname);
  const hora = useMemo(() => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), [pathname]);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md transition-transform duration-300 ease-out lg:px-8",
        hidden ? "-translate-y-full" : "translate-y-0",
      )}
    >
      {/* Esquerda: toggle + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onToggle}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-soft-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <nav className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground min-w-0" aria-label="breadcrumb">
          <span className="font-medium">LCR Contábil</span>
          <ChevronRight className="h-3 w-3" />
          <span className="font-display text-sm text-foreground truncate">{titulo}</span>
        </nav>
      </div>

      {/* Centro: busca compacta */}
      <div className="hidden lg:flex max-w-md flex-1 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors focus-within:border-primary/40 focus-within:bg-card">
        <Search className="h-3.5 w-3.5" />
        <input
          type="search"
          placeholder="Buscar clientes, documentos, lançamentos…"
          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) window.location.assign(`/clientes?q=${encodeURIComponent(val)}`);
            }
          }}
        />
        <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-card px-1.5 text-[10px] text-muted-foreground">↵</kbd>
      </div>

      {/* Direita: status + sino + perfil */}
      <div className="flex items-center gap-1.5">
        <div className="hidden md:flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1.5 text-[11px] font-medium text-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <Activity className="h-3 w-3" />
          <span>Em sincronia · {hora}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Notificações">
              <Bell className="h-4 w-4" />
              {visiveis.length > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{visiveis.length}</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
              {visiveis.length > 0 && <button onClick={marcarTodas} className="text-[11px] font-medium text-primary hover:underline">Marcar todas como lidas</button>}
            </div>
            <DropdownMenuSeparator />
            {visiveis.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">Sem novas notificações.</div>
            ) : (
              visiveis.map((n) => (
                <div key={n.tipo} className="flex items-start gap-1 px-1">
                  <DropdownMenuItem asChild className="flex-1">
                    <Link to={n.to as "/documentos"} className="flex items-start gap-2">
                      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm">{n.titulo}</span>
                    </Link>
                  </DropdownMenuItem>
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); marcarLida(n.tipo, n.count); }} className="mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Marcar como lida" aria-label="Marcar como lida">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-muted">
              <Avatar url={userAvatar} nome={userName} size={32} />
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-semibold leading-tight text-foreground">{userName ?? "Equipe LCR"}</span>
                <span className="block text-[10px] capitalize leading-tight text-muted-foreground">{userRole ?? "Conectado"}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">{userName ?? "Equipe LCR"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPerfilOpen(true)}>
              <UserPen className="mr-2 h-4 w-4" /> Meu perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <MeuPerfilDialog open={perfilOpen} onOpenChange={setPerfilOpen} nomeInicial={userName} avatarInicial={userAvatar} />
    </header>
  );
}

export function AppShell({ children, userName, userRole, userAvatar, acessos }: { children: ReactNode; userName?: string; userRole?: string; userAvatar?: string | null; acessos?: string[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabAtual = useRouterState({ select: (s) => (s.location.search as { tab?: string }).tab });
  const [collapsed, setCollapsed] = useState(false);

  // filtra itens conforme acessos; grupos somem se não sobrar sub-item
  const itens: NavItem[] = NAV.flatMap<NavItem>((it) => {
    if ("group" in it) {
      const sub = acessos ? it.itens.filter((leaf) => acessos.includes(leaf.acesso)) : it.itens;
      return sub.length > 0 ? [{ ...it, itens: sub }] : [];
    }
    return !acessos || acessos.includes(it.acesso) ? [it] : [];
  });

  // grupos: abertos por padrão se contiverem item ativo, senão fechados
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const inicial: Record<string, boolean> = {};
    itens.forEach((it) => {
      if ("group" in it) {
        inicial[it.group] = it.itens.some((sub) => leafAtiva(sub, pathname, tabAtual));
      }
    });
    setOpenGroups((prev) => ({ ...inicial, ...prev }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  const toggleGroup = (label: string) => setOpenGroups((p) => ({ ...p, [label]: !p[label] }));

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

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col overflow-hidden bg-gradient-to-b from-deep via-deep to-[oklch(0.22_0.06_258)] text-sidebar-foreground shadow-elevated transition-transform duration-200",
          collapsed ? "-translate-x-full" : "translate-x-0",
        )}
      >
        {/* Glow ambiente no topo */}
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-primary/30 blur-3xl" />

        {/* Header — logo + identificação do produto */}
        <div className="relative flex items-center gap-3 px-5 py-5 border-b border-sidebar-foreground/10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-soft">
            <LcrLogo size={28} />
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight text-sidebar-foreground">LCR Contábil</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">Cockpit operacional</div>
          </div>
        </div>

        {/* Status real-time */}
        <div className="mx-3 mt-3 rounded-2xl border border-sidebar-foreground/10 bg-sidebar-foreground/5 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-accent-lime">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-lime" />
              </span>
              Online
            </span>
            <span className="text-sidebar-foreground/50">tempo real</span>
          </div>
          <div className="mt-1 text-[10px] text-sidebar-foreground/55">Integrações ativas · sincronizando</div>
        </div>

        <nav className="relative mt-4 flex-1 overflow-y-auto px-3 pb-3">
          <div className="mb-2 px-3 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">Navegação</div>
          <div className="space-y-0.5">
            {itens.map((it) => {
              if (!("group" in it)) {
                const active = leafAtiva(it, pathname, tabAtual);
                return <NavLeafLink key={it.label} leaf={it} active={active} />;
              }
              const aberto = openGroups[it.group] ?? false;
              const temAtivo = it.itens.some((sub) => leafAtiva(sub, pathname, tabAtual));
              const GroupIcon = it.icon;
              return (
                <div key={it.group} className="mt-3 first:mt-0">
                  <button
                    onClick={() => toggleGroup(it.group)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      temAtivo ? "text-sidebar-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                    )}
                    aria-expanded={aberto}
                  >
                    <span className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                      temAtivo ? "bg-accent-lime/20 text-accent-lime" : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground",
                    )}>
                      <GroupIcon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-left">{it.group}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-200", aberto ? "" : "-rotate-90")} />
                  </button>
                  {aberto && (
                    <div className="mt-0.5 space-y-0.5">
                      {it.itens.map((sub) => (
                        <NavLeafLink key={sub.label} leaf={sub} active={leafAtiva(sub, pathname, tabAtual)} indented />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* Usuário */}
        <div className="relative p-3">
          <div className="flex items-center gap-2.5 rounded-2xl border border-sidebar-foreground/10 bg-sidebar-foreground/5 p-2.5">
            <Avatar url={userAvatar} nome={userName} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sidebar-foreground">{userName ?? "Equipe LCR"}</div>
              <div className="truncate text-[10px] capitalize text-sidebar-foreground/55">{userRole ?? "conectado"}</div>
            </div>
            <button onClick={handleSignOut} className="rounded-lg p-2 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sair" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className={cn("flex-1 transition-[margin] duration-200", collapsed ? "ml-0" : "ml-64")}>
        <TopBar userName={userName} userRole={userRole} userAvatar={userAvatar} collapsed={collapsed} onToggle={toggle} onSignOut={handleSignOut} pathname={pathname} />
        <div className="w-full px-6 pb-10 pt-4 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, emphasis, description, actions }: { title: string; emphasis?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl text-foreground sm:text-[2rem] leading-tight">
          {title}
          {emphasis ? <> <span className="emphasis">{emphasis}</span></> : null}
        </h1>
        {description ? (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Sobre esta página" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-sm text-xs leading-relaxed">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Resumo consolidado no topo da tela — KPI cards modernizados. */
export function ResumoTela({ itens }: { itens: { label: string; value: number | string; tone?: "default" | "warn" | "ok" }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {itens.map((it) => (
        <div key={it.label} className="group rounded-2xl border-0 bg-card px-5 py-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{it.label}</div>
          <div className={cn(
            "mt-1.5 text-[1.75rem] font-bold leading-none tracking-tight",
            it.tone === "warn" ? "text-destructive" : it.tone === "ok" ? "text-primary" : "text-foreground",
          )}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

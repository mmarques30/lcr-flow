import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, ListChecks, Settings, LogOut, PanelLeftClose, PanelLeftOpen, Brain, LineChart, HeartHandshake, Plug, Users, ListTree, ChevronDown, Bell, UserPen, Camera, History, Check, type LucideIcon } from "lucide-react";
import { LcrLogo } from "./brand";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
    <span style={{ width: size, height: size }} className={cn("flex items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary", className)}>
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
type NavItem = NavLeaf | { group: string; icon: LucideIcon; itens: NavLeaf[] };

// O ciclo contábil (Documentos/Lançamentos/Conciliação) vive DENTRO do Painel
// do Cliente (Carteira → cliente → abas), então não aparece aqui como item
// solto. Os demais grupos (Cérebro LCR, Configurações) mantêm sub-itens.
const NAV: NavItem[] = [
  { group: "Visão geral", icon: LayoutDashboard, itens: [
    { to: "/app", label: "Início", icon: LayoutDashboard, acesso: "dashboard" },
    { to: "/clientes", label: "Carteira", icon: Building2, acesso: "clientes" },
  ] },
  { to: "/tarefas", label: "Tarefas", icon: ListChecks, acesso: "tarefas" },
  { group: "Cérebro LCR", icon: Brain, itens: [
    { to: "/cx", label: "CX", icon: HeartHandshake, acesso: "cx" },
    { to: "/mestre", label: "Mestre", icon: Brain, acesso: "knowledge" },
    { to: "/consultive", label: "Consultivo", icon: LineChart, acesso: "consultive" },
    { to: "/historico", label: "Histórico Geral", icon: History, acesso: "historico" },
    { to: "/knowledge", label: "Base de Conhecimento", icon: ListTree, acesso: "knowledge" },
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

function NavLeafLink({ leaf, active, indented = false }: { leaf: NavLeaf; active: boolean; indented?: boolean }) {
  const Icon = leaf.icon;
  const className = cn(
    "group relative flex items-center gap-3 rounded-[16px] py-2.5 pr-3 text-sm transition-all duration-200 ease-out",
    indented ? "pl-9" : "pl-3",
    active
      ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-soft"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  );
  const inner = (
    <>
      {!indented && <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground")} />}
      <span className="truncate">{leaf.label}</span>
    </>
  );
  if (leaf.to === "/configuracoes") {
    return <Link to="/configuracoes" search={{ tab: leaf.tab }} className={className}>{inner}</Link>;
  }
  return <Link to={leaf.to as "/app"} className={className}>{inner}</Link>;
}

// Topbar: toggle do menu à esquerda; notificações + perfil à direita.
// Some ao rolar para baixo e volta ao subir.
function TopBar({ userName, userRole, userAvatar, collapsed, onToggle, onSignOut }: {
  userName?: string; userRole?: string; userAvatar?: string | null;
  collapsed: boolean; onToggle: () => void; onSignOut: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notificacoes"], queryFn: () => getNotificacoes(), staleTime: 60_000 });
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
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center justify-between gap-1 border-b border-primary/15 bg-[oklch(0.89_0.04_250)]/90 px-4 backdrop-blur transition-transform duration-300 ease-out lg:px-8",
        hidden ? "-translate-y-full" : "translate-y-0",
      )}
    >
      <button
        onClick={onToggle}
        className="flex h-10 w-10 items-center justify-center rounded-full text-soft-foreground transition-colors hover:bg-card hover:text-foreground"
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground" aria-label="Notificações">
              <Bell className="h-5 w-5" />
              {visiveis.length > 0 && <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{visiveis.length}</span>}
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
            <button className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-card">
              <Avatar url={userAvatar} nome={userName} size={36} />
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-semibold leading-tight text-foreground">{userName ?? "Equipe LCR"}</span>
                <span className="block text-[11px] capitalize leading-tight text-muted-foreground">{userRole ?? "Conectado"}</span>
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

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) => setOpenGroups((p) => ({ ...p, [label]: !p[label] }));

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

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col overflow-hidden bg-sidebar text-sidebar-foreground bg-gradient-to-b from-sidebar to-deep shadow-elevated transition-transform duration-200",
          collapsed ? "-translate-x-full" : "translate-x-0",
        )}
      >
        {/* Header — apenas a logo, centralizada */}
        <div className="flex items-center justify-center px-5 py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/95 shadow-soft"><LcrLogo size={34} /></div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2">
            {itens.map((it) => {
              if (!("group" in it)) {
                const active = leafAtiva(it, pathname, tabAtual);
                return (
                  <Link
                    key={it.label}
                    to={it.to as "/app"}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider shadow-soft transition-all duration-200",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "bg-sidebar-accent/50 text-sidebar-foreground/75 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground",
                    )}
                  >
                    {it.label}
                  </Link>
                );
              }
              const aberto = openGroups[it.group] ?? false;
              const temAtivo = it.itens.some((sub) => leafAtiva(sub, pathname, tabAtual));
              return (
                <div key={it.group}>
                  <button
                    onClick={() => toggleGroup(it.group)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider shadow-soft transition-all duration-200",
                      temAtivo
                        ? "bg-sidebar-primary/20 text-sidebar-foreground"
                        : "bg-sidebar-accent/50 text-sidebar-foreground/75 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground",
                    )}
                    aria-expanded={aberto}
                  >
                    <span className="flex-1 text-left">{it.group}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", aberto ? "" : "-rotate-90")} />
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
        <div className="p-3">
          <div className="flex items-center justify-between gap-2 rounded-xl bg-sidebar-accent/50 px-3 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar url={userAvatar} nome={userName} size={32} />
              <div className="min-w-0">
                <div className="truncate font-medium text-sidebar-foreground">{userName ?? "Equipe LCR"}</div>
                <div className="text-[11px] text-sidebar-foreground/55">Conectado</div>
              </div>
            </div>
            <button onClick={handleSignOut} className="rounded-lg p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className={cn("flex-1 transition-[margin] duration-200", collapsed ? "ml-0" : "ml-64")}>
        <TopBar userName={userName} userRole={userRole} userAvatar={userAvatar} collapsed={collapsed} onToggle={toggle} onSignOut={handleSignOut} />
        <div className="w-full px-6 pb-10 pt-2 lg:px-12">{children}</div>
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

/** Resumo consolidado no topo da tela — KPI cards (padrão NutriSense). */
export function ResumoTela({ itens }: { itens: { label: string; value: number | string; tone?: "default" | "warn" | "ok" }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {itens.map((it) => (
        <div key={it.label} className="rounded-xl bg-card px-5 py-4 shadow-soft transition-shadow duration-200 hover:shadow-card">
          <div className="label-cat">{it.label}</div>
          <div className={cn(
            "mt-1.5 text-[1.75rem] font-bold leading-none tracking-tight",
            it.tone === "warn" ? "text-destructive" : it.tone === "ok" ? "text-primary" : "text-foreground",
          )}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

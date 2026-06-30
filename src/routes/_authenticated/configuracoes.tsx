import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import {
  listIntegracoes, saveIntegracao, getMeuPerfil, getCockpitIntegracoes,
  listUsuarios, updateUsuario, listPlanoContas,
} from "@/lib/lcr.functions";
import { supabase } from "@/integrations/supabase/client";
import { ACESSOS, temAcesso } from "@/lib/acessos";
import { Plus, Trash2, ShieldCheck, Copy, Pencil, KeyRound, Activity, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: typeof s.tab === "string" ? s.tab : undefined }),
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "configuracoes", "/configuracoes"),
  head: () => ({ meta: [{ title: "Configurações — LCR Contábil" }] }),
  loader: async ({ context }) => {
    const perfil = await context.queryClient.ensureQueryData({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() });
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["integracoes"], queryFn: () => listIntegracoes() }),
    ]);
    if (perfil?.perfil === "admin") {
      await context.queryClient.ensureQueryData({ queryKey: ["usuarios"], queryFn: () => listUsuarios() });
    }
  },
  component: ConfiguracoesPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const INTEGRACOES_DEFS: { tipo: string; nome: string; campos: { key: string; label: string; type?: string }[] }[] = [
  { tipo: "gestta", nome: "Gestta", campos: [{ key: "api_key", label: "API Key", type: "password" }, { key: "base_url", label: "Base URL" }] },
  { tipo: "sci", nome: "SCI Único", campos: [{ key: "url", label: "URL" }, { key: "usuario", label: "Usuário" }, { key: "senha", label: "Senha", type: "password" }] },
  { tipo: "leveldrive", nome: "LevelDrive", campos: [{ key: "path", label: "Caminho da pasta" }] },
  { tipo: "sharepoint", nome: "SharePoint", campos: [{ key: "folder_url", label: "URL da pasta" }] },
  { tipo: "claude_api", nome: "Claude API", campos: [{ key: "api_key", label: "API Key", type: "password" }, { key: "model", label: "Modelo" }] },
];

function ConfiguracoesPage() {
  const { data: perfil } = useSuspenseQuery({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() });
  const acessos = perfil?.acessos ?? [];
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const tabs = [
    { key: "integracoes", acesso: "configuracoes:integracoes", label: "Integrações", el: <IntegracoesTab /> },
    { key: "usuarios", acesso: "configuracoes:usuarios", label: "Usuários", el: <UsuariosTab /> },
    { key: "plano", acesso: "configuracoes:plano", label: "Plano de contas", el: <PlanoContasTab /> },
  ].filter((t) => temAcesso(acessos, t.acesso));

  const active = tabs.find((t) => t.key === search.tab)?.key ?? tabs[0]?.key;

  return (
    <>
      <PageHeader title="Configurações" description="Integrações externas, equipe LCR e plano de contas." />
      {tabs.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Você não tem acesso a nenhuma configuração.</CardContent></Card>
      ) : (
        <Tabs value={active} onValueChange={(v) => navigate({ search: { tab: v }, replace: true })}>
          <TabsList>
            {tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>
          {tabs.map((t) => <TabsContent key={t.key} value={t.key} className="mt-4">{t.el}</TabsContent>)}
        </Tabs>
      )}
    </>
  );
}

function IntegracoesTab() {
  const qc = useQueryClient();
  const { data: integracoes } = useSuspenseQuery({ queryKey: ["integracoes"], queryFn: () => listIntegracoes() });

  return (
    <Tabs defaultValue="cockpit" className="space-y-4">
      <TabsList>
        <TabsTrigger value="cockpit" className="gap-2"><Activity className="h-4 w-4" />Cockpit</TabsTrigger>
        <TabsTrigger value="configurar" className="gap-2"><Settings2 className="h-4 w-4" />Configurar</TabsTrigger>
      </TabsList>

      <TabsContent value="cockpit" className="mt-0">
        <CockpitView />
      </TabsContent>

      <TabsContent value="configurar" className="mt-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {INTEGRACOES_DEFS.map((def) => {
            const atual = integracoes.find((i) => i.tipo === def.tipo);
            return <IntegracaoCard key={def.tipo} def={def} status={atual?.status ?? "desconectado"} initialConfig={(atual?.config as Record<string, string>) ?? {}} onSaved={() => qc.invalidateQueries({ queryKey: ["integracoes"] })} />;
          })}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function formatRelativo(iso: string | null): string {
  if (!iso) return "sem atividade";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "agora";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "há segundos";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function CockpitView() {
  const { data, isLoading } = useQuery({
    queryKey: ["cockpit-integracoes"],
    queryFn: () => getCockpitIntegracoes(),
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Carregando cockpit operacional…</CardContent></Card>;
  }

  const online = data.automacoes.filter((a) => a.conectada);
  const offlineCount = data.total - data.conectadas;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-foreground text-background">
          <CardContent className="pt-6 pb-5">
            <div className="text-xs uppercase tracking-wide text-background/70">Automações conectadas</div>
            <div className="font-display text-4xl mt-1">{data.conectadas}<span className="text-background/60 text-2xl"> / {data.total}</span></div>
            <div className="mt-3 flex items-center gap-2 text-xs text-background/70">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" /></span>
              monitorando em tempo real
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Offline / pendentes</div>
            <div className="font-display text-4xl mt-1">{offlineCount}</div>
            <div className="mt-3 text-xs text-muted-foreground">Configure em "Configurar" para entrar no ar.</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Última leitura</div>
            <div className="font-display text-4xl mt-1">{formatRelativo(data.gerado_em)}</div>
            <div className="mt-3 text-xs text-muted-foreground">Atualiza a cada 15s.</div>
          </CardContent>
        </Card>
      </div>

      {online.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhuma automação conectada no momento. Vá em "Configurar" para ativar.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {online.map((a) => (
            <Card key={a.tipo} className="card-interactive">
              <CardContent className="pt-5 pb-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.categoria}</div>
                    <h4 className="font-display text-lg leading-tight">{a.nome}</h4>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 text-green-700 px-2.5 py-1 text-[11px] font-medium">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
                    online
                  </div>
                </div>

                <p className="text-xs text-soft-foreground leading-relaxed">{a.descricao}</p>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.metrica1.label}</div>
                    <div className="font-display text-lg mt-0.5">{a.metrica1.value}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.metrica2.label}</div>
                    <div className="font-display text-lg mt-0.5">{a.metrica2.value}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/60 pt-3">
                  <span>Última atividade</span>
                  <span className="font-medium text-foreground">{formatRelativo(a.ultimaAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function IntegracaoCard({ def, status, initialConfig, onSaved }: { def: typeof INTEGRACOES_DEFS[0]; status: string; initialConfig: Record<string, string>; onSaved: () => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>(initialConfig);
  const [loading, setLoading] = useState(false);
  useEffect(() => setCfg(initialConfig), [initialConfig]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await saveIntegracao({ data: { tipo: def.tipo, config: cfg } });
      toast.success(`${def.nome} salvo.`);
      onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  return (
    <Card className="card-interactive">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg">{def.nome}</h3>
          <StatusPill variant={status === "configurado" ? "doing" : "next"}>{status === "configurado" ? "Configurado" : "Desconectado"}</StatusPill>
        </div>
        <form onSubmit={salvar} className="space-y-3">
          {def.campos.map((c) => (
            <div key={c.key} className="space-y-1.5">
              <Label>{c.label}</Label>
              <Input type={c.type ?? "text"} value={cfg[c.key] ?? ""} onChange={(e) => setCfg({ ...cfg, [c.key]: e.target.value })} />
            </div>
          ))}
          <Button type="submit" disabled={loading} size="sm">{loading ? "Salvando..." : "Salvar"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Usuários (admin)
// ---------------------------------------------------------------------
type Usuario = { id: string; user_id: string; nome: string; email: string | null; perfil: "admin" | "consultor" | "assistente"; ativo: boolean; permissoes_custom: string[] | null };

async function invocarAdminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.error ?? "Falha na operação");
  return data;
}

function AcessosChecklist({ selecionados, onToggle, disabled }: { selecionados: string[]; onToggle: (key: string, on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      {ACESSOS.map((a) => (
        <div key={a.key}>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={selecionados.includes(a.key)} disabled={disabled} onCheckedChange={(v) => onToggle(a.key, !!v)} />
            {a.label}
          </label>
          {a.filhos?.map((f) => (
            <label key={f.key} className="ml-6 flex items-center gap-2 text-sm text-soft-foreground">
              <Checkbox checked={selecionados.includes(f.key)} disabled={disabled} onCheckedChange={(v) => onToggle(f.key, !!v)} />
              {f.label}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function UsuariosTab() {
  const qc = useQueryClient();
  const { data: usuarios } = useSuspenseQuery({ queryKey: ["usuarios"], queryFn: () => listUsuarios() });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["usuarios"] }); qc.invalidateQueries({ queryKey: ["consultores"] }); };

  async function alternarAtivo(id: string, ativo: boolean) {
    try { await updateUsuario({ data: { id, ativo } }); invalidate(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
  }
  async function excluir(u: Usuario) {
    if (!confirm(`Excluir ${u.nome}? Esta ação remove o acesso do usuário.`)) return;
    try { await invocarAdminUsers({ action: "delete", user_id: u.user_id }); toast.success("Usuário excluído."); invalidate(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">Usuários</h3>
          <p className="text-sm text-muted-foreground">Crie, edite os dados e o acesso, redefina a senha ou exclua cada pessoa.</p>
        </div>
        <NovoUsuarioDialog onCreated={invalidate} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nome</TableHead><TableHead>Email</TableHead><TableHead>Perfil</TableHead><TableHead>Acesso</TableHead><TableHead>Ativo</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(usuarios as Usuario[]).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.nome}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                <TableCell><StatusPill variant={u.perfil === "admin" ? "now" : u.perfil === "consultor" ? "doing" : "next"}>{u.perfil}</StatusPill></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.perfil === "admin" ? "Total" : u.permissoes_custom == null ? "Herda do perfil" : "Personalizado"}
                </TableCell>
                <TableCell><Switch checked={u.ativo} onCheckedChange={(v) => alternarAtivo(u.id, v)} /></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <EditarUsuarioDialog usuario={u} onSaved={invalidate} />
                    <ResetarSenhaDialog usuario={u} />
                    <Button variant="ghost" size="icon" onClick={() => excluir(u)} title="Excluir usuário"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NovoUsuarioDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", perfil: "assistente" as Usuario["perfil"], senha: "" });
  const [loading, setLoading] = useState(false);
  const [criado, setCriado] = useState<{ email: string; senha: string } | null>(null);

  function reset() {
    setForm({ nome: "", email: "", perfil: "assistente", senha: "" });
    setCriado(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await invocarAdminUsers({ action: "create", nome: form.nome, email: form.email, perfil: form.perfil, senha: form.senha || undefined });
      onCreated();
      setCriado({ email: (res?.email as string) ?? form.email, senha: (res?.senha_temporaria as string) ?? form.senha });
      toast.success("Usuário criado.");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Novo usuário</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Novo usuário</DialogTitle></DialogHeader>
        {criado ? (
          <div className="space-y-4">
            <p className="text-sm text-soft-foreground">Usuário criado. Repasse estas credenciais — a pessoa entra com e-mail e a senha temporária e pode trocá-la depois.</p>
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">E-mail</span><span className="font-mono">{criado.email}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Senha temporária</span><span className="font-mono font-medium">{criado.senha}</span></div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(`E-mail: ${criado.email}\nSenha: ${criado.senha}`); toast.success("Credenciais copiadas."); }}>
                <Copy className="h-4 w-4 mr-1" />Copiar
              </Button>
              <Button onClick={() => { setOpen(false); reset(); }}>Concluir</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5"><Label>Nome</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select value={form.perfil} onValueChange={(v) => setForm({ ...form, perfil: v as Usuario["perfil"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="consultor">consultor</SelectItem>
                  <SelectItem value="assistente">assistente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Senha temporária <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder="Em branco = gerar automaticamente" />
            </div>
            <p className="text-xs text-muted-foreground">O acesso segue o preset do perfil. Ajuste permissões individuais depois, se necessário.</p>
            <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar usuário"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditarUsuarioDialog({ usuario, onSaved }: { usuario: Usuario; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(usuario.nome);
  const [email, setEmail] = useState(usuario.email ?? "");
  const [perfil, setPerfil] = useState<Usuario["perfil"]>(usuario.perfil);
  const [herda, setHerda] = useState(usuario.permissoes_custom == null);
  const [chaves, setChaves] = useState<string[]>(usuario.permissoes_custom ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(usuario.nome); setEmail(usuario.email ?? ""); setPerfil(usuario.perfil);
    setHerda(usuario.permissoes_custom == null); setChaves(usuario.permissoes_custom ?? []);
  }, [open, usuario]);

  function toggle(key: string, on: boolean) {
    setChaves((prev) => on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key));
  }

  async function salvar() {
    setLoading(true);
    try {
      await invocarAdminUsers({ action: "update", user_id: usuario.user_id, nome, email, perfil, permissoes_custom: herda ? null : chaves });
      toast.success("Usuário atualizado.");
      onSaved();
      setOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  const ehAdmin = perfil === "admin";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" title="Editar usuário"><Pencil className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">Editar — {usuario.nome}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email (login)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Perfil</Label>
            <Select value={perfil} onValueChange={(v) => setPerfil(v as Usuario["perfil"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="consultor">consultor</SelectItem>
                <SelectItem value="assistente">assistente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Acesso por menu</Label>
            {ehAdmin ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Administradores têm acesso total a todos os menus.</p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={herda} onCheckedChange={setHerda} /> Herdar do perfil <span className="text-muted-foreground">({perfil})</span>
                </label>
                <AcessosChecklist selecionados={herda ? [] : chaves} onToggle={toggle} disabled={herda} />
              </>
            )}
          </div>
          <DialogFooter><Button onClick={salvar} disabled={loading}>{loading ? "Salvando..." : "Salvar alterações"}</Button></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetarSenhaDialog({ usuario }: { usuario: Usuario }) {
  const [open, setOpen] = useState(false);
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [nova, setNova] = useState<{ email: string; senha: string } | null>(null);

  function reset() { setSenha(""); setNova(null); }

  async function confirmar() {
    setLoading(true);
    try {
      const res = await invocarAdminUsers({ action: "reset_password", user_id: usuario.user_id, senha: senha || undefined });
      setNova({ email: (res?.email as string) ?? usuario.email ?? "", senha: (res?.senha_temporaria as string) ?? senha });
      toast.success("Senha redefinida.");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" title="Redefinir senha"><KeyRound className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Redefinir senha — {usuario.nome}</DialogTitle></DialogHeader>
        {nova ? (
          <div className="space-y-4">
            <p className="text-sm text-soft-foreground">Senha redefinida. Repasse as credenciais à pessoa — ela entra com e-mail e a nova senha.</p>
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">E-mail</span><span className="font-mono">{nova.email}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Nova senha</span><span className="font-mono font-medium">{nova.senha}</span></div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(`E-mail: ${nova.email}\nSenha: ${nova.senha}`); toast.success("Credenciais copiadas."); }}>
                <Copy className="h-4 w-4 mr-1" />Copiar
              </Button>
              <Button onClick={() => { setOpen(false); reset(); }}>Concluir</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nova senha <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Em branco = gerar automaticamente" />
            </div>
            <DialogFooter><Button onClick={confirmar} disabled={loading}>{loading ? "Redefinindo..." : "Redefinir senha"}</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TIPO_LABEL: Record<string, string> = { ativo: "Ativo", passivo: "Passivo", receita: "Receitas", despesa: "Despesas", outros: "Outros" };

function PlanoContasTab() {
  const { data, isLoading } = useQuery({ queryKey: ["plano-contas"], queryFn: () => listPlanoContas() });
  const [q, setQ] = useState("");
  const contas = (data ?? []).filter((c) =>
    !q || c.codigo.includes(q) || c.descricao.toLowerCase().includes(q.toLowerCase())
  );
  const porTipo = contas.reduce<Record<string, typeof contas>>((acc, c) => {
    const t = c.tipo ?? "outros";
    (acc[t] ??= []).push(c);
    return acc;
  }, {});

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Plano de contas real da LCR — {data?.length ?? 0} contas.</p>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código ou descrição" className="max-w-xs" />
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && contas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta encontrada.</p>}
        <div className="max-h-[60vh] space-y-5 overflow-y-auto font-mono text-sm">
          {Object.entries(porTipo).map(([tipo, lista]) => (
            <div key={tipo}>
              <div className="mb-1 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TIPO_LABEL[tipo] ?? tipo} · {lista.length}</div>
              {lista.map((c) => (
                <div key={c.codigo} className="flex gap-3 py-0.5">
                  <span className="w-14 shrink-0 text-muted-foreground">{c.codigo}</span>
                  <span className={c.ativo ? "text-foreground" : "text-muted-foreground line-through"}>{c.descricao}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

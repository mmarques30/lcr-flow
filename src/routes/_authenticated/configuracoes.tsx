import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
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
  listIntegracoes, saveIntegracao, getMeuPerfil,
  listUsuarios, updateUsuario, listPresetsPermissoes, savePresetPermissoes,
} from "@/lib/lcr.functions";
import { supabase } from "@/integrations/supabase/client";
import { ACESSOS, TODAS_CHAVES, temAcesso } from "@/lib/acessos";
import { Plus, Trash2, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "configuracoes", "/configuracoes"),
  head: () => ({ meta: [{ title: "Configurações — LCR Contábil" }] }),
  loader: async ({ context }) => {
    const perfil = await context.queryClient.ensureQueryData({ queryKey: ["meu-perfil"], queryFn: () => getMeuPerfil() });
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["integracoes"], queryFn: () => listIntegracoes() }),
    ]);
    if (perfil?.perfil === "admin") {
      await Promise.all([
        context.queryClient.ensureQueryData({ queryKey: ["usuarios"], queryFn: () => listUsuarios() }),
        context.queryClient.ensureQueryData({ queryKey: ["presets-permissoes"], queryFn: () => listPresetsPermissoes() }),
      ]);
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

  const tabs = [
    { key: "integracoes", acesso: "configuracoes:integracoes", label: "Integrações", el: <IntegracoesTab /> },
    { key: "usuarios", acesso: "configuracoes:usuarios", label: "Usuários", el: <UsuariosTab /> },
    { key: "plano", acesso: "configuracoes:plano", label: "Plano de contas", el: <PlanoContasTab /> },
  ].filter((t) => temAcesso(acessos, t.acesso));

  return (
    <>
      <PageHeader title="Configurações" description="Integrações externas, equipe LCR e plano de contas." />
      {tabs.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Você não tem acesso a nenhuma configuração.</CardContent></Card>
      ) : (
        <Tabs defaultValue={tabs[0].key}>
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {INTEGRACOES_DEFS.map((def) => {
        const atual = integracoes.find((i) => i.tipo === def.tipo);
        return <IntegracaoCard key={def.tipo} def={def} status={atual?.status ?? "desconectado"} initialConfig={(atual?.config as Record<string, string>) ?? {}} onSaved={() => qc.invalidateQueries({ queryKey: ["integracoes"] })} />;
      })}
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

  async function mudarPerfil(id: string, perfil: Usuario["perfil"]) {
    try { await updateUsuario({ data: { id, perfil } }); toast.success("Perfil atualizado."); invalidate(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
  }
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
          <p className="text-sm text-muted-foreground">Crie, exclua e defina o acesso de cada pessoa.</p>
        </div>
        <NovoUsuarioDialog onCreated={invalidate} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nome</TableHead><TableHead>Email</TableHead><TableHead>Perfil</TableHead><TableHead>Acesso</TableHead><TableHead>Ativo</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(usuarios as Usuario[]).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.nome}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                <TableCell>
                  <Select value={u.perfil} onValueChange={(v) => mudarPerfil(u.id, v as Usuario["perfil"])}>
                    <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="consultor">consultor</SelectItem>
                      <SelectItem value="assistente">assistente</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <PermissoesUsuarioDialog usuario={u} onSaved={invalidate} />
                </TableCell>
                <TableCell><Switch checked={u.ativo} onCheckedChange={(v) => alternarAtivo(u.id, v)} /></TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => excluir(u)} title="Excluir usuário"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <PresetsEditor />
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

function PermissoesUsuarioDialog({ usuario, onSaved }: { usuario: Usuario; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const herdaInicial = usuario.permissoes_custom == null;
  const [herda, setHerda] = useState(herdaInicial);
  const [chaves, setChaves] = useState<string[]>(usuario.permissoes_custom ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setHerda(usuario.permissoes_custom == null); setChaves(usuario.permissoes_custom ?? []); }, [usuario, open]);

  function toggle(key: string, on: boolean) {
    setChaves((prev) => on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key));
  }

  async function salvar() {
    setLoading(true);
    try {
      await updateUsuario({ data: { id: usuario.id, permissoes_custom: herda ? null : chaves } });
      toast.success("Permissões salvas.");
      onSaved();
      setOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  const ehAdmin = usuario.perfil === "admin";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {ehAdmin ? "Acesso total" : usuario.permissoes_custom == null ? "Herda do perfil" : "Personalizado"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Acesso — {usuario.nome}</DialogTitle></DialogHeader>
        {ehAdmin ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Administradores têm acesso total a todos os menus.</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={herda} onCheckedChange={setHerda} /> Herdar permissões do perfil <span className="text-muted-foreground">({usuario.perfil})</span>
            </label>
            <AcessosChecklist selecionados={herda ? [] : chaves} onToggle={toggle} disabled={herda} />
            <DialogFooter><Button onClick={salvar} disabled={loading}>{loading ? "Salvando..." : "Salvar acesso"}</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PresetsEditor() {
  const { data: presets } = useSuspenseQuery({ queryKey: ["presets-permissoes"], queryFn: () => listPresetsPermissoes() });
  return (
    <div>
      <h3 className="font-display text-lg mb-1">Presets por perfil</h3>
      <p className="text-sm text-muted-foreground mb-3">Acessos padrão de cada perfil (usados quando o usuário herda do perfil).</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {["admin", "consultor", "assistente"].map((perfil) => {
          const preset = presets.find((p) => p.perfil === perfil);
          return <PresetCard key={perfil} perfil={perfil} chaves={preset?.chaves ?? []} />;
        })}
      </div>
    </div>
  );
}

function PresetCard({ perfil, chaves }: { perfil: string; chaves: string[] }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string[]>(chaves);
  const [loading, setLoading] = useState(false);
  useEffect(() => setSel(chaves), [chaves]);
  const bloqueado = perfil === "admin";

  function toggle(key: string, on: boolean) {
    setSel((prev) => on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key));
  }
  async function salvar() {
    setLoading(true);
    try {
      await savePresetPermissoes({ data: { perfil: perfil as "admin" | "consultor" | "assistente", chaves: bloqueado ? TODAS_CHAVES : sel } });
      toast.success(`Preset de ${perfil} salvo.`);
      qc.invalidateQueries({ queryKey: ["presets-permissoes"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <StatusPill variant={perfil === "admin" ? "now" : perfil === "consultor" ? "doing" : "next"}>{perfil}</StatusPill>
        </div>
        {bloqueado ? (
          <p className="text-sm text-muted-foreground">Acesso total (não editável).</p>
        ) : (
          <>
            <AcessosChecklist selecionados={sel} onToggle={toggle} />
            <Button size="sm" onClick={salvar} disabled={loading}>{loading ? "Salvando..." : "Salvar preset"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const PLANO = [
  { codigo: "1", nome: "Ativo", filhos: [
    { codigo: "1.1", nome: "Ativo Circulante", filhos: [
      { codigo: "1.1.01", nome: "Caixa e Equivalentes" },
      { codigo: "1.1.02", nome: "Bancos Conta Movimento" },
      { codigo: "1.1.03", nome: "Clientes a Receber" },
    ]},
  ]},
  { codigo: "3", nome: "Receitas", filhos: [
    { codigo: "3.1", nome: "Receita Operacional", filhos: [
      { codigo: "3.1.01", nome: "Vendas de Serviços" },
      { codigo: "3.1.02", nome: "Vendas de Mercadorias" },
    ]},
  ]},
  { codigo: "4", nome: "Despesas", filhos: [
    { codigo: "4.1", nome: "Despesas Operacionais", filhos: [
      { codigo: "4.1.02", nome: "Fornecedores" },
      { codigo: "4.3.01", nome: "Tarifas Bancárias" },
      { codigo: "4.4.01", nome: "Impostos e Taxas" },
    ]},
  ]},
];

function PlanoContasTab() {
  return (
    <Card>
      <CardContent className="pt-6 font-mono text-sm">
        <p className="font-sans text-muted-foreground mb-4">Plano de contas padrão LCR (mockup — editável em breve).</p>
        {PLANO.map((g) => (
          <div key={g.codigo} className="mb-4">
            <div className="font-bold text-foreground">{g.codigo} — {g.nome}</div>
            {g.filhos?.map((f) => (
              <div key={f.codigo} className="ml-4">
                <div className="text-soft-foreground">{f.codigo} — {f.nome}</div>
                {f.filhos?.map((c) => <div key={c.codigo} className="ml-4 text-muted-foreground">{c.codigo} — {c.nome}</div>)}
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

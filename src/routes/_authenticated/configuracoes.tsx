import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import { listIntegracoes, saveIntegracao, listConsultores } from "@/lib/lcr.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — LCR Contábil" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["integracoes"], queryFn: () => listIntegracoes() }),
      context.queryClient.ensureQueryData({ queryKey: ["consultores"], queryFn: () => listConsultores() }),
    ]);
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
  return (
    <>
      <PageHeader title="Configurações" description="Integrações externas, equipe LCR e plano de contas." />
      <Tabs defaultValue="integracoes">
        <TabsList>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="plano">Plano de contas</TabsTrigger>
        </TabsList>
        <TabsContent value="integracoes" className="mt-4"><IntegracoesTab /></TabsContent>
        <TabsContent value="usuarios" className="mt-4"><UsuariosTab /></TabsContent>
        <TabsContent value="plano" className="mt-4"><PlanoContasTab /></TabsContent>
      </Tabs>
    </>
  );
}

function IntegracoesTab() {
  const qc = useQueryClient();
  const { data: integracoes } = useSuspenseQuery({ queryKey: ["integracoes"], queryFn: () => listIntegracoes() });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

function UsuariosTab() {
  const { data: consultores } = useSuspenseQuery({ queryKey: ["consultores"], queryFn: () => listConsultores() });
  return (
    <Card className="border-border">
      <Table>
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Email</TableHead><TableHead>Perfil</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {consultores.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.nome}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
              <TableCell><StatusPill variant={u.perfil === "admin" ? "now" : u.perfil === "consultor" ? "doing" : "next"}>{u.perfil}</StatusPill></TableCell>
              <TableCell><StatusPill variant={u.ativo ? "now" : "neutral"}>{u.ativo ? "Ativo" : "Inativo"}</StatusPill></TableCell>
            </TableRow>
          ))}
          {consultores.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum usuário ainda — crie uma conta em /auth.</TableCell></TableRow>}
        </TableBody>
      </Table>
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
    <Card className="border-border">
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

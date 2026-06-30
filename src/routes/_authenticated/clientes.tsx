import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Search, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listEmpresasPaginadas, getEmpresasResumo, listConsultores, createEmpresa, updateEmpresa, deleteEmpresa } from "@/lib/lcr.functions";
import { REGIME_LABEL, EMPRESA_STATUS_LABEL, DOC_TIPO_LABEL, formatCNPJ } from "@/lib/format";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/clientes")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "clientes", "/clientes"),
  head: () => ({ meta: [{ title: "Clientes — LCR Contábil" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["empresas-resumo"], queryFn: () => getEmpresasResumo() }),
      context.queryClient.ensureQueryData({ queryKey: ["consultores"], queryFn: () => listConsultores() }),
    ]);
  },
  component: ClientesPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

// Debounce simples para a busca (evita 1 request por tecla com 902+ clientes).
function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ClientesPage() {
  const qc = useQueryClient();
  const { data: resumoServer } = useSuspenseQuery({ queryKey: ["empresas-resumo"], queryFn: () => getEmpresasResumo() });
  const { data: consultores } = useSuspenseQuery({ queryKey: ["consultores"], queryFn: () => listConsultores() });
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [regime, setRegime] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [open, setOpen] = useState(false);

  useEffect(() => { setPage(1); }, [qDebounced, status, regime]);

  const { data: pageData, isFetching } = useQuery({
    queryKey: ["empresas-paginadas", qDebounced, status, page],
    queryFn: () => listEmpresasPaginadas({ data: { q: qDebounced || undefined, status: status === "all" ? undefined : status, page, pageSize } }),
    placeholderData: keepPreviousData,
  });

  // Regime filtra no cliente (não está indexado, e a maioria está NULL hoje).
  const items = (pageData?.items ?? []).filter((e) => regime === "all" || e.regime === regime);
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const resumo = useMemo(() => ([
    { label: "Clientes", value: resumoServer.total },
    { label: "Em dia", value: resumoServer.em_dia, tone: "ok" as const },
    { label: "Em cobrança", value: resumoServer.cobranca },
    { label: "Atrasados", value: resumoServer.atrasado, tone: "warn" as const },
    { label: "Entregues", value: resumoServer.entregue, tone: "ok" as const },
  ]), [resumoServer]);

  async function excluir(e: { id: string; razao_social: string }) {
    if (!confirm(`Excluir ${e.razao_social}? Remove também contas, documentos e tarefas vinculadas.`)) return;
    try {
      await deleteEmpresa({ data: { id: e.id } });
      toast.success("Cliente excluído.");
      qc.invalidateQueries({ queryKey: ["empresas-paginadas"] });
      qc.invalidateQueries({ queryKey: ["empresas-resumo"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao excluir"); }
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Empresas atendidas pela LCR e o status do mês corrente."
        actions={
          <>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" />Novo cliente</Button>
              </DialogTrigger>
              <NovoClienteDialog consultores={consultores} onSuccess={() => setOpen(false)} />
            </Dialog>
          </>
        }
      />

      <ResumoTela itens={resumo} />

      <Card className="border-border">
        <div className="space-y-3 border-b border-border p-4">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">Todos</TabsTrigger>
              {Object.entries(EMPRESA_STATUS_LABEL).map(([k, v]) => <TabsTrigger key={k} value={k}>{v}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por razão social" className="pl-8" />
            </div>
            <Select value={regime} onValueChange={setRegime}>
              <SelectTrigger><SelectValue placeholder="Regime" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os regimes</SelectItem>
                {Object.entries(REGIME_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">{total} cliente(s){isFetching && q !== qDebounced ? " · buscando…" : ""}</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Razão Social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Consultor</TableHead>
              <TableHead>Status do mês</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id} className="hover:bg-muted/50">
                <TableCell>
                  <Link to="/clientes/$id" params={{ id: e.id }} className="font-medium text-foreground hover:text-primary">
                    {e.razao_social}
                  </Link>
                  {e.nome_fantasia ? <div className="text-xs text-muted-foreground">{e.nome_fantasia}</div> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.cnpj ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-sm">{e.usuarios_perfil?.nome ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><StatusPill variant={variantFor(e.status)}>{EMPRESA_STATUS_LABEL[e.status]}</StatusPill></TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {(e.tags ?? []).map((t) => (
                      <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-soft-foreground">#{t}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <EditarClienteDialog empresa={e} consultores={consultores} />
                    <Button variant="ghost" size="icon" onClick={() => excluir(e)} title="Excluir cliente"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{isFetching ? "Carregando…" : "Nenhum cliente encontrado."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <div className="text-muted-foreground">Página {page} de {totalPages} · {total} cliente(s)</div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Próxima <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

const TIPOS_DOC = Object.keys(DOC_TIPO_LABEL);

function NovoClienteDialog({ consultores, onSuccess }: { consultores: { id: string; nome: string }[]; onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    razao_social: "",
    nome_fantasia: "",
    cnpj: "",
    regime: "simples" as "simples" | "presumido" | "real" | "mei",
    segmento: "",
    consultor_id: "",
    tags: "",
  });
  const [contas, setContas] = useState<{ banco: string; agencia: string; conta: string }[]>([{ banco: "", agencia: "", conta: "" }]);
  const [docs, setDocs] = useState<string[]>(["extrato", "nf_saida", "nf_entrada"]);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await createEmpresa({
        data: {
          razao_social: form.razao_social,
          nome_fantasia: form.nome_fantasia || null,
          cnpj: form.cnpj,
          regime: form.regime,
          segmento: form.segmento || null,
          consultor_id: form.consultor_id || null,
          tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
          contas: contas.filter((c) => c.banco && c.conta),
          documentos_esperados: docs,
        },
      });
      toast.success("Cliente cadastrado.");
      qc.invalidateQueries({ queryKey: ["empresas-paginadas"] }); qc.invalidateQueries({ queryKey: ["empresas-resumo"] });
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Novo cliente</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-3">
          <h3 className="font-medium text-sm text-soft-foreground uppercase tracking-wide">Dados básicos</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Razão social *</Label>
              <Input required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} />
            </div>
            <div className="space-y-1.5"><Label>Nome fantasia</Label><Input value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>CNPJ *</Label><Input required value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: formatCNPJ(e.target.value) })} /></div>
            <div className="space-y-1.5">
              <Label>Regime</Label>
              <Select value={form.regime} onValueChange={(v) => setForm({ ...form, regime: v as typeof form.regime })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(REGIME_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Segmento</Label><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Consultor responsável</Label>
              <Select value={form.consultor_id || "none"} onValueChange={(v) => setForm({ ...form, consultor_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {consultores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="atípico, baixo volume" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium text-sm text-soft-foreground uppercase tracking-wide">Contas bancárias</h3>
          {contas.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <Input className="col-span-5" placeholder="Banco" value={c.banco} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, banco: e.target.value } : x))} />
              <Input className="col-span-3" placeholder="Agência" value={c.agencia} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, agencia: e.target.value } : x))} />
              <Input className="col-span-3" placeholder="Conta" value={c.conta} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, conta: e.target.value } : x))} />
              <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => setContas(contas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setContas([...contas, { banco: "", agencia: "", conta: "" }])}><Plus className="h-4 w-4 mr-1" />Adicionar conta</Button>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium text-sm text-soft-foreground uppercase tracking-wide">Documentos esperados</h3>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_DOC.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <Checkbox checked={docs.includes(t)} onCheckedChange={(v) => setDocs(v ? [...docs, t] : docs.filter((x) => x !== t))} />
                {DOC_TIPO_LABEL[t]}
              </label>
            ))}
          </div>
        </section>

        <DialogFooter>
          <Button type="submit" disabled={loading}>{loading ? "Salvando..." : "Cadastrar cliente"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

type EmpresaEdit = {
  id: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null;
  regime: "simples" | "presumido" | "real" | "mei" | null; segmento: string | null;
  consultor_id: string | null; tags: string[] | null;
};

function EditarClienteDialog({ empresa, consultores }: { empresa: EmpresaEdit; consultores: { id: string; nome: string }[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    razao_social: empresa.razao_social,
    nome_fantasia: empresa.nome_fantasia ?? "",
    cnpj: empresa.cnpj ?? "",
    regime: empresa.regime ?? "simples",
    segmento: empresa.segmento ?? "",
    consultor_id: empresa.consultor_id ?? "",
    tags: (empresa.tags ?? []).join(", "),
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      razao_social: empresa.razao_social,
      nome_fantasia: empresa.nome_fantasia ?? "",
      cnpj: empresa.cnpj ?? "",
      regime: empresa.regime ?? "simples",
      segmento: empresa.segmento ?? "",
      consultor_id: empresa.consultor_id ?? "",
      tags: (empresa.tags ?? []).join(", "),
    });
  }, [open, empresa]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await updateEmpresa({
        data: {
          id: empresa.id,
          razao_social: form.razao_social,
          nome_fantasia: form.nome_fantasia || null,
          cnpj: form.cnpj,
          regime: form.regime,
          segmento: form.segmento || null,
          consultor_id: form.consultor_id || null,
          tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      toast.success("Cliente atualizado.");
      qc.invalidateQueries({ queryKey: ["empresas-paginadas"] }); qc.invalidateQueries({ queryKey: ["empresas-resumo"] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" title="Editar cliente"><Pencil className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">Editar cliente</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5"><Label>Razão social *</Label><Input required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Nome fantasia</Label><Input value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>CNPJ *</Label><Input required value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: formatCNPJ(e.target.value) })} /></div>
            <div className="space-y-1.5">
              <Label>Regime</Label>
              <Select value={form.regime} onValueChange={(v) => setForm({ ...form, regime: v as typeof form.regime })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(REGIME_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Segmento</Label><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} /></div>
            <div className="col-span-2 space-y-1.5">
              <Label>Consultor responsável</Label>
              <Select value={form.consultor_id || "none"} onValueChange={(v) => setForm({ ...form, consultor_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {consultores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="atípico, baixo volume" />
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Salvando..." : "Salvar alterações"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Search, Pencil, ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listEmpresasPaginadas, getEmpresasResumo, listConsultores, getEmpresa, updateEmpresa, deleteEmpresa, listEmpresasQualidade } from "@/lib/lcr.functions";
import { REGIME_LABEL, EMPRESA_STATUS_LABEL, DOC_TIPO_LABEL, formatCNPJ, formatCompetencia, competenciaAtual } from "@/lib/format";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";
import { cn } from "@/lib/utils";

type FaixaQualidade = "alta" | "media" | "baixa";
type ClientesSearch = { filtro?: "qualidade"; faixa?: FaixaQualidade; competencia?: string };

export const Route = createFileRoute("/_authenticated/clientes")({
  validateSearch: (s: Record<string, unknown>): ClientesSearch => ({
    filtro: s.filtro === "qualidade" ? "qualidade" : undefined,
    faixa: (["alta", "media", "baixa"] as const).includes(s.faixa as FaixaQualidade) ? (s.faixa as FaixaQualidade) : undefined,
    // Competência que gerou os números do card do dashboard — mantém a Visão
    // Qualidade coerente com o que foi clicado (senão cairia no mês default).
    competencia: typeof s.competencia === "string" && /^\d{4}-\d{2}$/.test(s.competencia) ? s.competencia : undefined,
  }),
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
  const search = Route.useSearch();
  if (search.filtro === "qualidade") return <QualidadeCarteira faixaInicial={search.faixa} competenciaInicial={search.competencia} />;
  return <ListaClientes />;
}

function ListaClientes() {
  const qc = useQueryClient();
  const { data: resumoServer } = useSuspenseQuery({ queryKey: ["empresas-resumo"], queryFn: () => getEmpresasResumo() });
  const { data: consultores } = useSuspenseQuery({ queryKey: ["consultores"], queryFn: () => listConsultores() });
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [regime, setRegime] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

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
      {/* Sem cadastro manual: cliente entra automaticamente via extração do
          Gestta. Aqui só se consulta e edita. */}
      <PageHeader
        title="Clientes"
        description="Empresas atendidas pela LCR e o status do mês corrente. Novos clientes entram automaticamente pela integração com o Gestta."
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
                    <EditarClienteSheet empresaId={e.id} consultores={consultores} />
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

const FAIXA_META: Record<FaixaQualidade, { badge: string }> = {
  alta: { badge: "bg-primary/10 text-primary" },
  media: { badge: "bg-amber-100 text-amber-700" },
  baixa: { badge: "bg-destructive/10 text-destructive" },
};

// Visão "Qualidade da carteira" (/clientes?filtro=qualidade): empresas anotadas
// com a confiança média da IA no mês, filtráveis por faixa. Serve p/ o time
// separar semi-automático (≥80%) de revisão parcial/total (Cleiton).
function QualidadeCarteira({ faixaInicial, competenciaInicial }: { faixaInicial?: FaixaQualidade; competenciaInicial?: string }) {
  // Usa a competência que veio do card do dashboard (coerência com os números
  // clicados); só cai no mês de trabalho default se entrar direto pela URL.
  const competencia = competenciaInicial ?? competenciaAtual();
  const { data, isLoading } = useQuery({
    queryKey: ["empresas-qualidade", competencia],
    queryFn: () => listEmpresasQualidade({ data: { competencia } }),
  });
  const [faixa, setFaixa] = useState<FaixaQualidade | "todas">(faixaInicial ?? "todas");

  if (isLoading && !data) {
    return (
      <>
        <PageHeader title="Qualidade da carteira" description={`Confiança média da IA por empresa · ${formatCompetencia(competencia)}.`} />
        <Card className="border-border"><div className="py-16 text-center text-muted-foreground">Carregando qualidade da carteira…</div></Card>
      </>
    );
  }

  const empresas = data?.empresas ?? [];
  const counts = { alta: 0, media: 0, baixa: 0 };
  empresas.forEach((e) => { counts[e.faixa]++; });
  const visiveis = faixa === "todas" ? empresas : empresas.filter((e) => e.faixa === faixa);

  return (
    <>
      <PageHeader
        title="Qualidade da carteira"
        description={`Confiança média da IA por empresa · ${formatCompetencia(competencia)}. Separe a carteira para distribuir o trabalho.`}
        actions={<Button variant="outline" asChild><Link to="/clientes" search={{}}>← Carteira completa</Link></Button>}
      />

      <ResumoTela itens={[
        { label: "Com dados no mês", value: empresas.length },
        { label: "≥80% · semi-auto", value: counts.alta, tone: "ok" as const },
        { label: "60–80% · parcial", value: counts.media },
        { label: "<60% · revisão total", value: counts.baixa, tone: "warn" as const },
      ]} />

      <Card className="border-border">
        <div className="space-y-3 border-b border-border p-4">
          <Tabs value={faixa} onValueChange={(v) => setFaixa(v as FaixaQualidade | "todas")}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="todas">Todas ({empresas.length})</TabsTrigger>
              <TabsTrigger value="alta">≥80% ({counts.alta})</TabsTrigger>
              <TabsTrigger value="media">60–80% ({counts.media})</TabsTrigger>
              <TabsTrigger value="baixa">&lt;60% ({counts.baixa})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Razão Social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Consultor</TableHead>
              <TableHead className="text-right">Confiança média</TableHead>
              <TableHead className="text-right">Lançamentos</TableHead>
              <TableHead>Status do mês</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((e) => (
              <TableRow key={e.id} className="hover:bg-muted/50">
                <TableCell>
                  <Link to="/clientes/$id" params={{ id: e.id }} className="font-medium text-foreground hover:text-primary">{e.razao_social}</Link>
                  {e.nome_fantasia ? <div className="text-xs text-muted-foreground">{e.nome_fantasia}</div> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.cnpj ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-sm">{e.usuarios_perfil?.nome ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", FAIXA_META[e.faixa].badge)}>
                    {Math.round(e.media * 100)}%
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{e.n}</TableCell>
                <TableCell><StatusPill variant={variantFor(e.status)}>{EMPRESA_STATUS_LABEL[e.status]}</StatusPill></TableCell>
              </TableRow>
            ))}
            {visiveis.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{isLoading ? "Carregando…" : "Nenhuma empresa nesta faixa no período."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

const TIPOS_DOC = Object.keys(DOC_TIPO_LABEL);

// Drawer lateral de edição completa: dados básicos, data de corte do
// fechamento, contas bancárias e documentos esperados. Carrega o cadastro
// completo (getEmpresa) só quando abre — a lista paginada não traz relações.
function EditarClienteSheet({ empresaId, consultores }: { empresaId: string; consultores: { id: string; nome: string }[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: empresa, isLoading } = useQuery({
    queryKey: ["empresa-edit", empresaId],
    queryFn: () => getEmpresa({ data: { id: empresaId } }),
    enabled: open,
  });

  const [form, setForm] = useState({
    razao_social: "", nome_fantasia: "", cnpj: "",
    regime: "" as "" | "simples" | "presumido" | "real" | "mei",
    segmento: "", consultor_id: "", status: "em_dia" as "em_dia" | "cobranca" | "lancamento" | "conciliacao" | "entregue" | "atrasado",
    dia_fechamento: "", observacoes: "", tags: "",
  });
  const [contas, setContas] = useState<{ banco: string; agencia: string; conta: string }[]>([]);
  const [docs, setDocs] = useState<string[]>([]);

  useEffect(() => {
    if (!empresa) return;
    setForm({
      razao_social: empresa.razao_social,
      nome_fantasia: empresa.nome_fantasia ?? "",
      cnpj: empresa.cnpj ?? "",
      regime: (empresa.regime ?? "") as typeof form.regime,
      segmento: empresa.segmento ?? "",
      consultor_id: empresa.consultor_id ?? "",
      status: empresa.status,
      dia_fechamento: empresa.dia_fechamento?.toString() ?? "",
      observacoes: empresa.observacoes ?? "",
      tags: (empresa.tags ?? []).join(", "),
    });
    setContas((empresa.contas_bancarias ?? []).map((c) => ({ banco: c.banco, agencia: c.agencia ?? "", conta: c.conta })));
    setDocs((empresa.documentos_esperados ?? []).map((d) => d.tipo as string));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa]);

  async function salvar() {
    setLoading(true);
    try {
      await updateEmpresa({
        data: {
          id: empresaId,
          razao_social: form.razao_social,
          nome_fantasia: form.nome_fantasia || null,
          cnpj: form.cnpj || null,
          regime: form.regime || null,
          segmento: form.segmento || null,
          consultor_id: form.consultor_id || null,
          status: form.status,
          dia_fechamento: form.dia_fechamento ? Number(form.dia_fechamento) : null,
          observacoes: form.observacoes || null,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          contas: contas.filter((c) => c.banco && c.conta),
          documentos_esperados: docs,
        },
      });
      toast.success("Cliente atualizado.");
      qc.invalidateQueries({ queryKey: ["empresas-paginadas"] });
      qc.invalidateQueries({ queryKey: ["empresas-resumo"] });
      qc.invalidateQueries({ queryKey: ["empresa-edit", empresaId] });
      qc.invalidateQueries({ queryKey: ["empresa", empresaId] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Editar cliente"><Pencil className="h-4 w-4" /></Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Editar cliente</SheetTitle>
        </SheetHeader>

        {isLoading || !empresa ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando cadastro…</div>
        ) : (
          <div className="space-y-6 px-4 py-4">
            <section className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wide text-soft-foreground">Dados básicos</h3>
              <div className="space-y-1.5"><Label>Razão social *</Label><Input required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Nome fantasia</Label><Input value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>CNPJ</Label><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: formatCNPJ(e.target.value) })} /></div>
                <div className="space-y-1.5">
                  <Label>Regime</Label>
                  <Select value={form.regime || "_none"} onValueChange={(v) => setForm({ ...form, regime: v === "_none" ? "" : (v as typeof form.regime) })}>
                    <SelectTrigger><SelectValue placeholder="Sem classificação" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem classificação</SelectItem>
                      {Object.entries(REGIME_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Segmento</Label><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} /></div>
                <div className="space-y-1.5">
                  <Label>Status do mês</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPRESA_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Consultor responsável</Label>
                  <Select value={form.consultor_id || "_none"} onValueChange={(v) => setForm({ ...form, consultor_id: v === "_none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem consultor</SelectItem>
                      {consultores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Tags (separadas por vírgula)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="atípico, baixo volume" /></div>
            </section>

            <section className="space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <Label className="inline-flex items-center gap-1.5 font-medium"><CalendarClock className="h-4 w-4 text-primary" />Data de corte do fechamento</Label>
              <Input type="number" min={1} max={31} placeholder="Dia do mês · ex: 10" value={form.dia_fechamento} onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })} className="max-w-40 bg-card" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Dia do mês em que a conciliação deste cliente precisa estar fechada.
                É essa data que baliza o que aparece como <strong>em atraso</strong> na
                execução da conciliação.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wide text-soft-foreground">Contas bancárias</h3>
              {contas.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-5" placeholder="Banco" value={c.banco} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, banco: e.target.value } : x))} />
                  <Input className="col-span-3" placeholder="Agência" value={c.agencia} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, agencia: e.target.value } : x))} />
                  <Input className="col-span-3" placeholder="Conta" value={c.conta} onChange={(e) => setContas(contas.map((x, j) => j === i ? { ...x, conta: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => setContas(contas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {contas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma conta cadastrada — o extrato importado também alimenta esta lista automaticamente.</p>}
              <Button type="button" variant="outline" size="sm" onClick={() => setContas([...contas, { banco: "", agencia: "", conta: "" }])}><Plus className="mr-1 h-4 w-4" />Adicionar conta</Button>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wide text-soft-foreground">Documentos esperados</h3>
              <div className="grid grid-cols-2 gap-2">
                {TIPOS_DOC.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={docs.includes(t)} onCheckedChange={(v) => setDocs(v ? [...docs, t] : docs.filter((x) => x !== t))} />
                    {DOC_TIPO_LABEL[t]}
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-1.5">
              <Label>Observações e infos úteis</Label>
              <Textarea rows={4} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Particularidades, contatos, prazos especiais…" />
            </section>
          </div>
        )}

        <SheetFooter className="px-4 pb-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={loading || isLoading}>{loading ? "Salvando…" : "Salvar alterações"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

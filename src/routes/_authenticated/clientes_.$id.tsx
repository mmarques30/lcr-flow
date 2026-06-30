import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getEmpresa, getEmpresaPainel, updateEmpresa, listConsultores } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, REGIME_LABEL, DOC_TIPO_LABEL, DOC_STATUS_LABEL, competenciaAtual, ultimasCompetencias, formatCompetencia, formatCNPJ } from "@/lib/format";
import { ChevronLeft, Pencil, TrendingUp, FileText, BookOpen, CalendarClock, Banknote, CheckCircle2, AlertCircle, Building2 } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";
import { RazaoContabil, ConciliacaoBancaria } from "./conciliacao_.$empresaId";
import { DocumentosTab, PlanilhaSciTab, HistoricoTab } from "@/components/cliente/painel";

export const Route = createFileRoute("/_authenticated/clientes_/$id")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "clientes", "/clientes"),
  head: ({ params }) => ({ meta: [{ title: `Cliente — LCR Contábil` }, { name: "cliente-id", content: params.id }] }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({ queryKey: ["empresa", params.id], queryFn: () => getEmpresa({ data: { id: params.id } }) }),
  component: ClienteDetalhe,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Cliente não encontrado.</div>,
});

function ClienteDetalhe() {
  const { id } = Route.useParams();
  const { data: empresa } = useSuspenseQuery({ queryKey: ["empresa", id], queryFn: () => getEmpresa({ data: { id } }) });
  const [competencia, setCompetencia] = useState(competenciaAtual());

  return (
    <>
      <Link to="/clientes" className="inline-flex items-center text-sm text-soft-foreground hover:text-primary mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" />Clientes
      </Link>
      <div className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">{empresa.razao_social}</h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StatusPill variant={variantFor(empresa.status)}>{EMPRESA_STATUS_LABEL[empresa.status]}</StatusPill>
            <span className="font-mono text-xs text-muted-foreground">{empresa.cnpj ? formatCNPJ(empresa.cnpj) : "Sem CNPJ"}</span>
            {(empresa.tags ?? []).map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-soft-foreground">#{t}</span>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <EditarClienteDrawer empresa={empresa} />
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Competência</span>
            <Select value={competencia} onValueChange={setCompetencia}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ultimasCompetencias(12).map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Tabs defaultValue="visao">
        <TabsList className="flex-wrap">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="razao">Razão contábil</TabsTrigger>
          <TabsTrigger value="conciliacao">Conciliação bancária</TabsTrigger>
          <TabsTrigger value="sci">Planilha SCI</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-4">
          <VisaoGeralCliente empresaId={id} empresa={empresa} competencia={competencia} />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4"><DocumentosTab empresaId={id} competencia={competencia} /></TabsContent>
        <TabsContent value="razao" className="mt-4"><RazaoContabil empresaId={id} competencia={competencia} /></TabsContent>
        <TabsContent value="conciliacao" className="mt-4"><ConciliacaoBancaria empresaId={id} competencia={competencia} /></TabsContent>
        <TabsContent value="sci" className="mt-4"><PlanilhaSciTab empresaId={id} empresaNome={empresa.razao_social} competencia={competencia} /></TabsContent>
        <TabsContent value="historico" className="mt-4"><HistoricoTab empresaId={id} /></TabsContent>
      </Tabs>
    </>
  );
}

type EmpresaDetalhe = ReturnType<typeof useSuspenseQuery<Awaited<ReturnType<typeof getEmpresa>>>>["data"];

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatShortComp = (c: string) => {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return meses[Number(c.split("-")[1]) - 1];
};

function VisaoGeralCliente({ empresaId, empresa, competencia }: { empresaId: string; empresa: EmpresaDetalhe; competencia: string }) {
  const { data: painel } = useQuery({
    queryKey: ["empresa-painel", empresaId, competencia],
    queryFn: () => getEmpresaPainel({ data: { empresa_id: empresaId, competencia } }),
    refetchInterval: 30_000,
  });

  if (!painel) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Carregando análise do cliente…</CardContent></Card>;
  }

  const { kpis, serieMensal, docsByTipo, docsEsperadosMes, docsRecentes, lancRecentes, bancosDetectados } = painel;
  const contasCad = empresa.contas_bancarias ?? [];
  const esperadosCad = empresa.documentos_esperados ?? [];

  const ultimoDocRel = kpis.ultimoDoc?.recebido_em ? new Date(kpis.ultimoDoc.recebido_em).toLocaleDateString("pt-BR") : "—";
  const recebidosNoMes = docsEsperadosMes.filter((e) => e.no_mes).length;
  const recebidosForaMes = docsEsperadosMes.filter((e) => e.recebido && !e.no_mes).length;
  const recebidosPct = esperadosCad.length === 0 ? 0 : Math.round((recebidosNoMes / esperadosCad.length) * 100);

  return (
    <div className="space-y-5">
      {/* HERO — KPI strip com gráfico */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="rounded-3xl border-0 shadow-soft bg-primary text-primary-foreground lg:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-primary-foreground/70">Performance · {formatCompetencia(competencia)}</div>
                <div className="mt-2 flex items-end gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-primary-foreground/70">Lançamentos no mês</div>
                    <div className="font-display text-5xl font-bold leading-none">{kpis.lancMes.toLocaleString("pt-BR")}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-primary-foreground/70">Movimentado: {brl(kpis.valorMes)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right text-sm">
                <div className="rounded-2xl bg-primary-foreground/10 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Docs total</div>
                  <div className="mt-1 font-display text-xl">{kpis.totalDocs}</div>
                </div>
                <div className="rounded-2xl bg-primary-foreground/10 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Docs no mês</div>
                  <div className="mt-1 font-display text-xl">{kpis.docsMes}</div>
                </div>
                <div className="rounded-2xl bg-primary-foreground/10 p-3 col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Último doc</div>
                  <div className="mt-1 text-sm font-medium">{kpis.ultimoDoc ? DOC_TIPO_LABEL[kpis.ultimoDoc.tipo] : "—"} <span className="text-primary-foreground/70">· {ultimoDocRel}</span></div>
                </div>
              </div>
            </div>

            <div className="mt-4 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieMensal} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="visaoFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent-lime)" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="var(--color-accent-lime)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="competencia" hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }}
                    labelFormatter={(c) => formatCompetencia(String(c))}
                    formatter={(v: number, name: string) => name === "valor" ? [brl(v), "Movimentado"] : [v.toLocaleString("pt-BR"), "Lançamentos"]}
                  />
                  <Area type="monotone" dataKey="lancamentos" stroke="var(--color-accent-lime)" strokeWidth={2.5} fill="url(#visaoFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between px-1 text-[10px] uppercase tracking-wider text-primary-foreground/60">
              {serieMensal.map((s) => <span key={s.competencia}>{formatShortComp(s.competencia)}</span>)}
            </div>
          </CardContent>
        </Card>

        {/* Saúde de coleta no mês */}
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex h-full flex-col p-6">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CheckCircle2 className="h-4 w-4" /></span>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Coleta do mês</div>
                <h3 className="font-display text-lg leading-tight">Documentos esperados</h3>
              </div>
            </div>

            <div className="my-5 flex flex-col items-center">
              <span className="font-display text-5xl font-bold">{recebidosPct}%</span>
              <span className="text-xs text-muted-foreground mt-1">{recebidosNoMes} de {esperadosCad.length} recebidos no mês</span>
              {recebidosForaMes > 0 && (
                <span className="mt-1 text-[11px] text-accent-lime font-medium">+{recebidosForaMes} já recebido(s) antes</span>
              )}
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {esperadosCad.length === 0 && <p className="text-xs text-center text-muted-foreground">Nenhum documento configurado como esperado.</p>}
              {docsEsperadosMes.map((e) => {
                const icon = e.no_mes
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  : e.recebido
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-accent-lime" />
                    : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
                const label = e.no_mes
                  ? (e.status ? DOC_STATUS_LABEL[e.status as keyof typeof DOC_STATUS_LABEL] : "recebido")
                  : e.recebido
                    ? `recebido em ${e.competencia_recebido ? formatCompetencia(e.competencia_recebido) : "outro mês"}`
                    : "aguardando";
                return (
                  <div key={e.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      {icon}
                      {DOC_TIPO_LABEL[e.tipo as keyof typeof DOC_TIPO_LABEL]}
                    </span>
                    <span className={e.no_mes ? "font-medium text-primary" : e.recebido ? "text-accent-lime" : "text-muted-foreground"}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dados gerais + observações em destaque */}
      <Card className="rounded-3xl border-0 shadow-soft">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
            <h3 className="font-display text-lg">Dados do cliente</h3>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Nome fantasia</dt><dd className="mt-0.5 font-medium">{empresa.nome_fantasia ?? "—"}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Segmento</dt><dd className="mt-0.5 font-medium">{empresa.segmento ?? "—"}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Regime</dt><dd className="mt-0.5 font-medium">{empresa.regime ? REGIME_LABEL[empresa.regime] : "—"}</dd></div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Dia de fechamento</dt>
              <dd className="mt-0.5 font-medium inline-flex items-center gap-1.5">
                {empresa.dia_fechamento
                  ? <><CalendarClock className="h-3.5 w-3.5 text-primary" />Todo dia {empresa.dia_fechamento}{(() => {
                      const hoje = new Date().getDate();
                      const diff = empresa.dia_fechamento - hoje;
                      if (diff < 0) return null;
                      if (diff === 0) return <span className="ml-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">é hoje</span>;
                      if (diff <= 3) return <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">faltam {diff}d</span>;
                      if (diff <= 7) return <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">em {diff}d</span>;
                      return null;
                    })()}</>
                  : "—"}
              </dd>
            </div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">CNPJ</dt><dd className="mt-0.5 font-mono text-xs">{empresa.cnpj ? formatCNPJ(empresa.cnpj) : "—"}</dd></div>
          </dl>
          {empresa.observacoes && (
            <div className="mt-5 rounded-2xl border-l-4 border-primary bg-primary/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-primary font-medium mb-1">Observações</div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{empresa.observacoes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Contas bancárias + detectadas */}
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Banknote className="h-4 w-4" /></span>
              <h3 className="font-display text-lg">Contas bancárias</h3>
            </div>
            {contasCad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada manualmente.</p>
            ) : (
              <ul className="space-y-2">
                {contasCad.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">{c.banco}</span>
                    <span className="font-mono text-xs text-muted-foreground">Ag {c.agencia} · CC {c.conta}</span>
                  </li>
                ))}
              </ul>
            )}

            {bancosDetectados.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Banco operacional detectado nos extratos</div>
                <ul className="space-y-1.5">
                  {bancosDetectados.map((b) => (
                    <li key={b.banco} className="flex items-center justify-between rounded-lg bg-accent-lime/15 px-3 py-1.5 text-xs">
                      <span className="font-medium">{b.banco}</span>
                      <span className="text-muted-foreground">{b.ocorrencias} extrato{b.ocorrencias > 1 ? "s" : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">Encontrados nos extratos enviados pela Gestta — cadastre para consolidar a conciliação.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documentos extraídos da automação Gestta — por tipo */}
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
              <div>
                <h3 className="font-display text-lg">Documentos extraídos</h3>
                <p className="text-xs text-muted-foreground">Tipologia recebida via automação Gestta + manual ({kpis.totalDocs} no total)</p>
              </div>
            </div>
            {docsByTipo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento recebido ainda.</p>
            ) : (
              <ul className="space-y-2">
                {docsByTipo.map((t) => {
                  const max = docsByTipo[0]?.total ?? 1;
                  const w = Math.max(6, Math.round((t.total / max) * 100));
                  return (
                    <li key={t.tipo}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-soft-foreground">{DOC_TIPO_LABEL[t.tipo as keyof typeof DOC_TIPO_LABEL] ?? t.tipo}</span>
                        <span className="font-mono text-xs text-foreground">{t.total}</span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/70">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent-lime" style={{ width: `${w}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Listas: últimos docs + últimos lançamentos */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
              <h3 className="font-display text-lg">Últimos documentos</h3>
            </div>
            {docsRecentes.length === 0 ? <p className="text-sm text-muted-foreground">Sem documentos.</p> : (
              <ul className="divide-y divide-border">
                {docsRecentes.map((d) => {
                  const tipoLabel = DOC_TIPO_LABEL[d.tipo as keyof typeof DOC_TIPO_LABEL];
                  const titulo = d.nome_curto?.trim() || tipoLabel;
                  const mostrarSubtipo = !!d.nome_curto?.trim();
                  return (
                    <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate" title={d.arquivo_nome ?? titulo}>{titulo}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {mostrarSubtipo && <span>{tipoLabel} · </span>}
                          {formatCompetencia(d.competencia)} · <span className="uppercase">{d.origem}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <StatusPill variant={variantFor(d.status)}>{DOC_STATUS_LABEL[d.status as keyof typeof DOC_STATUS_LABEL]}</StatusPill>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(d.recebido_em).toLocaleDateString("pt-BR")}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="h-4 w-4" /></span>
              <h3 className="font-display text-lg">Últimos lançamentos do mês</h3>
            </div>
            {lancRecentes.length === 0 ? <p className="text-sm text-muted-foreground">Sem lançamentos nesta competência.</p> : (
              <ul className="divide-y divide-border">
                {lancRecentes.map((l) => (
                  <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{l.descricao ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{l.data_lancamento ? new Date(l.data_lancamento).toLocaleDateString("pt-BR") : "—"}</div>
                    </div>
                    <div className={`font-mono text-sm ${l.valor < 0 ? "text-destructive" : "text-foreground"}`}>{brl(l.valor)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EditarClienteDrawer({ empresa }: { empresa: EmpresaDetalhe }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    razao_social: empresa.razao_social,
    nome_fantasia: empresa.nome_fantasia ?? "",
    cnpj: empresa.cnpj ?? "",
    regime: (empresa.regime ?? "") as "" | "simples" | "presumido" | "real" | "mei",
    segmento: empresa.segmento ?? "",
    consultor_id: empresa.consultor_id ?? "",
    status: empresa.status,
    dia_fechamento: empresa.dia_fechamento?.toString() ?? "",
    observacoes: empresa.observacoes ?? "",
    tags: (empresa.tags ?? []).join(", "),
  });
  const [loading, setLoading] = useState(false);

  const { data: consultores } = useQuery({ queryKey: ["consultores"], queryFn: () => listConsultores(), staleTime: 5 * 60_000 });

  async function salvar() {
    setLoading(true);
    try {
      await updateEmpresa({
        data: {
          id: empresa.id,
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
        },
      });
      toast.success("Cliente atualizado.");
      qc.invalidateQueries({ queryKey: ["empresa", empresa.id] });
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Pencil className="h-4 w-4" />Editar cliente</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Editar cliente</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 py-4">
          <div className="space-y-1.5"><Label>Razão social</Label><Input value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nome fantasia</Label><Input value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>CNPJ</Label><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Regime tributário</Label>
              <Select value={form.regime || "_none"} onValueChange={(v) => setForm({ ...form, regime: v === "_none" ? "" : (v as "simples" | "presumido" | "real" | "mei") })}>
                <SelectTrigger><SelectValue placeholder="Sem classificação" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sem classificação</SelectItem>
                  <SelectItem value="simples">Simples Nacional</SelectItem>
                  <SelectItem value="presumido">Lucro Presumido</SelectItem>
                  <SelectItem value="real">Lucro Real</SelectItem>
                  <SelectItem value="mei">MEI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Segmento</Label><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPRESA_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Dia de fechamento</Label>
              <Input type="number" min={1} max={31} placeholder="Ex: 10" value={form.dia_fechamento} onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">Data de corte mensal. O sistema dispara <strong>notificações</strong> quando esse dia está chegando (≤ 3 dias) para o cliente.</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Consultor responsável</Label>
            <Select value={form.consultor_id || "_none"} onValueChange={(v) => setForm({ ...form, consultor_id: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Sem consultor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sem consultor</SelectItem>
                {(consultores ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Tags (separadas por vírgula)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="ex: prioridade, novo" /></div>
          <div className="space-y-1.5">
            <Label className="inline-flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" />Observações e infos úteis</Label>
            <Textarea rows={5} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Particularidades, contatos, peculiaridades do regime, prazos especiais…" />
          </div>
        </div>
        <SheetFooter className="px-4 pb-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={loading}>{loading ? "Salvando…" : "Salvar alterações"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

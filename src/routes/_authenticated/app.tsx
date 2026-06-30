import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getDashboardStats } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, formatCompetencia, competenciaAtual, ultimasCompetencias } from "@/lib/format";
import {
  Building2, FileClock, BookOpen, GitCompare, AlertTriangle, ListTodo, ArrowRight,
  Activity, FileText, TrendingUp, TrendingDown, Sparkles, Crown, Scale,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  RadialBarChart, RadialBar, PieChart, Pie, Cell,
} from "recharts";
import { requireAcesso } from "@/lib/guard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "dashboard", "/app"),
  head: () => ({ meta: [{ title: "Dashboard — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["dashboard", competenciaAtual()], queryFn: () => getDashboardStats({ data: { competencia: competenciaAtual() } }) }),
  component: Dashboard,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  boxShadow: "var(--shadow-card)",
  fontSize: 12,
  color: "var(--color-foreground)",
} as const;

// Paleta segmentada (somente família navy/azul + cinzas neutros).
const STATUS_COLORS: Record<string, string> = {
  nao_iniciada: "var(--color-muted)",
  em_andamento: "var(--color-accent-lime)",
  divergencias: "var(--color-destructive)",
  concluida: "var(--color-primary)",
};

const DOC_COLORS: Record<string, string> = {
  recebido: "var(--color-muted)",
  classificado: "var(--color-accent-lime)",
  processado: "var(--color-chart-4)",
  conciliado: "var(--color-primary)",
  erro: "var(--color-destructive)",
};

const REGIME_COLORS: Record<string, string> = {
  simples: "var(--color-primary)",
  presumido: "var(--color-chart-4)",
  real: "var(--color-deep)",
  mei: "var(--color-accent-lime)",
  outro: "var(--color-muted)",
};

function formatShortComp(c: string) {
  const [, m] = c.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return meses[Number(m) - 1];
}

function Delta({ pct }: { pct: number }) {
  const positivo = pct >= 0;
  const Icon = positivo ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
      positivo ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
    )}>
      <Icon className="h-3 w-3" /> {positivo ? "+" : ""}{pct}%
    </span>
  );
}

function Dashboard() {
  const [comp, setComp] = useState(competenciaAtual());
  const { data } = useQuery({
    queryKey: ["dashboard", comp],
    queryFn: () => getDashboardStats({ data: { competencia: comp } }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
  if (!data) return null;

  const maxFase = Math.max(1, ...data.fases.map((f) => f.total));
  const faseDestaque = data.fases.reduce((acc, f) => (f.total > acc.total ? f : acc), data.fases[0]);
  const docsDonut = data.docsByStatus.filter((d) => d.total > 0);
  const regimesAtivos = data.regimes.filter((r) => r.total > 0);
  const totalRegimes = regimesAtivos.reduce((s, r) => s + r.total, 0);
  const maxLancSerie = Math.max(1, ...data.serieMensal.map((s) => s.lancamentos));

  const taxaUltimoMes = data.serieMensal[data.serieMensal.length - 1]?.taxa ?? 0;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Operação contábil em tempo real — clientes, documentos, conciliação."
        actions={
          <Select value={comp} onValueChange={setComp}>
            <SelectTrigger className="w-44 rounded-full"><SelectValue placeholder="Competência" /></SelectTrigger>
            <SelectContent>
              {ultimasCompetencias(12).map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {/* HERO — painel principal navy com KPIs grandes + sparkline integrada */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl bg-primary p-7 text-primary-foreground lg:col-span-2">
          {/* Gradient glow ao fundo (marca azul) */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />

          <div className="relative flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary-foreground/70">
                <Sparkles className="h-3.5 w-3.5" /> Operação · {formatCompetencia(data.competencia)}
              </div>
              <div className="mt-4 flex items-end gap-5">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-primary-foreground/70">Lançamentos do mês</div>
                  <div className="font-display text-[3.5rem] font-bold leading-none tracking-tight">
                    {data.lancamentosMes.toLocaleString("pt-BR")}
                  </div>
                </div>
                <div className="pb-3"><Delta pct={data.deltaLanc} /></div>
              </div>
              <div className="mt-1 text-xs text-primary-foreground/70">
                vs {data.lancamentosMesAnterior.toLocaleString("pt-BR")} no mês anterior
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-right min-w-[220px]">
              <div className="rounded-2xl bg-primary-foreground/10 p-3 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Clientes</div>
                <div className="mt-1 font-display text-2xl">{data.clientesAtivos.toLocaleString("pt-BR")}</div>
              </div>
              <div className="rounded-2xl bg-primary-foreground/10 p-3 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Docs aguardando</div>
                <div className="mt-1 font-display text-2xl">{data.docsAguardando.toLocaleString("pt-BR")}</div>
              </div>
              <div className="rounded-2xl bg-primary-foreground/10 p-3 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Conciliação pendente</div>
                <div className="mt-1 font-display text-2xl">{data.conciliacoesPendentes.toLocaleString("pt-BR")}</div>
              </div>
              <div className="rounded-2xl bg-primary-foreground/10 p-3 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">Tarefas abertas</div>
                <div className="mt-1 font-display text-2xl">{data.tarefasAbertas.toLocaleString("pt-BR")}</div>
              </div>
            </div>
          </div>

          {/* Sparkline 6 meses */}
          <div className="relative mt-5 h-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.serieMensal} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent-lime)" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="var(--color-accent-lime)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="competencia" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(c) => formatCompetencia(String(c))}
                  formatter={(v: number) => [v.toLocaleString("pt-BR"), "Lançamentos"]}
                />
                <Area type="monotone" dataKey="lancamentos" stroke="var(--color-accent-lime)" strokeWidth={2} fill="url(#heroFill)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 -bottom-1 flex justify-between px-1 text-[10px] uppercase tracking-wider text-primary-foreground/50">
              {data.serieMensal.map((s) => <span key={s.competencia}>{formatShortComp(s.competencia)}</span>)}
            </div>
          </div>
        </div>

        {/* Saúde operacional — radial */}
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex h-full flex-col p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Saúde operacional</div>
                <div className="mt-1 font-display text-lg leading-tight">Taxa de conclusão</div>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                {taxaUltimoMes}% no mês
              </span>
            </div>

            <div className="relative mt-2 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="68%" outerRadius="100%" startAngle={220} endAngle={-40}
                  data={[{ name: "conclusao", value: data.taxaConcluidas, fill: "var(--color-primary)" }]}
                >
                  <RadialBar background={{ fill: "var(--color-muted)" }} dataKey="value" cornerRadius={20} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-4xl leading-none">{data.taxaConcluidas}%</span>
                <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">conciliadas</span>
              </div>
            </div>

            <div className="mt-1 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-2xl bg-muted/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Docs processados</div>
                <div className="mt-0.5 font-display text-lg">{data.saudeDocs}%</div>
              </div>
              <div className="rounded-2xl bg-muted/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Divergências</div>
                <div className="mt-0.5 font-display text-lg">{data.taxaDivergencias}%</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TAB BAR */}
      <Tabs defaultValue="operacao">
        <TabsList className="h-auto rounded-full bg-card p-1.5 shadow-soft">
          <TabsTrigger value="operacao" className="gap-1.5 rounded-full px-4 py-2 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm">
            <Activity className="h-3.5 w-3.5" /> Operação
          </TabsTrigger>
          <TabsTrigger value="carteira" className="gap-1.5 rounded-full px-4 py-2 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm">
            <Building2 className="h-3.5 w-3.5" /> Carteira
          </TabsTrigger>
          <TabsTrigger value="documentos" className="gap-1.5 rounded-full px-4 py-2 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm">
            <FileText className="h-3.5 w-3.5" /> Documentos
          </TabsTrigger>
          <TabsTrigger value="conciliacao" className="gap-1.5 rounded-full px-4 py-2 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm">
            <GitCompare className="h-3.5 w-3.5" /> Conciliação
          </TabsTrigger>
        </TabsList>

        {/* OPERAÇÃO */}
        <TabsContent value="operacao" className="mt-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Série mensal — lançamentos + taxa conclusão */}
            <Card className="rounded-3xl border-0 shadow-soft lg:col-span-2">
              <CardContent className="p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Tendência · 6 meses</div>
                    <h3 className="font-display text-xl">Volume de lançamentos</h3>
                    <p className="text-xs text-muted-foreground">Acompanhe a produtividade contábil ao longo dos meses.</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-primary" /> Lançamentos</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-accent-lime" /> % concluídas</span>
                  </div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.serieMensal} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lancFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="taxaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent-lime)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-accent-lime)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="competencia"
                        tickFormatter={(c) => formatShortComp(c)}
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(c) => formatCompetencia(String(c))}
                      />
                      <Area type="monotone" dataKey="lancamentos" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#lancFill)" />
                      <Area type="monotone" dataKey="taxa" stroke="var(--color-accent-lime)" strokeWidth={2} fill="url(#taxaFill)" yAxisId={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Pico no período</div>
                    <div className="font-display text-lg">{maxLancSerie.toLocaleString("pt-BR")}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Média mensal</div>
                    <div className="font-display text-lg">
                      {Math.round(data.serieMensal.reduce((s, x) => s + x.lancamentos, 0) / Math.max(1, data.serieMensal.length)).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Taxa conclusão média</div>
                    <div className="font-display text-lg">
                      {Math.round(data.serieMensal.reduce((s, x) => s + x.taxa, 0) / Math.max(1, data.serieMensal.length))}%
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Funil + Atenção urgente em coluna */}
            <div className="space-y-5">
              <Card className="rounded-3xl border-0 shadow-soft">
                <CardContent className="p-6">
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Funil do ciclo</div>
                      <h3 className="font-display text-lg">Fase atual</h3>
                    </div>
                    {faseDestaque && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        Gargalo: {faseDestaque.fase}
                      </span>
                    )}
                  </div>
                  <div className="space-y-4">
                    {data.fases.map((f) => {
                      const w = Math.max(4, Math.round((f.total / maxFase) * 100));
                      const destaque = f.fase === faseDestaque?.fase;
                      return (
                        <div key={f.fase} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-soft-foreground">{f.fase}</span>
                            <span className="font-mono text-foreground">{f.total}</span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                destaque ? "bg-gradient-to-r from-primary to-accent-lime" : "bg-foreground/30",
                              )}
                              style={{ width: `${w}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 shadow-soft">
                <CardContent className="p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <h3 className="font-display text-lg">Atenção urgente</h3>
                    {data.atencaoUrgente.length > 0 && (
                      <span className="ml-auto rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                        {data.atencaoUrgente.length}
                      </span>
                    )}
                  </div>
                  {data.atencaoUrgente.length === 0 ? (
                    <div className="rounded-2xl bg-muted/40 px-4 py-5 text-center text-xs text-muted-foreground">Nenhum cliente em atenção.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.atencaoUrgente.slice(0, 5).map((e) => (
                        <li key={e.id}>
                          <Link to="/clientes/$id" params={{ id: e.id }} className="group flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/60">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-[10px] font-semibold text-foreground">
                                {e.razao_social.slice(0, 2).toUpperCase()}
                              </span>
                              <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">{e.razao_social}</span>
                            </div>
                            <StatusPill variant={variantFor(e.status)}>{EMPRESA_STATUS_LABEL[e.status]}</StatusPill>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Top clientes + tarefas */}
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="rounded-3xl border-0 shadow-soft lg:col-span-2">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Crown className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Top clientes do mês</div>
                      <h3 className="font-display text-lg">Maior volume de lançamentos</h3>
                    </div>
                  </div>
                  <Link to="/clientes" className="text-xs font-medium text-primary hover:underline">Ver todos →</Link>
                </div>
                {data.topClientes.length === 0 ? (
                  <div className="rounded-2xl bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">Sem lançamentos no período.</div>
                ) : (
                  <ol className="space-y-2.5">
                    {data.topClientes.map((c, idx) => {
                      const max = data.topClientes[0]?.total ?? 1;
                      const w = Math.max(5, Math.round((c.total / max) * 100));
                      return (
                        <li key={c.id}>
                          <Link to="/clientes/$id" params={{ id: c.id }} className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-muted/40">
                            <span className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-display text-sm",
                              idx === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                            )}>{idx + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">{c.nome}</span>
                                <span className="font-mono text-sm">{c.total}</span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                                <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent-lime" style={{ width: `${w}%` }} />
                              </div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-soft">
              <CardContent className="flex h-full flex-col p-6">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-foreground/10 text-foreground">
                    <ListTodo className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Backlog</div>
                    <h3 className="font-display text-lg">Tarefas abertas</h3>
                  </div>
                </div>
                <div className="mt-5 flex-1 flex flex-col items-center justify-center">
                  <span className="font-display text-6xl font-bold leading-none">{data.tarefasAbertas}</span>
                  <span className="mt-2 text-xs text-muted-foreground">tarefa(s) ainda em aberto</span>
                </div>
                <Link to="/tarefas" className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition-transform hover:scale-[1.02]">
                  Abrir lista de tarefas <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* CARTEIRA — distribuição por regime + status */}
        <TabsContent value="carteira" className="mt-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="rounded-3xl border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Scale className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Carteira por regime tributário</div>
                    <h3 className="font-display text-lg">{data.clientesAtivos} clientes</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={regimesAtivos} dataKey="total" nameKey="label" innerRadius={60} outerRadius={92} paddingAngle={3} strokeWidth={0}>
                          {regimesAtivos.map((r) => <Cell key={r.key} fill={REGIME_COLORS[r.key]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-3xl">{totalRegimes}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">classificados</span>
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {data.regimes.map((r) => {
                      const pct = totalRegimes > 0 ? Math.round((r.total / totalRegimes) * 100) : 0;
                      return (
                        <li key={r.key} className="rounded-xl bg-muted/40 px-3 py-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-soft-foreground">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: REGIME_COLORS[r.key] }} /> {r.label}
                            </span>
                            <span className="font-semibold text-foreground">{r.total} <span className="text-xs font-normal text-muted-foreground">· {pct}%</span></span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Distribuição por fase do mês</div>
                  <h3 className="font-display text-lg">{data.fases.reduce((s, f) => s + f.total, 0)} clientes no ciclo</h3>
                </div>
                <div className="space-y-4">
                  {data.fases.map((f, idx) => {
                    const total = data.fases.reduce((s, x) => s + x.total, 0);
                    const pct = total > 0 ? Math.round((f.total / total) * 100) : 0;
                    return (
                      <div key={f.fase}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-soft-foreground">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{idx + 1}</span>
                            {f.fase}
                          </span>
                          <span className="font-mono text-foreground">{f.total} <span className="text-xs text-muted-foreground">· {pct}%</span></span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted/70">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(2, pct)}%`,
                              background: `linear-gradient(90deg, var(--color-primary) 0%, var(--color-accent-lime) 100%)`,
                              opacity: 0.4 + (idx * 0.15),
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-2xl bg-primary p-4 text-primary-foreground">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-primary-foreground/70">Próximo passo</div>
                      <div className="mt-1 font-display text-base">Atacar a fase de {faseDestaque?.fase}</div>
                    </div>
                    <Link to="/clientes" className="inline-flex items-center gap-1 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground">
                      Carteira <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* DOCUMENTOS */}
        <TabsContent value="documentos" className="mt-5">
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardContent className="p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Documentos no funil</div>
                  <h3 className="font-display text-xl">{data.totalDocs} documento(s) — {data.saudeDocs}% já processados</h3>
                </div>
                <Link to="/documentos" className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:scale-105 transition-transform">
                  <FileClock className="h-3.5 w-3.5" /> Abrir esteira
                </Link>
              </div>
              <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-2">
                <div className="relative h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={docsDonut} dataKey="total" nameKey="label" innerRadius={75} outerRadius={110} paddingAngle={3} strokeWidth={0}>
                        {docsDonut.map((d) => <Cell key={d.key} fill={DOC_COLORS[d.key]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-4xl">{data.totalDocs}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">documentos</span>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {data.docsByStatus.map((d) => {
                    const pct = data.totalDocs > 0 ? Math.round((d.total / data.totalDocs) * 100) : 0;
                    return (
                      <li key={d.key} className="rounded-2xl bg-muted/40 px-4 py-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-soft-foreground">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: DOC_COLORS[d.key] }} /> {d.label}
                          </span>
                          <span className="font-semibold text-foreground">{d.total} <span className="text-xs font-normal text-muted-foreground">· {pct}%</span></span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: DOC_COLORS[d.key] }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONCILIAÇÃO */}
        <TabsContent value="conciliacao" className="mt-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="rounded-3xl border-0 shadow-soft lg:col-span-2">
              <CardContent className="p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Conciliações do ciclo</div>
                    <h3 className="font-display text-xl">{data.totalConciliacoes} no total — {data.taxaConcluidas}% concluídas</h3>
                  </div>
                  <Link to="/conciliacao" className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:scale-105 transition-transform">
                    Carteira <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {/* Stack horizontal por status */}
                <div className="space-y-3">
                  {data.conciliacoesByStatus.map((c) => {
                    const pct = data.totalConciliacoes > 0 ? Math.round((c.total / data.totalConciliacoes) * 100) : 0;
                    return (
                      <div key={c.key}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-soft-foreground">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[c.key] }} /> {c.label}
                          </span>
                          <span className="font-mono text-foreground">{c.total} <span className="text-xs text-muted-foreground">· {pct}%</span></span>
                        </div>
                        <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-muted/70">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, pct)}%`, background: STATUS_COLORS[c.key] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Trend conciliações concluídas */}
                <div className="mt-6 border-t border-border pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Tendência — conciliações concluídas (6 meses)</div>
                    <span className="text-xs text-muted-foreground">{data.serieMensal[data.serieMensal.length - 1]?.concluidas ?? 0} este mês</span>
                  </div>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.serieMensal} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="concilFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="competencia" tickFormatter={(c) => formatShortComp(c)} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(c) => formatCompetencia(String(c))} />
                        <Area type="monotone" dataKey="concluidas" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#concilFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-soft">
              <CardContent className="flex h-full flex-col p-6">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <GitCompare className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Indicador</div>
                    <h3 className="font-display text-lg">Conclusão</h3>
                  </div>
                </div>
                <div className="relative my-2 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} data={[{ value: data.taxaConcluidas, fill: "var(--color-primary)" }]}>
                      <RadialBar background={{ fill: "var(--color-muted)" }} dataKey="value" cornerRadius={20} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-5xl leading-none">{data.taxaConcluidas}%</span>
                    <span className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">concluídas</span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-muted/40 px-2 py-2">
                    <div className="uppercase tracking-wide text-muted-foreground text-[10px]">Divergências</div>
                    <div className="mt-0.5 font-display text-base">{data.taxaDivergencias}%</div>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-2 py-2">
                    <div className="uppercase tracking-wide text-muted-foreground text-[10px]">Pendentes</div>
                    <div className="mt-0.5 font-display text-base">{data.conciliacoesPendentes}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, variantFor } from "@/components/status-pill";
import { ProgressRing } from "@/components/progress-ring";
import { getDashboardStats } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, formatCompetencia, competenciaAtual, ultimasCompetencias } from "@/lib/format";
import { Building2, FileClock, BookOpen, GitCompare, AlertTriangle, ListTodo, ArrowRight } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { requireAcesso } from "@/lib/guard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "dashboard", "/app"),
  head: () => ({ meta: [{ title: "Dashboard — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["dashboard", competenciaAtual()], queryFn: () => getDashboardStats({ data: { competencia: competenciaAtual() } }) }),
  component: Dashboard,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const tooltipStyle = { background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "var(--shadow-card)", fontSize: 12 } as const;

const DONUT_COLORS: Record<string, string> = {
  nao_iniciada: "var(--color-status-next)",
  em_andamento: "var(--color-chart-2)",
  divergencias: "var(--color-destructive)",
  concluida: "var(--color-primary)",
};

const DOC_BAR_COLORS: Record<string, string> = {
  recebido: "var(--color-chart-2)",
  classificado: "var(--color-chart-4)",
  processado: "var(--color-chart-1)",
  conciliado: "var(--color-primary)",
  erro: "var(--color-destructive)",
};

function Dashboard() {
  const [comp, setComp] = useState(competenciaAtual());
  const { data } = useQuery({ queryKey: ["dashboard", comp], queryFn: () => getDashboardStats({ data: { competencia: comp } }), placeholderData: keepPreviousData, refetchInterval: 5000 });
  if (!data) return null;

  const stats = [
    { icon: Building2, label: "Clientes ativos", value: data.clientesAtivos, hint: "na carteira LCR" },
    { icon: FileClock, label: "Docs aguardando", value: data.docsAguardando, hint: "recebido + classificado" },
    { icon: BookOpen, label: "Lançamentos do mês", value: data.lancamentosMes, hint: formatCompetencia(data.competencia) },
    { icon: GitCompare, label: "Conciliações pendentes", value: data.conciliacoesPendentes, hint: `de ${data.totalConciliacoes} no total` },
  ];

  const pctConcluida = data.totalConciliacoes > 0
    ? Math.round(((data.conciliacoesByStatus.find((c) => c.key === "concluida")?.total ?? 0) / data.totalConciliacoes) * 100)
    : 0;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Integração e conciliação bancária dos clientes."
        actions={
          <Select value={comp} onValueChange={setComp}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Competência" /></SelectTrigger>
            <SelectContent>
              {ultimasCompetencias(12).map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {/* KPIs — primeiro é hero (accent sólido da marca), demais neutros */}
      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          const hero = i === 0;
          return (
            <div
              key={s.label}
              className={cn(
                "rounded-xl p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card",
                hero ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className={cn("label-cat", hero && "text-primary-foreground/70")}>{s.label}</div>
                  <div className="mt-3 text-[2.25rem] font-bold leading-none tracking-tight">{s.value}</div>
                  <div className={cn("mt-2 text-xs", hero ? "text-primary-foreground/70" : "text-muted-foreground")}>{s.hint}</div>
                </div>
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", hero ? "bg-white/15 text-primary-foreground" : "icon-chip")}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sub-abas por tema */}
      <Tabs defaultValue="operacao">
        <TabsList>
          <TabsTrigger value="operacao">Operação</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="conciliacao">Conciliação</TabsTrigger>
        </TabsList>

        {/* Operação: ciclo por fase (área) + atenção urgente */}
        <TabsContent value="operacao" className="mt-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="font-display text-xl">Ciclo mensal por fase</CardTitle>
                <p className="text-sm text-muted-foreground">Como os clientes fluem pelas etapas do mês.</p>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.fases} margin={{ left: -16, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="faseFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="fase" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={36} />
                      <Tooltip cursor={{ stroke: "var(--color-border)" }} contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="total" name="Clientes" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#faseFill)" dot={{ r: 4, strokeWidth: 0, fill: "var(--color-primary)" }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-xl">
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Atenção urgente
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.atencaoUrgente.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tudo em dia. Nenhum cliente em atenção.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.atencaoUrgente.map((e) => (
                      <li key={e.id} className="group flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link to="/clientes/$id" params={{ id: e.id }} className="flex items-center gap-1 truncate text-sm font-medium text-foreground hover:text-primary">
                            <span className="truncate">{e.razao_social}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {(e.tags ?? []).slice(0, 2).map((t) => <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>)}
                          </div>
                        </div>
                        <StatusPill variant={variantFor(e.status)}>{EMPRESA_STATUS_LABEL[e.status]}</StatusPill>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Documentos: barras horizontais por status */}
        <TabsContent value="documentos" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="font-display text-xl">Documentos por status</CardTitle>
                <p className="text-sm text-muted-foreground">{data.totalDocs} documento(s) no total.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
                <ListTodo className="h-3.5 w-3.5" /> {data.tarefasAbertas} tarefas abertas
              </span>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={data.docsByStatus} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="label" width={96} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={tooltipStyle} />
                    <Bar dataKey="total" radius={[0, 8, 8, 0]} maxBarSize={30}>
                      {data.docsByStatus.map((d) => <Cell key={d.key} fill={DOC_BAR_COLORS[d.key]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Conciliação: progress ring + breakdown */}
        <TabsContent value="conciliacao" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl">Conciliações do ciclo</CardTitle>
              <p className="text-sm text-muted-foreground">{data.totalConciliacoes} conciliação(ões) no total.</p>
            </CardHeader>
            <CardContent>
              {data.totalConciliacoes === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conciliação registrada.</p>
              ) : (
                <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center">
                  <ProgressRing value={pctConcluida} size={160}>
                    <span className="font-display text-3xl leading-none">{pctConcluida}%</span>
                    <span className="label-cat mt-1">concluídas</span>
                  </ProgressRing>
                  <ul className="flex-1 space-y-3 self-stretch">
                    {data.conciliacoesByStatus.map((c) => (
                      <li key={c.key} className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-2.5 text-sm">
                        <span className="flex items-center gap-2 text-soft-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[c.key] }} />
                          {c.label}
                        </span>
                        <span className="font-semibold text-foreground">{c.total}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

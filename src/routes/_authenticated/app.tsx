import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader, DemoFlag } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getDashboardStats } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { Building2, FileClock, BookOpen, GitCompare, AlertTriangle, ListTodo, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/app")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "dashboard", "/app"),
  head: () => ({ meta: [{ title: "Dashboard — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["dashboard"], queryFn: () => getDashboardStats() }),
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
  const { data } = useSuspenseQuery({ queryKey: ["dashboard"], queryFn: () => getDashboardStats() });

  const stats = [
    { icon: Building2, label: "Clientes ativos", value: data.clientesAtivos, hint: "na carteira LCR" },
    { icon: FileClock, label: "Docs aguardando", value: data.docsAguardando, hint: "recebido + classificado" },
    { icon: BookOpen, label: "Lançamentos do mês", value: data.lancamentosMes, hint: formatCompetencia(data.competencia) },
    { icon: GitCompare, label: "Conciliações pendentes", value: data.conciliacoesPendentes, hint: `de ${data.totalConciliacoes} no total` },
  ];

  const conciliacaoData = data.conciliacoesByStatus.filter((d) => d.total > 0);
  const pctConcluida = data.totalConciliacoes > 0
    ? Math.round(((data.conciliacoesByStatus.find((c) => c.key === "concluida")?.total ?? 0) / data.totalConciliacoes) * 100)
    : 0;
  const maxDoc = Math.max(1, ...data.docsByStatus.map((d) => d.total));

  return (
    <>
      <PageHeader
        title="Visão geral"
        emphasis="para a LCR"
        description={`Ciclo de ${formatCompetencia(data.competencia)} — integração e conciliação bancária dos clientes.`}
        actions={<DemoFlag />}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="card-interactive">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
                    <div className="mt-3 font-display text-[2.75rem] leading-none text-foreground">{s.value}</div>
                    <div className="mt-2 text-xs text-muted-foreground">{s.hint}</div>
                  </div>
                  <span className="icon-chip h-11 w-11 shrink-0">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ciclo por fase + Donut conciliações */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-xl">Ciclo mensal por fase</CardTitle>
            <p className="text-sm text-muted-foreground">Distribuição dos clientes nas etapas do mês.</p>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.fases} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="fase" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                  <Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={tooltipStyle} />
                  <Bar dataKey="total" fill="var(--color-primary)" radius={[8, 8, 0, 0]} maxBarSize={64} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Conciliações</CardTitle>
            <p className="text-sm text-muted-foreground">Status no ciclo atual.</p>
          </CardHeader>
          <CardContent>
            {data.totalConciliacoes === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conciliação registrada.</p>
            ) : (
              <>
                <div className="relative h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={conciliacaoData} dataKey="total" nameKey="label" innerRadius={56} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                        {conciliacaoData.map((d) => <Cell key={d.key} fill={DONUT_COLORS[d.key]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-3xl text-foreground">{pctConcluida}%</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">concluídas</span>
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {data.conciliacoesByStatus.map((c) => (
                    <li key={c.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-soft-foreground">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[c.key] }} />
                        {c.label}
                      </span>
                      <span className="font-medium text-foreground">{c.total}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Documentos por status + Atenção urgente */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
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
            <ul className="space-y-4">
              {data.docsByStatus.map((d) => (
                <li key={d.key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-soft-foreground">{d.label}</span>
                    <span className="font-medium text-foreground">{d.total}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(d.total / maxDoc) * 100}%`, background: DOC_BAR_COLORS[d.key] }} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display text-xl flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Atenção urgente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.atencaoUrgente.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tudo em dia. Nenhum cliente em atenção.</p>
            ) : (
              <ul className="space-y-3">
                {data.atencaoUrgente.map((e) => (
                  <li key={e.id} className="group flex items-center justify-between gap-3 border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="min-w-0">
                      <Link to="/clientes/$id" params={{ id: e.id }} className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary truncate">
                        <span className="truncate">{e.razao_social}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                      <div className="mt-0.5 flex gap-1 flex-wrap">
                        {(e.tags ?? []).slice(0, 2).map((t) => (
                          <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>
                        ))}
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
    </>
  );
}

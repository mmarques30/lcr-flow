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
import { Building2, FileClock, BookOpen, GitCompare, AlertTriangle, ListTodo, ArrowRight, Activity, FileText, type LucideIcon } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
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
  nao_iniciada: "#cbd5e1",
  em_andamento: "#fbbf24",
  divergencias: "#f43f5e",
  concluida: "var(--color-primary)",
};

const DOC_COLORS: Record<string, string> = {
  recebido: "#cbd5e1",
  classificado: "#fbbf24",
  processado: "#60a5fa",
  conciliado: "var(--color-primary)",
  erro: "#f43f5e",
};

// KPI card — visual moderno: hero preto cheio com tipografia grande,
// neutros em card branco. Hover sutil. Responsivo.
function KpiCard({ icon: Icon, label, value, hint, hero }: { icon: LucideIcon; label: string; value: number; hint: string; hero?: boolean }) {
  return (
    <div className={cn(
      "group rounded-3xl p-6 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card",
      hero ? "bg-foreground text-background" : "bg-card text-card-foreground",
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={cn("text-[11px] font-medium uppercase tracking-wider", hero ? "text-background/60" : "text-muted-foreground")}>{label}</div>
          <div className="mt-3 font-display text-[2.5rem] font-bold leading-none tracking-tight">{value.toLocaleString("pt-BR")}</div>
          <div className={cn("mt-2 text-xs", hero ? "text-background/60" : "text-muted-foreground")}>{hint}</div>
        </div>
        <span className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105",
          hero ? "bg-background/10 text-background" : "bg-primary/10 text-primary",
        )}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

// Barra horizontal para o funil do ciclo. 1 cor de destaque, demais neutras.
function FunilBarra({ label, total, max, destaque }: { label: string; total: number; max: number; destaque?: boolean }) {
  const w = max > 0 ? Math.max(4, Math.round((total / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-soft-foreground">{label}</span>
        <span className="font-mono text-foreground">{total}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-500", destaque ? "bg-primary" : "bg-foreground/60")}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}

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

  const maxFase = Math.max(1, ...data.fases.map((f) => f.total));
  // Destaca a fase que está com maior gargalo no funil.
  const faseDestaque = data.fases.reduce((acc, f) => (f.total > acc.total ? f : acc), data.fases[0]);

  const docsDonut = data.docsByStatus.filter((d) => d.total > 0);

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Integração e conciliação bancária dos clientes."
        actions={
          <Select value={comp} onValueChange={setComp}>
            <SelectTrigger className="w-44 rounded-full"><SelectValue placeholder="Competência" /></SelectTrigger>
            <SelectContent>
              {ultimasCompetencias(12).map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {/* KPIs — hero preto cheio + 3 neutros, tipografia grande */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => <KpiCard key={s.label} {...s} hero={i === 0} />)}
      </div>

      {/* Sub-abas em pills */}
      <Tabs defaultValue="operacao">
        <TabsList className="h-auto rounded-full bg-card p-1.5 shadow-soft">
          <TabsTrigger value="operacao" className="gap-1.5 rounded-full px-4 py-2 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm">
            <Activity className="h-3.5 w-3.5" /> Operação
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
            <Card className="rounded-3xl border-0 shadow-soft lg:col-span-2">
              <CardContent className="p-6">
                <div className="mb-1 flex items-end justify-between">
                  <div>
                    <h3 className="font-display text-xl">Funil do ciclo contábil</h3>
                    <p className="text-sm text-muted-foreground">Clientes em cada fase do mês.</p>
                  </div>
                  {faseDestaque && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      Gargalo: {faseDestaque.fase} ({faseDestaque.total})
                    </span>
                  )}
                </div>
                <div className="mt-6 space-y-5">
                  {data.fases.map((f) => (
                    <FunilBarra key={f.fase} label={f.fase} total={f.total} max={maxFase} destaque={f.fase === faseDestaque?.fase} />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-soft">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-lg">Atenção urgente</h3>
                </div>
                {data.atencaoUrgente.length === 0 ? (
                  <div className="rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Tudo em dia. Nenhum cliente em atenção.</div>
                ) : (
                  <ul className="space-y-2">
                    {data.atencaoUrgente.map((e) => (
                      <li key={e.id}>
                        <Link to="/clientes/$id" params={{ id: e.id }} className="group flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-2.5 transition-colors hover:bg-muted">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold text-foreground">
                              {e.razao_social.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground group-hover:text-primary">{e.razao_social}</div>
                              <div className="text-xs text-muted-foreground">{(e.tags ?? []).slice(0, 2).map((t) => `#${t}`).join(" ") || "—"}</div>
                            </div>
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
        </TabsContent>

        {/* DOCUMENTOS */}
        <TabsContent value="documentos" className="mt-5">
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardContent className="p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl">Documentos por status</h3>
                  <p className="text-sm text-muted-foreground">{data.totalDocs} documento(s) no total.</p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background">
                  <ListTodo className="h-3.5 w-3.5" /> {data.tarefasAbertas} tarefa(s) aberta(s)
                </span>
              </div>
              <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-2">
                <div className="relative h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={docsDonut} dataKey="total" nameKey="label" innerRadius={70} outerRadius={100} paddingAngle={3} strokeWidth={0}>
                        {docsDonut.map((d) => <Cell key={d.key} fill={DOC_COLORS[d.key]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-3xl">{data.totalDocs}</span>
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
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardContent className="p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl">Conciliações do ciclo</h3>
                  <p className="text-sm text-muted-foreground">{data.totalConciliacoes} conciliação(ões) no total.</p>
                </div>
                <Link to="/conciliacao" className="group inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-transform hover:scale-105">
                  Ver carteira <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
              {data.totalConciliacoes === 0 ? (
                <div className="rounded-2xl bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma conciliação registrada.</div>
              ) : (
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
                  <div className="relative mx-auto h-56 w-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[{ name: "concluida", value: pctConcluida }, { name: "rest", value: 100 - pctConcluida }]}
                          dataKey="value" innerRadius={75} outerRadius={95} startAngle={90} endAngle={-270} strokeWidth={0}
                        >
                          <Cell fill="var(--color-primary)" />
                          <Cell fill="var(--color-muted)" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-4xl leading-none">{pctConcluida}%</span>
                      <span className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">concluídas</span>
                    </div>
                  </div>
                  <ul className="space-y-2.5">
                    {data.conciliacoesByStatus.map((c) => {
                      const pct = data.totalConciliacoes > 0 ? Math.round((c.total / data.totalConciliacoes) * 100) : 0;
                      return (
                        <li key={c.key} className="rounded-2xl bg-muted/40 px-4 py-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-soft-foreground">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[c.key] }} /> {c.label}
                            </span>
                            <span className="font-semibold text-foreground">{c.total} <span className="text-xs font-normal text-muted-foreground">· {pct}%</span></span>
                          </div>
                        </li>
                      );
                    })}
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

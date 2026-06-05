import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader, DemoFlag } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getDashboardStats } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { Building2, FileClock, BookOpen, GitCompare, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Dashboard — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["dashboard"], queryFn: () => getDashboardStats() }),
  component: Dashboard,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function Dashboard() {
  const { data } = useSuspenseQuery({ queryKey: ["dashboard"], queryFn: () => getDashboardStats() });
  const stats = [
    { icon: Building2, label: "Clientes ativos", value: data.clientesAtivos },
    { icon: FileClock, label: "Docs aguardando", value: data.docsAguardando },
    { icon: BookOpen, label: "Lançamentos do mês", value: data.lancamentosMes },
    { icon: GitCompare, label: "Conciliações pendentes", value: data.conciliacoesPendentes },
  ];

  return (
    <>
      <PageHeader
        title="Visão geral"
        emphasis="para a LCR"
        description={`Ciclo de ${formatCompetencia(data.competencia)} — integração e conciliação bancária dos clientes.`}
        actions={<DemoFlag />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="card-interactive">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
                    <div className="mt-3 font-display text-[2.75rem] leading-none text-foreground">{s.value}</div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-xl">Ciclo mensal por fase</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.fases}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="fase" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={12} />
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                  <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display text-xl flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-back-foreground" /> Atenção urgente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.atencaoUrgente.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tudo em dia. Nenhum cliente em atenção.</p>
            ) : (
              <ul className="space-y-3">
                {data.atencaoUrgente.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="min-w-0">
                      <Link to="/clientes/$id" params={{ id: e.id }} className="text-sm font-medium text-foreground hover:text-primary truncate block">
                        {e.razao_social}
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

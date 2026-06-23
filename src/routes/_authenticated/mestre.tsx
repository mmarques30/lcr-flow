import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getDashboardStats, listConciliacoes } from "@/lib/lcr.functions";
import { CONCILIACAO_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { requireAcesso } from "@/lib/guard";
import { ArrowRight, FileText, GitCompare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mestre")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "knowledge", "/mestre"),
  head: () => ({ meta: [{ title: "Mestre — LCR Contábil" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["dashboard-stats"], queryFn: () => getDashboardStats() }),
      context.queryClient.ensureQueryData({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() }),
    ]);
  },
  component: MestrePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const FASE_COR: Record<string, string> = { Cobrança: "#f59e0b", Lançamento: "#4A9FE0", Conciliação: "#8b5cf6", Entrega: "#10b981" };

function Barra({ label, total, max, cor }: { label: string; total: number; max: number; cor: string }) {
  const w = max > 0 ? Math.round((total / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-sm text-soft-foreground">{label}</div>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: cor }} />
      </div>
      <div className="w-8 shrink-0 text-right font-mono text-sm">{total}</div>
    </div>
  );
}

type EmpRow = { id: string; razao_social: string; conciliacoes: { competencia: string; status: string; divergencias_count: number }[] };

function MestrePage() {
  const { data: stats } = useSuspenseQuery({ queryKey: ["dashboard-stats"], queryFn: () => getDashboardStats() });
  const { data: conc } = useSuspenseQuery({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() });

  const maxFase = Math.max(1, ...stats.fases.map((f) => f.total));
  const empresas = (conc.empresas as EmpRow[]);
  const statusDe = (e: EmpRow) => (e.conciliacoes.find((c) => c.competencia === conc.competencia) ?? e.conciliacoes[0])?.status ?? "nao_iniciada";

  return (
    <>
      <PageHeader
        title="Painel"
        emphasis="Mestre"
        description={`Governança do ciclo contábil da carteira — competência ${formatCompetencia(stats.competencia)}. O Mestre conhece os processos e padrões; gere análises com ele no assistente.`}
      />

      <ResumoTela itens={[
        { label: "Clientes", value: stats.clientesAtivos },
        { label: "Docs aguardando", value: stats.docsAguardando, tone: "warn" as const },
        { label: "Conciliações pendentes", value: stats.conciliacoesPendentes, tone: "warn" as const },
        { label: "Lançamentos no mês", value: stats.lancamentosMes },
        { label: "Tarefas abertas", value: stats.tarefasAbertas },
      ]} />

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 font-display text-lg">Funil do ciclo contábil</div>
          <div className="space-y-3">
            {stats.fases.map((f) => <Barra key={f.fase} label={f.fase} total={f.total} max={maxFase} cor={FASE_COR[f.fase] ?? "#94a3b8"} />)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-lg"><FileText className="h-4 w-4 text-primary" /> Documentos por status</div>
          <ul className="space-y-2">
            {stats.docsByStatus.map((d) => (
              <li key={d.key} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                <span className="text-soft-foreground">{d.label}</span><span className="font-semibold">{d.total}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg"><GitCompare className="h-4 w-4 text-primary" /> Conciliações por status</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.conciliacoesByStatus.map((c) => (
            <div key={c.key} className="rounded-xl border border-border/70 bg-card/50 p-4">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 font-display text-2xl">{c.total}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="border-b border-border px-6 py-3"><h3 className="font-display text-lg">Status por cliente</h3></div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Conciliação ({formatCompetencia(conc.competencia)})</TableHead><TableHead>Divergências</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {empresas.map((e) => {
              const st = statusDe(e);
              const cc = e.conciliacoes.find((c) => c.competencia === conc.competencia) ?? e.conciliacoes[0];
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.razao_social}</TableCell>
                  <TableCell><StatusPill variant={variantFor(st)}>{CONCILIACAO_STATUS_LABEL[st as keyof typeof CONCILIACAO_STATUS_LABEL]}</StatusPill></TableCell>
                  <TableCell>{cc?.divergencias_count ? <span className="font-mono text-sm text-destructive">{cc.divergencias_count}</span> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">
                    <Link to="/clientes/$id" params={{ id: e.id }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Abrir cliente <ArrowRight className="h-3 w-3" /></Link>
                  </TableCell>
                </TableRow>
              );
            })}
            {empresas.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nenhum cliente.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

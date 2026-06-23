import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConsultiveCarteira } from "@/lib/lcr.functions";
import { requireAcesso } from "@/lib/guard";
import { Search, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const SAUDE_CORES = { s: "#10b981", a: "#f59e0b", r: "#f43f5e" };

export const Route = createFileRoute("/_authenticated/consultive")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "consultive", "/consultive"),
  head: () => ({ meta: [{ title: "Consultivo — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["consultive-carteira"], queryFn: () => getConsultiveCarteira() }),
  component: ConsultivePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const pct = (v: number | null) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const num = (v: number | null) => (v == null ? "—" : Number(v).toFixed(2));
function saudeMargem(m: number | null) {
  if (m == null) return "bg-muted-foreground/30";
  if (m >= 25) return "bg-emerald-500";
  if (m >= 15) return "bg-amber-500";
  return "bg-rose-500";
}

function ConsultivePage() {
  const { data } = useSuspenseQuery({ queryKey: ["consultive-carteira"], queryFn: () => getConsultiveCarteira() });
  const [q, setQ] = useState("");
  const clientes = useMemo(() => data.clientes.filter((c) => !q || c.nome.toLowerCase().includes(q.toLowerCase())), [data.clientes, q]);

  const { dist, margemMedia } = useMemo(() => {
    let s = 0, a = 0, r = 0, soma = 0, n = 0;
    data.clientes.forEach((c) => {
      const m = c.margem_bruta == null ? null : Number(c.margem_bruta);
      if (m == null) return;
      soma += m; n++;
      if (m >= 25) s++; else if (m >= 15) a++; else r++;
    });
    return {
      dist: [
        { name: "Saudável", key: "s", value: s },
        { name: "Atenção", key: "a", value: a },
        { name: "Risco", key: "r", value: r },
      ],
      margemMedia: n ? soma / n : null,
    };
  }, [data.clientes]);

  return (
    <>
      <PageHeader title="Painel" emphasis="Consultivo" description="Saúde financeira da carteira e insights estratégicos. Gere análises com o Consultor no assistente." />

      <ResumoTela itens={[
        { label: "Clientes", value: data.totais.clientes },
        { label: "Insights abertos", value: data.totais.insights_abertos, tone: "ok" as const },
        { label: "Insights críticos", value: data.totais.insights_criticos, tone: "warn" as const },
      ]} />

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 font-display text-lg">Saúde financeira da carteira</div>
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dist} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} strokeWidth={0}>
                    {dist.map((d) => <Cell key={d.key} fill={SAUDE_CORES[d.key as keyof typeof SAUDE_CORES]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 space-y-2 self-stretch">
              {dist.map((d) => (
                <li key={d.key} className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 text-soft-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SAUDE_CORES[d.key as keyof typeof SAUDE_CORES] }} /> {d.name}</span>
                  <span className="font-semibold text-foreground">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="flex flex-col justify-center p-5">
          <div className="label-cat">Margem bruta média</div>
          <div className="mt-2 font-display text-4xl">{margemMedia == null ? "—" : `${margemMedia.toFixed(1)}%`}</div>
          <div className="mt-1 text-xs text-muted-foreground">média da carteira no período</div>
        </Card>
      </div>

      <div className="relative mb-6 max-w-xl">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="pl-8" />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead><TableHead>Saúde</TableHead><TableHead>Margem bruta</TableHead>
              <TableHead>Liquidez</TableHead><TableHead>Var. mês</TableHead><TableHead>Insights</TableHead><TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nome}<div className="text-xs text-muted-foreground">{c.segmento}</div></TableCell>
                <TableCell><span className={cn("inline-block h-3 w-3 rounded-full", saudeMargem(c.margem_bruta))} /></TableCell>
                <TableCell className="font-mono text-sm">{pct(c.margem_bruta)}</TableCell>
                <TableCell className="font-mono text-sm">{num(c.liquidez_corrente)}</TableCell>
                <TableCell>
                  <span className={cn("inline-flex items-center gap-1 font-mono text-sm", (c.variacao ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                    {(c.variacao ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{pct(c.variacao)}
                  </span>
                </TableCell>
                <TableCell>{c.insights_abertos > 0 ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{c.insights_abertos}</span> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  <Link to="/consultive/$empresaId" params={{ empresaId: c.id }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Analisar <ArrowRight className="h-3 w-3" /></Link>
                </TableCell>
              </TableRow>
            ))}
            {clientes.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum cliente.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

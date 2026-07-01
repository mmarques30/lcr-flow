import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConsultiveCarteira } from "@/lib/lcr.functions";
import { formatCompetencia } from "@/lib/format";
import { requireAcesso } from "@/lib/guard";
import { Search, ArrowRight, TrendingUp, TrendingDown, Sparkles, LineChart as LineIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const SAUDE_CORES = { s: "#10b981", a: "#f59e0b", r: "#f43f5e" };

export const Route = createFileRoute("/_authenticated/consultive")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "consultive", "/consultive"),
  head: () => ({ meta: [{ title: "Consultivo — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["consultive-carteira", "latest"], queryFn: () => getConsultiveCarteira({ data: {} }) }),
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
  const [comp, setComp] = useState("latest");
  const { data } = useQuery({ queryKey: ["consultive-carteira", comp], queryFn: () => getConsultiveCarteira({ data: comp !== "latest" ? { competencia: comp } : {} }), placeholderData: keepPreviousData });
  const [q, setQ] = useState("");
  const clientes = useMemo(() => (data?.clientes ?? []).filter((c) => !q || c.nome.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const { dist, margemMedia } = useMemo(() => {
    let s = 0, a = 0, r = 0, soma = 0, n = 0;
    (data?.clientes ?? []).forEach((c) => {
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
  }, [data]);

  if (!data) return null;

  return (
    <>
      <PageHeader
        title="Painel"
        emphasis="Consultivo"
        description="Saúde financeira da carteira e insights estratégicos. Gere análises com o Consultor no assistente."
        actions={
          <Select value={comp} onValueChange={setComp}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Período" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Mais recente</SelectItem>
              {data.competencias.map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <ResumoTela itens={[
        { label: "Clientes", value: data.totais.clientes },
        { label: "Margem bruta média", value: margemMedia == null ? "—" : `${margemMedia.toFixed(1)}%`, tone: "ok" as const },
        { label: "Saudáveis", value: dist.find((d) => d.key === "s")?.value ?? 0, tone: "ok" as const },
        { label: "Insights abertos", value: data.totais.insights_abertos },
        { label: "Insights críticos", value: data.totais.insights_criticos, tone: "warn" as const },
      ]} />

      {/* HERO — margem bruta média em destaque + distribuição por saúde */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground lg:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary-foreground/70">
                <Sparkles className="h-3.5 w-3.5" /> Margem bruta média · carteira
              </div>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-display text-6xl font-bold leading-none">{margemMedia == null ? "—" : `${margemMedia.toFixed(1)}`}</span>
                {margemMedia != null && <span className="mb-2 font-display text-2xl text-primary-foreground/70">%</span>}
              </div>
              <div className="mt-2 text-xs text-primary-foreground/70">{data.totais.clientes} clientes · {data.totais.insights_criticos} insight(s) crítico(s)</div>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary-foreground/60"><LineIcon className="h-3.5 w-3.5" /> Distribuição</div>
              <div className="flex gap-3">
                {dist.map((d) => (
                  <div key={d.key} className="flex flex-col items-center">
                    <div className="h-2.5 w-14 rounded-full" style={{ background: SAUDE_CORES[d.key as keyof typeof SAUDE_CORES] }} />
                    <span className="mt-1 font-display text-2xl font-bold">{d.value}</span>
                    <span className="text-[10px] uppercase tracking-wider text-primary-foreground/60">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <div className="mb-3 font-display text-lg">Composição por saúde</div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dist} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} strokeWidth={0}>
                  {dist.map((d) => <Cell key={d.key} fill={SAUDE_CORES[d.key as keyof typeof SAUDE_CORES]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="relative mb-6 max-w-xl">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="pl-8" />
      </div>

      <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
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

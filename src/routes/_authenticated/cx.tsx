import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCxCarteira } from "@/lib/lcr.functions";
import { requireAcesso } from "@/lib/guard";
import { ArrowRight, TrendingUp, TrendingDown, Minus, Heart, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, RadialBarChart, RadialBar } from "recharts";

export const Route = createFileRoute("/_authenticated/cx")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "cx", "/cx"),
  head: () => ({ meta: [{ title: "CX · Experiência — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["cx-carteira"], queryFn: () => getCxCarteira() }),
  component: CxPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const CORES = { saudavel: "#10b981", atencao: "#f59e0b", risco: "#f43f5e" };
const fmtPeriodo = (p: string) => p.slice(0, 7);
function TendIcon({ t }: { t: string | null }) {
  if (t === "subindo") return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (t === "caindo") return <TrendingDown className="h-3.5 w-3.5 text-rose-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function CxPage() {
  const { data } = useSuspenseQuery({ queryKey: ["cx-carteira"], queryFn: () => getCxCarteira() });
  const pieData = [
    { name: "Saudável", key: "saudavel", value: data.dist.saudavel },
    { name: "Atenção", key: "atencao", value: data.dist.atencao },
    { name: "Risco", key: "risco", value: data.dist.risco },
  ];
  const totalNps = data.npsResumo.promotores + data.npsResumo.neutros + data.npsResumo.detratores;
  const pctNps = (n: number) => (totalNps ? (n / totalNps) * 100 : 0);
  const healthPct = Math.max(0, Math.min(100, Math.round(data.mediaHealth ?? 0)));
  const healthRadial = [{ name: "health", value: healthPct, fill: "var(--color-accent-lime)" }];
  const trendData = data.npsTrend.map((t) => ({ ...t, periodo: fmtPeriodo(t.periodo) }));
  const npsAnterior = data.npsTrend.length > 1 ? data.npsTrend[data.npsTrend.length - 2].nps : data.npsResumo.npsAtual;
  const deltaNps = data.npsResumo.npsAtual - npsAnterior;

  return (
    <>
      <PageHeader title="CX ·" emphasis="Experiência" description="Saúde do relacionamento da carteira. Fale com o Cuidador no assistente para ações de relacionamento." />

      <ResumoTela itens={[
        { label: "Health médio", value: data.mediaHealth },
        { label: "NPS atual", value: data.npsResumo.npsAtual, tone: data.npsResumo.npsAtual >= 0 ? "ok" as const : "warn" as const },
        { label: "Saudáveis", value: data.dist.saudavel, tone: "ok" as const },
        { label: "Em atenção", value: data.dist.atencao },
        { label: "Em risco", value: data.dist.risco, tone: "warn" as const },
      ]} />

      {/* HERO — NPS principal com gradient escuro + sparkline embutido */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground lg:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary-foreground/70">
                <Sparkles className="h-3.5 w-3.5" /> NPS · último período
              </div>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-display text-6xl font-bold leading-none">{data.npsResumo.npsAtual}</span>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                  deltaNps > 0 ? "bg-accent-lime/25 text-accent-lime" : deltaNps < 0 ? "bg-rose-500/25 text-rose-200" : "bg-primary-foreground/10 text-primary-foreground/70")}>
                  {deltaNps > 0 ? <TrendingUp className="h-3 w-3" /> : deltaNps < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  {deltaNps > 0 ? "+" : ""}{deltaNps}
                </span>
              </div>
              <div className="mt-2 text-xs text-primary-foreground/70">{totalNps} respostas · {data.npsResumo.promotores} promotores · {data.npsResumo.detratores} detratores</div>

              <div className="mt-6 flex h-2.5 max-w-md overflow-hidden rounded-full bg-primary-foreground/15">
                <div className="bg-accent-lime" style={{ width: `${pctNps(data.npsResumo.promotores)}%` }} />
                <div className="bg-amber-400" style={{ width: `${pctNps(data.npsResumo.neutros)}%` }} />
                <div className="bg-rose-400" style={{ width: `${pctNps(data.npsResumo.detratores)}%` }} />
              </div>
            </div>

            <div className="h-32 w-full max-w-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="npsHeroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent-lime)" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="var(--color-accent-lime)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip contentStyle={{ background: "rgba(15,23,42,0.9)", border: "none", borderRadius: 10, color: "white", fontSize: 11 }} />
                  <Area type="monotone" dataKey="nps" stroke="var(--color-accent-lime)" strokeWidth={2.5} fill="url(#npsHeroFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-primary-foreground/60">
                {trendData.map((t) => <span key={t.periodo}>{t.periodo.slice(5)}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* Health médio — radial gauge */}
        <div className="rounded-3xl border-0 bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-accent-lime/15 text-accent-lime"><Heart className="h-4 w-4" /></span>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Health médio</div>
              <div className="font-display text-lg leading-tight">Saúde da carteira</div>
            </div>
          </div>
          <div className="relative mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={healthRadial} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={20} background={{ fill: "var(--color-muted)" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-4xl font-bold">{healthPct}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 100</span>
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px]">
            <span className="text-emerald-600">↑ {data.subindo} subindo</span>
            <span className="text-rose-600">↓ {data.caindo} caindo</span>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-display text-lg">Distribuição da carteira</h3>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{data.dist.saudavel + data.dist.atencao + data.dist.risco} clientes</span>
          </div>
          <div className="grid grid-cols-5 gap-4 items-center">
            <div className="col-span-2 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                    {pieData.map((d) => <Cell key={d.key} fill={CORES[d.key as keyof typeof CORES]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="col-span-3 space-y-3">
              {pieData.map((d) => {
                const pct = totalNps ? Math.round((d.value / (data.dist.saudavel + data.dist.atencao + data.dist.risco || 1)) * 100) : 0;
                return (
                  <div key={d.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CORES[d.key as keyof typeof CORES] }} />{d.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.value} · {pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CORES[d.key as keyof typeof CORES] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-display text-lg">NPS · série histórica</h3>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{data.npsTrend.length} períodos</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="npsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="periodo" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="nps" name="NPS" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#npsFill)" dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <h2 className="mb-3 font-display text-xl">Clientes precisando de atenção</h2>
      <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-32">Classificação</TableHead>
              <TableHead className="w-24 text-center">Score</TableHead>
              <TableHead className="w-32">Tendência</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.atencao.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nome}</TableCell>
                <TableCell>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                    c.classificacao === "risco" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}>{c.classificacao}</span>
                </TableCell>
                <TableCell className="text-center font-mono text-sm">{c.score}<span className="text-muted-foreground">/100</span></TableCell>
                <TableCell>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><TendIcon t={c.tendencia} /> {c.tendencia}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Link to="/cx/$empresaId" params={{ empresaId: c.id }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Ver <ArrowRight className="h-3 w-3" /></Link>
                </TableCell>
              </TableRow>
            ))}
            {data.atencao.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum cliente em atenção. 🎉</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

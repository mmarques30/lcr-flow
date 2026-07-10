import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSaudeOperacional } from "@/lib/lcr.functions";
import { formatCompetencia } from "@/lib/format";
import { requireAcesso } from "@/lib/guard";
import { HeartPulse, Search, AlertTriangle, CalendarClock, FileWarning, ClipboardX, Scale, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cx")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "cx", "/cx"),
  head: () => ({ meta: [{ title: "SOS · Saúde Operacional — LCR Contábil" }] }),
  component: SosPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const CLASSE_META: Record<string, { label: string; cor: string; bg: string; barra: string }> = {
  saudavel: { label: "Saudável", cor: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", barra: "bg-emerald-500" },
  atencao:  { label: "Atenção",  cor: "text-amber-700",   bg: "bg-amber-50 border-amber-200",     barra: "bg-amber-500" },
  risco:    { label: "Risco",    cor: "text-rose-700",    bg: "bg-rose-50 border-rose-200",       barra: "bg-rose-500" },
};

const FATOR_META: Record<string, { label: string; icon: typeof AlertTriangle }> = {
  fechamento_atrasado: { label: "Fechamento além da data de corte", icon: CalendarClock },
  fechamento_proximo:  { label: "Data de corte chegando",           icon: CalendarClock },
  docs_pendentes:      { label: "Documentos esperados faltando",    icon: FileWarning },
  docs_erro:           { label: "Documentos com falha de leitura",  icon: FileWarning },
  revisao_pendente:    { label: "Lançamentos aguardando revisão",   icon: ClipboardX },
  divergencias:        { label: "Conciliação com divergências",     icon: Scale },
  status_atrasado:     { label: "Status do mês: atrasado",          icon: AlertTriangle },
  status_cobranca:     { label: "Status do mês: em cobrança",       icon: AlertTriangle },
};

function SosPage() {
  const { data, isLoading } = useQuery({ queryKey: ["sos-carteira"], queryFn: () => getSaudeOperacional({ data: {} }), staleTime: 60_000 });
  const [classe, setClasse] = useState<string>("todas");
  const [q, setQ] = useState("");

  const clientes = data?.clientes ?? [];
  const visiveis = useMemo(() => clientes.filter((c) => {
    if (classe !== "todas" && c.classificacao !== classe) return false;
    if (q && !`${c.nome} ${c.razao_social} ${c.consultor ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [clientes, classe, q]);

  return (
    <>
      <PageHeader
        title="SOS ·"
        emphasis="Saúde Operacional"
        description="Score 0–100 por cliente calculado em tempo real dos sinais do sistema: pontualidade contra a data de corte, documentos esperados × recebidos, falhas de leitura, revisões pendentes e divergências de conciliação."
      />

      <ResumoTela itens={[
        { label: "Acompanhados", value: data?.total ?? 0 },
        { label: "Saúde média", value: data?.media ?? 0, tone: (data?.media ?? 0) >= 80 ? "ok" : "default" },
        { label: "Saudáveis", value: data?.dist.saudavel ?? 0, tone: "ok" },
        { label: "Em atenção", value: data?.dist.atencao ?? 0 },
        { label: "Em risco", value: data?.dist.risco ?? 0, tone: "warn" },
      ]} />

      {/* HERO — média + distribuição + dores da carteira */}
      <div className="mb-6 relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[auto_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary-foreground/70">
              <HeartPulse className="h-3.5 w-3.5" /> Saúde da carteira · {data ? formatCompetencia(data.competencia) : ""}
            </div>
            <div className="mt-3 flex items-end gap-3">
              <span className="font-display text-6xl font-bold leading-none">{data?.media ?? 0}</span>
              <span className="mb-2 text-xs text-primary-foreground/70">/ 100</span>
            </div>
            <div className="mt-2 text-xs text-primary-foreground/70">{data?.total ?? 0} de {data?.total_carteira ?? 0} clientes mensuráveis</div>
          </div>

          <div className="space-y-2 self-center">
            {(["saudavel", "atencao", "risco"] as const).map((k) => {
              const n = data?.dist[k] ?? 0;
              const pct = data?.total ? Math.round((n / data.total) * 100) : 0;
              return (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-primary-foreground/80">{CLASSE_META[k].label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-primary-foreground/10">
                    <div className={cn("h-full rounded-full", CLASSE_META[k].barra)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 text-right font-medium">{n} · {pct}%</span>
                </div>
              );
            })}
          </div>

          <div className="self-center">
            <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-primary-foreground/60">O que mais derruba a carteira</div>
            <div className="space-y-1.5">
              {(data?.topFatores ?? []).slice(0, 4).map((f) => {
                const meta = FATOR_META[f.fator];
                const Icon = meta?.icon ?? AlertTriangle;
                return (
                  <div key={f.fator} className="flex items-center gap-2 text-xs">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-accent-lime" />
                    <span className="flex-1 truncate">{meta?.label ?? f.fator}</span>
                    <Badge variant="secondary" className="bg-primary-foreground/10 text-primary-foreground">{f.clientes} cliente(s)</Badge>
                  </div>
                );
              })}
              {(data?.topFatores ?? []).length === 0 && <div className="text-xs text-primary-foreground/60">Nenhuma dor detectada — carteira limpa.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabela de clientes com fatores */}
      <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
        <div className="space-y-3 border-b border-border p-4">
          <Tabs value={classe} onValueChange={setClasse}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="todas">Todos ({clientes.length})</TabsTrigger>
              <TabsTrigger value="risco">Risco ({data?.dist.risco ?? 0})</TabsTrigger>
              <TabsTrigger value="atencao">Atenção ({data?.dist.atencao ?? 0})</TabsTrigger>
              <TabsTrigger value="saudavel">Saudáveis ({data?.dist.saudavel ?? 0})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente ou consultor" className="pl-8" />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Consultor</TableHead>
              <TableHead className="text-center">Corte</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Principais fatores</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((c) => {
              const meta = CLASSE_META[c.classificacao];
              return (
                <TableRow key={c.id} className="hover:bg-muted/40">
                  <TableCell>
                    <Link to="/clientes/$id" params={{ id: c.id }} className="font-medium hover:text-primary">{c.nome}</Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.consultor ?? "—"}</TableCell>
                  <TableCell className="text-center text-sm">{c.dia_fechamento ? `dia ${c.dia_fechamento}` : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", meta.barra)} style={{ width: `${c.score}%` }} />
                      </div>
                      <span className="w-8 font-display text-base font-bold">{c.score}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.bg, meta.cor)}>{meta.label}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.fatores.slice(0, 2).map((f) => (
                        <span key={f.fator} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title={f.detalhe}>
                          {FATOR_META[f.fator]?.label ?? f.fator} ({f.impacto})
                        </span>
                      ))}
                      {c.fatores.length > 2 && <span className="text-[10px] text-muted-foreground">+{c.fatores.length - 2}</span>}
                      {c.fatores.length === 0 && <span className="text-[10px] text-emerald-600">sem pendências</span>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {visiveis.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  {isLoading ? "Calculando saúde operacional…" : "Nenhum cliente mensurável — configure a data de corte e os documentos esperados no cadastro."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Entram no acompanhamento clientes com data de corte, documentos esperados ou movimento no mês.
            Score parte de 100 e desconta: atraso contra a data de corte (até −40), documentos esperados faltando (até −30),
            falhas de leitura (até −15), revisões pendentes (até −20), divergências (−15) e status do mês (até −15).
          </span>
        </div>
      </Card>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Markdown } from "@/components/markdown";
import { getHistoricoCerebro } from "@/lib/lcr.functions";
import { formatCompetencia } from "@/lib/format";
import { requireAcesso } from "@/lib/guard";
import { Search, Brain, LineChart, HeartHandshake, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/historico")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "historico", "/historico"),
  head: () => ({ meta: [{ title: "Histórico do Cérebro — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["historico-cerebro", "all", "all"], queryFn: () => getHistoricoCerebro({ data: {} }) }),
  component: HistoricoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const PERSONA_META: Record<string, { label: string; icon: typeof Brain; cor: string }> = {
  mestre: { label: "Mestre", icon: Brain, cor: "text-violet-600" },
  consultor: { label: "Consultor", icon: LineChart, cor: "text-blue-600" },
  cuidador: { label: "Cuidador", icon: HeartHandshake, cor: "text-rose-600" },
};

function HistoricoPage() {
  const [persona, setPersona] = useState<string>("all");
  const [empresaId, setEmpresaId] = useState<string>("all");
  const [q, setQ] = useState("");

  const { data } = useQuery({
    queryKey: ["historico-cerebro", persona, empresaId],
    queryFn: () => getHistoricoCerebro({ data: { persona: persona === "all" ? null : (persona as "mestre" | "consultor" | "cuidador"), empresa_id: empresaId === "all" ? null : empresaId } }),
    initialData: () => undefined,
  });

  // opções de cliente: do primeiro carregamento (sem filtro) para o select não esvaziar
  const { data: base } = useSuspenseQuery({ queryKey: ["historico-cerebro", "all", "all"], queryFn: () => getHistoricoCerebro({ data: {} }) });
  const itens = data?.items ?? base.items;
  const [periodo, setPeriodo] = useState("all");
  const periodos = useMemo(() => [...new Set(base.items.map((i) => (i.created_at ? String(i.created_at).slice(0, 7) : null)).filter(Boolean) as string[])].sort().reverse(), [base.items]);

  const filtrados = useMemo(() => itens.filter((i) => {
    if (periodo !== "all" && String(i.created_at ?? "").slice(0, 7) !== periodo) return false;
    if (q && !`${i.cliente ?? ""} ${i.consultor} ${i.pergunta} ${i.resposta ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [itens, q, periodo]);

  const porPersona = (p: string) => base.items.filter((i) => i.persona === p).length;

  return (
    <>
      <PageHeader title="Histórico do" emphasis="Cérebro" description="Todas as análises e insights gerados — consultáveis por data, cliente e consultor." />

      <ResumoTela itens={[
        { label: "Total", value: base.items.length },
        { label: "Mestre", value: porPersona("mestre") },
        { label: "Consultor", value: porPersona("consultor"), tone: "ok" as const },
        { label: "Cuidador", value: porPersona("cuidador") },
      ]} />

      {/* HERO — total de interações + breakdown por persona */}
      <div className="mb-5 relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary-foreground/70">
              <Sparkles className="h-3.5 w-3.5" /> Interações do cérebro · total
            </div>
            <div className="mt-3 flex items-end gap-3">
              <span className="font-display text-6xl font-bold leading-none">{base.items.length}</span>
              <span className="mb-2 text-xs text-primary-foreground/70">análises geradas</span>
            </div>
            <div className="mt-2 text-xs text-primary-foreground/70">{base.clientes.length} clientes cobertos · {periodos.length} período(s)</div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {(["mestre", "consultor", "cuidador"] as const).map((p) => {
              const meta = PERSONA_META[p];
              const Icon = meta.icon;
              return (
                <div key={p} className="rounded-2xl bg-primary-foreground/8 px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-primary-foreground/70"><Icon className="h-3 w-3" />{meta.label}</div>
                  <div className="mt-1 font-display text-3xl font-bold">{porPersona(p)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
        <div className="space-y-3 border-b border-border p-4">
          <Tabs value={persona} onValueChange={setPersona}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="mestre">Mestre</TabsTrigger>
              <TabsTrigger value="consultor">Consultor</TabsTrigger>
              <TabsTrigger value="cuidador">Cuidador</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, consultor ou conteúdo" className="pl-8" />
            </div>
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger><SelectValue placeholder="Período" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os períodos</SelectItem>
                {periodos.map((p) => <SelectItem key={p} value={p}>{formatCompetencia(p)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={empresaId} onValueChange={setEmpresaId}>
              <SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {base.clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="divide-y divide-border">
          {filtrados.map((it) => {
            const meta = PERSONA_META[it.persona] ?? PERSONA_META.mestre;
            const Icon = meta.icon;
            return (
              <details key={it.id} className="group px-4 py-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.cor}`}><Icon className="h-3.5 w-3.5" /> {meta.label}</span>
                    <Badge variant="secondary">{it.cliente ?? "Geral"}</Badge>
                    <span className="text-xs text-muted-foreground">{it.consultor}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{new Date(it.created_at as string).toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="mt-1.5 text-sm font-medium">{it.pergunta}</div>
                  <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground group-open:hidden">{it.resposta}</div>
                </summary>
                <Markdown className="mt-2 text-sm text-foreground">{it.resposta ?? ""}</Markdown>
              </details>
            );
          })}
          {filtrados.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</div>}
        </div>
      </Card>
    </>
  );
}

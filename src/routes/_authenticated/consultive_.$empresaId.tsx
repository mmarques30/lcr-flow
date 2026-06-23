import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getConsultiveEmpresa } from "@/lib/lcr.functions";
import { Markdown } from "@/components/markdown";
import { requireAcesso } from "@/lib/guard";
import { ArrowLeft, Sparkles, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/_authenticated/consultive_/$empresaId")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "consultive", "/consultive"),
  head: () => ({ meta: [{ title: "Análise consultiva — LCR Contábil" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData({ queryKey: ["consultive-empresa", params.empresaId], queryFn: () => getConsultiveEmpresa({ data: { empresa_id: params.empresaId } }) }),
  component: ConsultiveEmpresaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const brl = (v: number | null) => (v == null ? "—" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: number | null) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const sevTone: Record<string, string> = { baixa: "bg-slate-100 text-slate-700", media: "bg-amber-100 text-amber-700", alta: "bg-orange-100 text-orange-700", critica: "bg-rose-100 text-rose-700" };

// Faixas de referência típicas p/ Serviços/Consultoria (interino até benchmarks reais da Onda 3)
const REFS = [
  { key: "margem_bruta", label: "Margem bruta", min: 0, max: 60, low: 30, high: 45, suf: "%", melhorAlto: true },
  { key: "liquidez_corrente", label: "Liquidez corrente", min: 0, max: 4, low: 1.5, high: 2.5, suf: "", melhorAlto: true },
  { key: "endividamento", label: "Endividamento", min: 0, max: 1, low: 0.2, high: 0.5, suf: "", melhorAlto: false },
] as const;

function RangeBar({ value, min, max, low, high }: { value: number; min: number; max: number; low: number; high: number }) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const pos = clamp((value - min) / (max - min)) * 100;
  const bandL = clamp((low - min) / (max - min)) * 100;
  const bandW = clamp((high - low) / (max - min)) * 100;
  const dentro = value >= low && value <= high;
  return (
    <div className="relative h-2.5 rounded-full bg-muted">
      <div className="absolute top-0 h-full rounded-full bg-emerald-300/70" style={{ left: `${bandL}%`, width: `${bandW}%` }} />
      <div className={cn("absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full", dentro ? "bg-foreground" : "bg-rose-500")} style={{ left: `${pos}%` }} />
    </div>
  );
}

function ConsultiveEmpresaPage() {
  const { empresaId } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({ queryKey: ["consultive-empresa", empresaId], queryFn: () => getConsultiveEmpresa({ data: { empresa_id: empresaId } }) });
  const [busy, setBusy] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [comp, setComp] = useState(false);

  const empresa = data.empresa;
  const ult = data.snapshots[0];
  const nome = empresa?.nome_fantasia ?? empresa?.razao_social ?? "Cliente";
  const serieMargem = [...data.snapshots]
    .reverse()
    .map((s) => ({ periodo: String(s.periodo).slice(0, 7), margem: s.margem_bruta == null ? null : Number(s.margem_bruta) }));

  async function gerar(prompt: string) {
    setBusy(true);
    setBriefing(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("cerebro-consultor", { body: { pergunta: prompt, empresa_id: empresaId } });
      if (error) throw error;
      const r = res as { ok?: boolean; resposta?: string; error?: string };
      if (r?.resposta) { setBriefing(r.resposta); toast.success("Análise gerada pelo Consultor."); }
      else toast.error(r?.error ?? "Sem resposta.");
      qc.invalidateQueries({ queryKey: ["consultive-empresa", empresaId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar análise.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link to="/consultive" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Consultivo</Link>
      <PageHeader
        title={nome}
        description={`${empresa?.regime ?? ""} · ${empresa?.segmento ?? ""}`}
        actions={
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => gerar("Gere um briefing executivo da situação financeira deste cliente, com ações concretas.")}>
              <Sparkles className="mr-1 h-4 w-4" /> {busy ? "Gerando…" : "Gerar resumo executivo"}
            </Button>
            <Button variant="outline" onClick={() => setComp((v) => !v)}>{comp ? "Ocultar comparação" : "Comparar com setor"}</Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="p-4"><div className="text-[11px] uppercase text-muted-foreground">Receita</div><div className="mt-1 font-display text-xl">{brl(ult?.receita_total ?? null)}</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase text-muted-foreground">Despesa</div><div className="mt-1 font-display text-xl">{brl(ult?.despesa_total ?? null)}</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase text-muted-foreground">Margem bruta</div><div className="mt-1 font-display text-xl">{pct(ult?.margem_bruta ?? null)}</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase text-muted-foreground">Liquidez</div><div className="mt-1 font-display text-xl">{ult?.liquidez_corrente ?? "—"}</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase text-muted-foreground">Endividamento</div><div className="mt-1 font-display text-xl">{ult?.endividamento ?? "—"}</div></Card>
      </div>

      {comp && (
        <Card className="mb-6 p-5">
          <div className="mb-1 font-display text-lg">Comparação com referência do setor</div>
          <p className="mb-4 text-xs text-muted-foreground">Faixas típicas para Serviços/Consultoria. Benchmarks setoriais reais chegam na Onda 3.</p>
          <div className="space-y-5">
            {REFS.map((r) => {
              const v = ult ? Number((ult as unknown as Record<string, number | null>)[r.key]) : null;
              const has = v != null && !Number.isNaN(v);
              const dentro = has && v >= r.low && v <= r.high;
              const verdict = !has ? "—" : dentro ? "na faixa" : v < r.low ? (r.melhorAlto ? "abaixo da referência" : "abaixo (bom)") : (r.melhorAlto ? "acima (ótimo)" : "acima da referência");
              const tone = !has ? "text-muted-foreground" : dentro ? "text-emerald-600" : (v < r.low ? (r.melhorAlto ? "text-rose-600" : "text-emerald-600") : (r.melhorAlto ? "text-emerald-600" : "text-rose-600"));
              return (
                <div key={r.key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium">{r.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{has ? `${r.suf === "%" ? v.toFixed(1) : v.toFixed(2)}${r.suf}` : "—"}</span>
                      <span className={cn("text-xs", tone)}>· {verdict}</span>
                    </span>
                  </div>
                  {has && <RangeBar value={v} min={r.min} max={r.max} low={r.low} high={r.high} />}
                  <div className="mt-1 text-[11px] text-muted-foreground">referência: {r.suf === "%" ? `${r.low}–${r.high}%` : `${r.low}–${r.high}`}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {serieMargem.length > 1 && (
        <Card className="mb-6 p-5">
          <div className="mb-3 font-display text-lg">Margem bruta · evolução</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={serieMargem}>
                <defs>
                  <linearGradient id="margemFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="periodo" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} width={32} unit="%" />
                <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}%`} />
                <Area type="monotone" dataKey="margem" name="Margem bruta" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#margemFill)" dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {briefing && (
        <Card className="mb-6 p-5">
          <div className="mb-2 flex items-center gap-2 font-display text-lg"><Sparkles className="h-5 w-5 text-primary" /> Briefing do Consultor</div>
          <Markdown className="text-sm text-foreground">{briefing}</Markdown>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-xl">Insights ativos</h2>
          <div className="space-y-3">
            {data.insights.map((i) => (
              <Card key={i.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", sevTone[i.severidade] ?? "bg-slate-100 text-slate-700")}>{i.severidade}</span>
                  <Badge variant="outline" className="text-[10px]">{i.tipo}</Badge>
                </div>
                <div className="mt-2 font-medium">{i.titulo}</div>
                <div className="text-sm text-muted-foreground">{i.descricao}</div>
                {i.sugestao_acao && <div className="mt-2 text-sm"><span className="font-medium">Ação:</span> {i.sugestao_acao}</div>}
              </Card>
            ))}
            {data.insights.length === 0 && <p className="text-sm text-muted-foreground">Nenhum insight ainda. Gere um resumo executivo.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 font-display text-xl">Histórico de análises</h2>
          <Card className="divide-y divide-border">
            {data.interacoes.map((it) => (
              <details key={it.id} className="group px-4 py-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {new Date(it.created_at as string).toLocaleString("pt-BR")}</span>
                    <span>· {it.consultor}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{it.pergunta}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-muted-foreground group-open:hidden">{it.resposta}</div>
                </summary>
                <Markdown className="mt-2 text-sm text-foreground">{it.resposta ?? ""}</Markdown>
              </details>
            ))}
            {data.interacoes.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Sem análises registradas.</div>}
          </Card>
        </div>
      </div>
    </>
  );
}

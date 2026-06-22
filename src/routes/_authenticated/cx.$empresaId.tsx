import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ProgressRing } from "@/components/progress-ring";
import { getCxEmpresa, registrarTouchpoint } from "@/lib/lcr.functions";
import { requireAcesso } from "@/lib/guard";
import { ArrowLeft, Sparkles, Plus, Mail, MessageSquare, Phone, Users, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cx/$empresaId")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "cx", "/cx"),
  head: () => ({ meta: [{ title: "Cliente · CX — LCR Contábil" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData({ queryKey: ["cx-empresa", params.empresaId], queryFn: () => getCxEmpresa({ data: { empresa_id: params.empresaId } }) }),
  component: CxEmpresaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const TP_ICON: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, ligacao: Phone, reuniao: Users, entrega: Package };

function CxEmpresaPage() {
  const { empresaId } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({ queryKey: ["cx-empresa", empresaId], queryFn: () => getCxEmpresa({ data: { empresa_id: empresaId } }) });
  const [busy, setBusy] = useState(false);
  const [sugestao, setSugestao] = useState<string | null>(null);
  const [tpOpen, setTpOpen] = useState(false);
  const [tpTipo, setTpTipo] = useState("email");
  const [tpDesc, setTpDesc] = useState("");

  const nome = data.empresa?.nome_fantasia ?? data.empresa?.razao_social ?? "Cliente";
  const hs = data.health;
  const fatores = (hs?.fatores ?? {}) as Record<string, number>;

  async function gerarComunicacao() {
    setBusy(true); setSugestao(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("cerebro-cuidador", {
        body: { pergunta: "Sugira uma comunicação proativa e personalizada para este cliente, considerando o relacionamento atual.", empresa_id: empresaId },
      });
      if (error) throw error;
      const r = res as { resposta?: string; error?: string };
      if (r?.resposta) { setSugestao(r.resposta); toast.success("Sugestão gerada pelo Cuidador."); }
      else toast.error(r?.error ?? "Sem resposta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar.");
    } finally { setBusy(false); }
  }

  async function salvarTouchpoint() {
    try {
      await registrarTouchpoint({ data: { empresa_id: empresaId, tipo: tpTipo, descricao: tpDesc || null } });
      toast.success("Touchpoint registrado.");
      setTpOpen(false); setTpDesc("");
      qc.invalidateQueries({ queryKey: ["cx-empresa", empresaId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar.");
    }
  }

  return (
    <>
      <Link to="/cx" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> CX · Experiência</Link>
      <PageHeader
        title={nome}
        description="Saúde do relacionamento e jornada do cliente."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTpOpen(true)}><Plus className="mr-1 h-4 w-4" /> Registrar touchpoint</Button>
            <Button disabled={busy} onClick={gerarComunicacao}><Sparkles className="mr-1 h-4 w-4" /> {busy ? "Gerando…" : "Gerar comunicação proativa"}</Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center p-5">
          <div className="mb-3 self-start text-[11px] uppercase text-muted-foreground">Health score</div>
          <ProgressRing value={hs?.score ?? 0} size={140}>
            <span className="font-display text-3xl leading-none">{hs?.score ?? "—"}</span>
            <span className="text-[11px] text-muted-foreground">/100</span>
          </ProgressRing>
          <div className="mt-3 flex items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
              hs?.classificacao === "risco" ? "bg-rose-100 text-rose-700" : hs?.classificacao === "atencao" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>{hs?.classificacao ?? "—"}</span>
            <span className="text-xs text-muted-foreground">tendência {hs?.tendencia ?? "—"}</span>
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 text-[11px] uppercase text-muted-foreground">Fatores do health score</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(fatores).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-[11px] capitalize text-muted-foreground">{k.replace(/_/g, " ")}</div>
                <div className="mt-0.5 font-display text-xl">{typeof v === "number" ? (v < 1 && v > 0 ? `${Math.round(v * 100)}%` : v) : String(v)}</div>
              </div>
            ))}
            {Object.keys(fatores).length === 0 && <div className="text-sm text-muted-foreground">Sem fatores calculados.</div>}
          </div>
        </Card>
      </div>

      {sugestao && (
        <Card className="mb-6 border-primary/40 p-5">
          <div className="mb-2 flex items-center gap-2 font-display text-lg"><Sparkles className="h-5 w-5 text-primary" /> Comunicação sugerida pelo Cuidador</div>
          <div className="whitespace-pre-wrap text-sm">{sugestao}</div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-xl">Timeline de touchpoints</h2>
          <Card className="divide-y divide-border">
            {data.touchpoints.map((t) => {
              const Icon = TP_ICON[t.tipo] ?? Mail;
              return (
                <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{t.tipo}{t.canal ? ` · ${t.canal}` : ""}</span>
                      <span className="text-xs text-muted-foreground">{new Date(t.created_at as string).toLocaleDateString("pt-BR")}</span>
                    </div>
                    {t.descricao && <div className="text-sm text-muted-foreground">{t.descricao}</div>}
                  </div>
                </div>
              );
            })}
            {data.touchpoints.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum touchpoint registrado.</div>}
          </Card>
        </div>
        <div>
          <h2 className="mb-3 font-display text-xl">Histórico de NPS</h2>
          <Card className="divide-y divide-border">
            {data.nps.map((r) => (
              <div key={`${r.periodo}-${r.score}`} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">{(r.periodo as string).slice(0, 7)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg">{r.score}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{r.categoria}</Badge>
                </div>
              </div>
            ))}
            {data.nps.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Sem respostas de NPS.</div>}
          </Card>
        </div>
      </div>

      <Dialog open={tpOpen} onOpenChange={setTpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl">Registrar touchpoint</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={tpTipo} onValueChange={setTpTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="reuniao">Reunião</SelectItem>
                <SelectItem value="ligacao">Ligação</SelectItem>
                <SelectItem value="entrega">Entrega</SelectItem>
              </SelectContent>
            </Select>
            <Input value={tpDesc} onChange={(e) => setTpDesc(e.target.value)} placeholder="Descrição (opcional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTpOpen(false)}>Cancelar</Button>
            <Button onClick={salvarTouchpoint}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

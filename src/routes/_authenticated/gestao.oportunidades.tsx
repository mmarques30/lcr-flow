import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requireAcesso } from "@/lib/guard";
import {
  listarOportunidades, mudarStatusOportunidade, votarOportunidade,
  comentariosOportunidade, comentarOportunidade, historicoOportunidade,
  STATUS_ORDEM, STATUS_LABEL, TIPO_LABEL,
  type Oportunidade, type OportStatus,
} from "@/lib/oportunidades.functions";
import { Bug, Lightbulb, HelpCircle, ThumbsUp, Kanban, List } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/gestao/oportunidades")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "gestao:oportunidades", "/gestao/oportunidades"),
  head: () => ({ meta: [{ title: "Oportunidades — Gestão — LCR Contábil" }] }),
  component: OportunidadesPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const TIPO_ICON = { bug: Bug, melhoria: Lightbulb, duvida: HelpCircle } as const;
const TIPO_COR = {
  bug: "text-rose-600 bg-rose-50 border-rose-200",
  melhoria: "text-amber-600 bg-amber-50 border-amber-200",
  duvida: "text-blue-600 bg-blue-50 border-blue-200",
} as const;

function OportunidadesPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [sel, setSel] = useState<Oportunidade | null>(null);

  const { data: opts = [] } = useQuery({
    queryKey: ["oportunidades"],
    queryFn: () => listarOportunidades(),
  });

  const votar = useMutation({
    mutationFn: (opt: Oportunidade) => votarOportunidade(opt.id, !opt.votei),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["oportunidades"] });
      toast.success("Voto registrado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível votar."),
  });

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OportStatus }) => mudarStatusOportunidade(id, status),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["oportunidades"] });
      setSel((atual) => (atual && atual.id === vars.id ? { ...atual, status: vars.status } : atual));
      toast.success("Status atualizado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível alterar o status."),
  });

  const porStatus = useMemo(() => {
    const map: Record<OportStatus, Oportunidade[]> = {
      aberto: [], em_analise: [], planejado: [], em_dev: [], entregue: [], descartado: [],
    };
    for (const o of opts) map[o.status].push(o);
    return map;
  }, [opts]);

  const totalPorTipo = (t: "bug" | "melhoria" | "duvida") => opts.filter((o) => o.tipo === t).length;

  return (
    <>
      <PageHeader
        title="Banco de"
        emphasis="Oportunidades"
        description="Bugs, melhorias e dúvidas coletados pelo Cérebro (persona Reportar). Bruno prioriza no Kanban."
        actions={
          <div className="flex items-center gap-2">
            <Button variant={view === "kanban" ? "default" : "outline"} size="sm" onClick={() => setView("kanban")}>
              <Kanban className="mr-1 h-4 w-4" /> Kanban
            </Button>
            <Button variant={view === "lista" ? "default" : "outline"} size="sm" onClick={() => setView("lista")}>
              <List className="mr-1 h-4 w-4" /> Lista
            </Button>
          </div>
        }
      />

      <ResumoTela itens={[
        { label: "Total", value: opts.length },
        { label: "Bugs", value: totalPorTipo("bug"), tone: totalPorTipo("bug") > 0 ? "warn" : "default" },
        { label: "Melhorias", value: totalPorTipo("melhoria") },
        { label: "Dúvidas", value: totalPorTipo("duvida") },
        { label: "Entregues", value: porStatus.entregue.length, tone: "ok" },
      ]} />

      {view === "kanban" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {STATUS_ORDEM.map((st) => (
            <Card key={st} className="rounded-2xl border-0 bg-muted/30 p-3 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{STATUS_LABEL[st]}</div>
                <Badge variant="secondary">{porStatus[st].length}</Badge>
              </div>
              <div className="space-y-2">
                {porStatus[st].length === 0 && <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground/70">sem itens</div>}
                {porStatus[st].map((o) => {
                  const Icon = TIPO_ICON[o.tipo];
                  return (
                    <div
                      key={o.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSel(o)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSel(o); }}
                      className="w-full cursor-pointer rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", TIPO_COR[o.tipo])}>
                          <Icon className="h-3 w-3" />
                          {TIPO_LABEL[o.tipo]}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{o.numero}</span>
                        <button
                          type="button"
                          title={o.votei ? "Remover voto" : "Votar"}
                          disabled={votar.isPending}
                          onClick={(e) => { e.stopPropagation(); votar.mutate(o); }}
                          className={cn(
                            "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted",
                            o.votei ? "text-primary font-medium" : "text-muted-foreground",
                          )}
                        >
                          <ThumbsUp className="h-3 w-3" /> {o.votos ?? 0}
                        </button>
                      </div>
                      <div className="mt-1.5 line-clamp-2 text-sm font-medium">{o.titulo}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl border-0 shadow-soft">
          <div className="divide-y divide-border">
            {opts.map((o) => {
              const Icon = TIPO_ICON[o.tipo];
              return (
                <button key={o.id} onClick={() => setSel(o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/20">
                  <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", TIPO_COR[o.tipo])}>
                    <Icon className="h-3 w-3" /> {TIPO_LABEL[o.tipo]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{o.numero}</span>
                  <span className="flex-1 truncate text-sm font-medium">{o.titulo}</span>
                  <Badge variant="secondary">{STATUS_LABEL[o.status]}</Badge>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><ThumbsUp className="h-3 w-3" />{o.votos ?? 0}</span>
                </button>
              );
            })}
            {opts.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Sem oportunidades registradas. Use o Cérebro na persona Reportar para criar.</div>}
          </div>
        </Card>
      )}

      {sel && (
        <PainelDetalhe
          opt={sel}
          onClose={() => setSel(null)}
          onMudarStatus={(s) => mudarStatus.mutate({ id: sel.id, status: s })}
          onVotar={() => votar.mutate(sel)}
        />
      )}
    </>
  );
}

function PainelDetalhe({ opt, onClose, onMudarStatus, onVotar }: {
  opt: Oportunidade; onClose: () => void;
  onMudarStatus: (s: OportStatus) => void; onVotar: () => void;
}) {
  const qc = useQueryClient();
  const [comentario, setComentario] = useState("");
  const { data: coms = [] } = useQuery({ queryKey: ["oport-com", opt.id], queryFn: () => comentariosOportunidade(opt.id) });
  const { data: hist = [] } = useQuery({ queryKey: ["oport-hist", opt.id], queryFn: () => historicoOportunidade(opt.id) });

  const enviarCom = useMutation({
    mutationFn: () => comentarOportunidade(opt.id, comentario.trim(), "interno"),
    onSuccess: () => {
      setComentario("");
      qc.invalidateQueries({ queryKey: ["oport-com", opt.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const Icon = TIPO_ICON[opt.tipo];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", TIPO_COR[opt.tipo])}>
              <Icon className="h-3 w-3" /> {TIPO_LABEL[opt.tipo]}
            </span>
            <span className="text-xs text-muted-foreground">{opt.numero}</span>
          </div>
          <SheetTitle className="text-lg">{opt.titulo}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">{opt.descricao}</p>

          <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 text-xs">
            {opt.impacto && <div><span className="text-muted-foreground">Impacto:</span> <span className="font-medium">{opt.impacto}</span></div>}
            {opt.tela_origem && <div><span className="text-muted-foreground">Tela:</span> <span className="font-medium">{opt.tela_origem}</span></div>}
            <div><span className="text-muted-foreground">Prioridade:</span> <span className="font-medium">{opt.prioridade}</span></div>
            <div><span className="text-muted-foreground">Criada:</span> <span className="font-medium">{new Date(opt.criado_em).toLocaleDateString("pt-BR")}</span></div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={opt.status} onValueChange={(v) => onMudarStatus(v as OportStatus)}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ORDEM.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant={opt.votei ? "default" : "outline"} size="sm" onClick={onVotar}>
              <ThumbsUp className="mr-1 h-4 w-4" /> {opt.votos ?? 0}
            </Button>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comentários internos</div>
            <div className="mb-2 space-y-2">
              {coms.length === 0 && <div className="text-xs text-muted-foreground">Sem comentários.</div>}
              {coms.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <div className="mb-0.5 text-[10px] text-muted-foreground">{new Date(c.criado_em).toLocaleString("pt-BR")}</div>
                  <div className="whitespace-pre-wrap">{c.conteudo}</div>
                </div>
              ))}
            </div>
            <Textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Escreva um comentário…" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={!comentario.trim() || enviarCom.isPending} onClick={() => enviarCom.mutate()}>Enviar</Button>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico de status</div>
            <div className="space-y-1">
              {hist.length === 0 && <div className="text-xs text-muted-foreground">Sem mudanças de status.</div>}
              {hist.map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{new Date(h.mudado_em).toLocaleString("pt-BR")}</span>
                  <span>{h.status_anterior ?? "—"} → <span className="font-medium">{h.status_novo}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


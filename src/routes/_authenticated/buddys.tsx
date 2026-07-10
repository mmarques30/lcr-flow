import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getHistoricoCerebro } from "@/lib/lcr.functions";
import { listarOportunidades, STATUS_LABEL, TIPO_LABEL, type Oportunidade } from "@/lib/oportunidades.functions";
import { telaLabel } from "@/lib/logs.functions";
import { requireAcesso } from "@/lib/guard";
import { Compass, MessageSquareWarning, Bug, Lightbulb, HelpCircle, ThumbsUp, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/buddys")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "knowledge", "/buddys"),
  head: () => ({ meta: [{ title: "Buddys — LCR Contábil" }] }),
  component: BuddysPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type ItemCerebro = { id: number | string; persona: string; pergunta: string; resposta: string | null; created_at: unknown; consultor: string; cliente: string | null };

function BuddysPage() {
  const { data: trainning } = useQuery({
    queryKey: ["buddys", "buddy"],
    queryFn: () => getHistoricoCerebro({ data: { persona: "buddy" } }),
    staleTime: 60_000,
  });
  const { data: bugHist } = useQuery({
    queryKey: ["buddys", "reportar"],
    queryFn: () => getHistoricoCerebro({ data: { persona: "reportar" } }),
    staleTime: 60_000,
  });
  const { data: oports = [] } = useQuery({ queryKey: ["oportunidades"], queryFn: () => listarOportunidades(), staleTime: 60_000 });

  const itensTrainning = (trainning?.items ?? []) as ItemCerebro[];
  const itensBug = (bugHist?.items ?? []) as ItemCerebro[];

  return (
    <>
      <PageHeader
        title="Buddys ·"
        emphasis="uso e dores"
        description="O que a equipe pergunta ao Buddy Trainning (dúvidas de uso do sistema) e o que reporta ao Buddy Bug (bugs, melhorias e dúvidas que viram oportunidades). As perguntas mais frequentes indicam onde treinar e o que corrigir."
      />

      <ResumoTela itens={[
        { label: "Perguntas Trainning", value: itensTrainning.length },
        { label: "Conversas Bug", value: itensBug.length },
        { label: "Oportunidades", value: oports.length },
        { label: "Bugs abertos", value: oports.filter((o) => o.tipo === "bug" && !["entregue", "descartado"].includes(o.status)).length, tone: "warn" },
        { label: "Entregues", value: oports.filter((o) => o.status === "entregue").length, tone: "ok" },
      ]} />

      <Tabs defaultValue="trainning">
        <TabsList className="mb-4">
          <TabsTrigger value="trainning" className="gap-1.5"><Compass className="h-3.5 w-3.5" /> Buddy Trainning</TabsTrigger>
          <TabsTrigger value="bug" className="gap-1.5"><MessageSquareWarning className="h-3.5 w-3.5" /> Buddy Bug</TabsTrigger>
        </TabsList>

        <TabsContent value="trainning">
          <AbaTrainning itens={itensTrainning} />
        </TabsContent>
        <TabsContent value="bug">
          <AbaBug itens={itensBug} oports={oports} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Dúvidas de uso: quem mais pergunta (onde treinar) + últimas perguntas. */
function AbaTrainning({ itens }: { itens: ItemCerebro[] }) {
  const porPessoa = useMemo(() => {
    const m = new Map<string, number>();
    itens.forEach((i) => m.set(i.consultor, (m.get(i.consultor) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [itens]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card className="rounded-3xl border-0 p-5 shadow-soft">
        <h3 className="mb-3 flex items-center gap-1.5 font-display text-lg"><TrendingUp className="h-4 w-4 text-primary" /> Quem mais pergunta</h3>
        <p className="mb-3 text-xs text-muted-foreground">Volume alto de dúvidas de uso = onde focar o treinamento.</p>
        <div className="space-y-2">
          {porPessoa.map(([nome, n]) => (
            <div key={nome} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{nome}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${porPessoa[0] ? (n / porPessoa[0][1]) * 100 : 0}%` }} />
              </div>
              <Badge variant="secondary">{n}</Badge>
            </div>
          ))}
          {porPessoa.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma pergunta ainda.</div>}
        </div>
      </Card>

      <Card className="rounded-3xl border-0 shadow-soft">
        <div className="border-b border-border px-5 py-3 font-display text-lg">Dúvidas de uso — as dores de quem opera</div>
        <div className="divide-y divide-border">
          {itens.map((i) => (
            <details key={i.id} className="group px-5 py-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{i.consultor}</span>
                  {i.cliente && <span>· {i.cliente}</span>}
                  <span className="ml-auto">{i.created_at ? fmtDataHora(String(i.created_at)) : ""}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{i.pergunta}</div>
              </summary>
              <div className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-xs">{i.resposta}</div>
            </details>
          ))}
          {itens.length === 0 && <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma dúvida registrada — o Buddy Trainning ainda não foi usado.</div>}
        </div>
      </Card>
    </div>
  );
}

const TIPO_ICON = { bug: Bug, melhoria: Lightbulb, duvida: HelpCircle } as const;
const TIPO_COR = {
  bug: "text-rose-600 bg-rose-50 border-rose-200",
  melhoria: "text-amber-600 bg-amber-50 border-amber-200",
  duvida: "text-blue-600 bg-blue-50 border-blue-200",
} as const;

/** Bugs e melhorias reportados: onde dói (telas), o que mais votado, conversas. */
function AbaBug({ itens, oports }: { itens: ItemCerebro[]; oports: Oportunidade[] }) {
  const porTipo = useMemo(() => {
    const m = { bug: 0, melhoria: 0, duvida: 0 };
    oports.forEach((o) => { m[o.tipo]++; });
    return m;
  }, [oports]);

  const porTela = useMemo(() => {
    const m = new Map<string, number>();
    oports.forEach((o) => {
      const t = telaLabel(o.tela_origem);
      m.set(t, (m.get(t) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [oports]);

  const maisVotadas = useMemo(
    () => [...oports].filter((o) => !["entregue", "descartado"].includes(o.status)).sort((a, b) => (b.votos ?? 0) - (a.votos ?? 0)).slice(0, 6),
    [oports],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-3xl border-0 p-5 shadow-soft">
          <h3 className="mb-3 font-display text-lg">Por tipo</h3>
          <div className="space-y-2">
            {(Object.keys(porTipo) as (keyof typeof porTipo)[]).map((t) => {
              const Icon = TIPO_ICON[t];
              return (
                <div key={t} className="flex items-center gap-2 text-sm">
                  <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", TIPO_COR[t])}>
                    <Icon className="h-3 w-3" /> {TIPO_LABEL[t]}
                  </span>
                  <span className="ml-auto font-display text-xl font-bold">{porTipo[t]}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="rounded-3xl border-0 p-5 shadow-soft">
          <h3 className="mb-3 font-display text-lg">Onde mais dói</h3>
          <p className="mb-3 text-xs text-muted-foreground">Telas que mais geram reporte.</p>
          <div className="space-y-1.5">
            {porTela.map(([tela, n]) => (
              <div key={tela} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">{tela}</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${porTela[0] ? (n / porTela[0][1]) * 100 : 0}%` }} />
                </div>
                <Badge variant="secondary">{n}</Badge>
              </div>
            ))}
            {porTela.length === 0 && <div className="text-xs text-muted-foreground">Sem reportes ainda.</div>}
          </div>
        </Card>

        <Card className="rounded-3xl border-0 p-5 shadow-soft">
          <h3 className="mb-3 font-display text-lg">Mais votadas</h3>
          <div className="space-y-2">
            {maisVotadas.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{o.numero}</span>
                <span className="flex-1 truncate">{o.titulo}</span>
                <span className="inline-flex items-center gap-0.5 text-muted-foreground"><ThumbsUp className="h-3 w-3" />{o.votos ?? 0}</span>
              </div>
            ))}
            {maisVotadas.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma oportunidade aberta.</div>}
          </div>
        </Card>
      </div>

      <Card className="rounded-3xl border-0 shadow-soft">
        <div className="border-b border-border px-5 py-3 font-display text-lg">Oportunidades geradas</div>
        <div className="divide-y divide-border">
          {oports.slice(0, 40).map((o) => {
            const Icon = TIPO_ICON[o.tipo];
            return (
              <details key={o.id} className="group px-5 py-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", TIPO_COR[o.tipo])}>
                      <Icon className="h-3 w-3" /> {TIPO_LABEL[o.tipo]}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{o.numero}</span>
                    <span className="text-sm font-medium">{o.titulo}</span>
                    <Badge variant="secondary" className="ml-auto">{STATUS_LABEL[o.status]}</Badge>
                  </div>
                </summary>
                <div className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-xs">{o.descricao}</div>
              </details>
            );
          })}
          {oports.length === 0 && <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma oportunidade — use o Buddy Bug no Cérebro para reportar.</div>}
        </div>
      </Card>

      {itens.length > 0 && (
        <Card className="rounded-3xl border-0 shadow-soft">
          <div className="border-b border-border px-5 py-3 font-display text-lg">Conversas com o Buddy Bug</div>
          <div className="divide-y divide-border">
            {itens.slice(0, 30).map((i) => (
              <div key={i.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{i.consultor}</span>
                  <span className="ml-auto">{i.created_at ? fmtDataHora(String(i.created_at)) : ""}</span>
                </div>
                <div className="mt-1 text-sm">{i.pergunta}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

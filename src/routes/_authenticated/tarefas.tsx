import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { listTarefas, listConsultores, moverTarefa } from "@/lib/lcr.functions";
import { TAREFA_TIPO_LABEL, formatCompetencia } from "@/lib/format";
import { StatusPill } from "@/components/status-pill";
import { Calendar, User, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

type TarefaStatus = "now" | "doing" | "next" | "back" | "done";
type TipoGrupo = "cobranca" | "lancamentos" | "conciliacao";
type Tarefa = {
  id: string; tipo: string; status: string; titulo: string; prazo: string | null; competencia: string | null;
  empresa: { razao_social: string } | null; consultor: { id: string; nome: string } | null;
};

const COLUNAS: { key: TarefaStatus; label: string; variant: "now" | "doing" | "next" | "back" | "neutral" }[] = [
  { key: "now", label: "Em foco", variant: "now" },
  { key: "doing", label: "Em andamento", variant: "doing" },
  { key: "next", label: "Próximas", variant: "next" },
  { key: "back", label: "Atrasadas / revisar", variant: "back" },
  { key: "done", label: "Concluídas", variant: "neutral" },
];

// Normaliza as duas gerações de enum (antiga + spec) para os grupos/colunas.
const TIPO_GROUP: Record<string, TipoGrupo> = {
  cobranca: "cobranca", cobranca_movimento: "cobranca",
  lancamentos: "lancamentos", lancamentos_contabeis: "lancamentos",
  conciliacao: "conciliacao", conciliacao_balancete: "conciliacao",
};
const STATUS_COL: Record<string, TarefaStatus> = {
  now: "now", doing: "doing", next: "next", back: "back", done: "done",
  aberta: "next", em_andamento: "doing", concluida: "done", bloqueada: "back",
};

const ABAS: { key: "all" | TipoGrupo; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "cobranca", label: TAREFA_TIPO_LABEL.cobranca },
  { key: "lancamentos", label: TAREFA_TIPO_LABEL.lancamentos },
  { key: "conciliacao", label: TAREFA_TIPO_LABEL.conciliacao },
];

export const Route = createFileRoute("/_authenticated/tarefas")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "tarefas", "/tarefas"),
  head: () => ({ meta: [{ title: "Tarefas — LCR Contábil" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["tarefas"], queryFn: () => listTarefas() }),
      context.queryClient.ensureQueryData({ queryKey: ["consultores"], queryFn: () => listConsultores() }),
    ]);
  },
  component: TarefasPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function TarefasPage() {
  const qc = useQueryClient();
  const { data: tarefas } = useSuspenseQuery({ queryKey: ["tarefas"], queryFn: () => listTarefas() });
  const { data: consultores } = useSuspenseQuery({ queryKey: ["consultores"], queryFn: () => listConsultores() });
  const [consultorFiltro, setConsultorFiltro] = useState("all");
  const [compFiltro, setCompFiltro] = useState("all");
  const [tipoAba, setTipoAba] = useState<"all" | TipoGrupo>("all");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const competencias = useMemo(() => [...new Set((tarefas as Tarefa[]).map((t) => t.competencia).filter(Boolean) as string[])].sort().reverse(), [tarefas]);

  const filtered = useMemo(
    () => (tarefas as Tarefa[]).filter((t) => {
      if (consultorFiltro !== "all" && t.consultor?.id !== consultorFiltro) return false;
      if (compFiltro !== "all" && t.competencia !== compFiltro) return false;
      if (tipoAba !== "all" && TIPO_GROUP[t.tipo] !== tipoAba) return false;
      return true;
    }),
    [tarefas, consultorFiltro, compFiltro, tipoAba],
  );

  async function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const newStatus = e.over?.id ? String(e.over.id).split(":")[1] : null;
    if (!newStatus) return;
    const t = (tarefas as Tarefa[]).find((x) => x.id === id);
    if (!t || STATUS_COL[t.status] === newStatus) return;
    try {
      await moverTarefa({ data: { id, status: newStatus as TarefaStatus } });
      qc.invalidateQueries({ queryKey: ["tarefas"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
      <PageHeader
        title="Tarefas"
        description="Espelho do Gestta — fluxo mensal de cobrança, lançamentos e conciliação."
        actions={
          <>
            {competencias.length > 0 && (
              <Select value={compFiltro} onValueChange={setCompFiltro}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Competência" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as competências</SelectItem>
                  {competencias.map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={consultorFiltro} onValueChange={setConsultorFiltro}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Consultor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os consultores</SelectItem>
                {consultores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />

      <ResumoTela itens={[
        { label: "Total", value: filtered.length },
        { label: "A fazer", value: filtered.filter((t) => STATUS_COL[t.status] === "now").length },
        { label: "Em andamento", value: filtered.filter((t) => STATUS_COL[t.status] === "doing").length },
        { label: "Atrasadas", value: filtered.filter((t) => t.prazo && new Date(t.prazo) < new Date(new Date().toDateString()) && STATUS_COL[t.status] !== "done").length, tone: "warn" as const },
        { label: "Concluídas", value: filtered.filter((t) => STATUS_COL[t.status] === "done").length, tone: "ok" as const },
      ]} />

      <Tabs value={tipoAba} onValueChange={(v) => setTipoAba(v as "all" | TipoGrupo)} className="mb-5">
        <TabsList>
          {ABAS.map((a) => {
            const n = (tarefas as Tarefa[]).filter((t) =>
              (a.key === "all" || TIPO_GROUP[t.tipo] === a.key) &&
              (consultorFiltro === "all" || t.consultor?.id === consultorFiltro),
            ).length;
            return <TabsTrigger key={a.key} value={a.key}>{a.label} <span className="ml-1.5 text-xs text-muted-foreground">{n}</span></TabsTrigger>;
          })}
        </TabsList>
      </Tabs>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {COLUNAS.map((col) => {
            const items = filtered.filter((t) => STATUS_COL[t.status] === col.key);
            return <Coluna key={col.key} colKey={`${tipoAba}:${col.key}`} label={col.label} variant={col.variant} items={items} />;
          })}
        </div>
      </DndContext>
    </>
  );
}

function Coluna({ colKey, label, variant, items }: { colKey: string; label: string; variant: "now" | "doing" | "next" | "back" | "neutral"; items: Tarefa[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  return (
    <div ref={setNodeRef} className={`rounded-xl border border-border/70 bg-muted/30 p-3 min-h-32 shadow-soft transition-shadow ${isOver ? "ring-2 ring-primary/60 bg-accent/40" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <StatusPill variant={variant}>{label}</StatusPill>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-soft">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((t) => <CardTarefa key={t.id} t={t} done={STATUS_COL[t.status] === "done"} />)}
        {items.length === 0 && <div className="text-xs text-muted-foreground py-4 text-center">—</div>}
      </div>
    </div>
  );
}

function CardTarefa({ t, done }: { t: Tarefa; done: boolean }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: t.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const atrasada = !done && t.prazo ? new Date(t.prazo) < new Date(new Date().toDateString()) : false;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-lg border bg-card p-3 text-sm shadow-soft transition-shadow hover:shadow-card cursor-grab active:cursor-grabbing ${isDragging ? "opacity-50 shadow-elevated" : ""} ${atrasada ? "border-destructive/40" : "border-border"}`}
    >
      <div className={`font-medium line-clamp-2 ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.titulo}</div>
      <div className="text-xs text-muted-foreground mt-1 truncate">{t.empresa?.razao_social}</div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-muted-foreground">
        {t.prazo ? (
          <span className={`inline-flex items-center gap-1 ${atrasada ? "font-medium text-destructive" : ""}`}>
            {atrasada ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
            {new Date(t.prazo).toLocaleDateString("pt-BR")}
          </span>
        ) : <span />}
        {t.consultor ? <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{t.consultor.nome.split(" ")[0]}</span> : null}
      </div>
    </div>
  );
}

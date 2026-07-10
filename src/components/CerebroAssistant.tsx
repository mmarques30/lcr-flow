import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, LineChart, HeartHandshake, Send, X, Compass, MessageSquareWarning, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { trackAction } from "@/lib/logs.functions";
import { criarOportunidade } from "@/lib/oportunidades.functions";
import { toast } from "sonner";

function CerebroIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2.5c-5.25 0-9.5 3.86-9.5 8.62 0 2.64 1.3 4.99 3.34 6.57L5 21.5l3.86-1.48c.98.28 2.03.43 3.14.43 5.25 0 9.5-3.86 9.5-8.62S17.25 2.5 12 2.5Z" fill="currentColor" />
      <path d="M10 8.3l5.2 3-5.2 3V8.3Z" fill="var(--color-primary)" />
    </svg>
  );
}

type Persona = "mestre" | "consultor" | "cuidador" | "buddy" | "reportar";
type Msg = { autor: "user" | "ia"; texto: string };
type Turno = { role: "user" | "assistant"; content: string };

const PERSONAS: Record<Persona, { label: string; fn: string; icon: typeof Brain; cor: string; saudacao: string }> = {
  mestre:    { label: "Mestre",          fn: "cerebro-mestre",    icon: Brain,                 cor: "text-violet-600", saudacao: "Sou o Mestre. Pergunte sobre processos, padrões e procedimentos da LCR." },
  consultor: { label: "Consultor",       fn: "cerebro-consultor", icon: LineChart,             cor: "text-blue-600",   saudacao: "Sou o Consultor. Posso analisar a saúde financeira e gerar insights do cliente." },
  cuidador:  { label: "Cuidador",        fn: "cerebro-cuidador",  icon: HeartHandshake,        cor: "text-rose-600",   saudacao: "Sou o Cuidador. Cuido do relacionamento e do health score da carteira." },
  buddy:     { label: "Buddy Trainning", fn: "cerebro-buddy",     icon: Compass,               cor: "text-emerald-600",saudacao: "Sou o Buddy Trainning. Me pergunte COMO fazer algo na tela — botões, campos, fluxo. Se for dúvida contábil, chame o Mestre." },
  reportar:  { label: "Buddy Bug",       fn: "cerebro-reportar",  icon: MessageSquareWarning,  cor: "text-amber-600",  saudacao: "Sou o Buddy Bug. Me conta um bug, melhoria ou dúvida. Levo pro Bruno hoje." },
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function personaDaRota(pathname: string): Persona {
  if (pathname.startsWith("/consultive"))                                          return "consultor";
  if (pathname.startsWith("/cx"))                                                  return "cuidador";
  if (pathname.startsWith("/gestao/oport"))                                        return "reportar";
  if (/^\/(conciliacao|documentos|lancamentos|tarefas|clientes\/)/.test(pathname)) return "buddy";
  return "mestre";
}

export function CerebroAssistant() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [persona, setPersona] = useState<Persona>("mestre");
  const [personaTravada, setPersonaTravada] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ctxTurnos, setCtxTurnos] = useState<Turno[]>([]);  // usado só pela persona Reportar
  const [oportunidadeAtiva, setOportunidadeAtiva] = useState<{ id: string; numero: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  const empresaId = useMemo(() => {
    if (/^\/(consultive|cx|clientes|conciliacao)\//.test(pathname)) return pathname.match(UUID_RE)?.[0] ?? undefined;
    return undefined;
  }, [pathname]);

  useEffect(() => {
    if (!personaTravada) {
      const nova = personaDaRota(pathname);
      setPersona(nova);
    }
  }, [pathname, personaTravada]);

  useEffect(() => {
    // trocar persona limpa o contexto conversacional do Reportar
    setCtxTurnos([]);
    setMsgs([]);
    setOportunidadeAtiva(null);
  }, [persona]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function enviar() {
    const q = pergunta.trim();
    if (!q || busy) return;
    setPergunta("");
    setMsgs((m) => [...m, { autor: "user", texto: q }]);
    setBusy(true);
    try {
      const bodyBase: Record<string, unknown> = { pergunta: q, empresa_id: empresaId, tela: pathname };
      if (persona === "reportar") {
        bodyBase.conversation_context = ctxTurnos;
        if (oportunidadeAtiva) bodyBase.oportunidade_id = oportunidadeAtiva.id;
      }

      const { data, error } = await supabase.functions.invoke(PERSONAS[persona].fn, { body: bodyBase });
      if (error) throw error;
      const resp = data as {
        ok?: boolean;
        resposta?: string;
        error?: string;
        oportunidade?: { id: string; numero: string } | null;
        oportunidade_id?: string | null;
        conversation_context?: Turno[];
      };
      const texto = resp?.resposta || resp?.error || "Sem resposta.";
      setMsgs((m) => [...m, { autor: "ia", texto }]);
      if (persona === "reportar" && resp.conversation_context) setCtxTurnos(resp.conversation_context);
      if (persona === "reportar" && resp.oportunidade) setOportunidadeAtiva(resp.oportunidade);

      // tracking
      void trackAction("perguntou_cerebro", { clienteId: empresaId ?? null, tela: pathname, detalhes: { persona } });
      if (persona === "reportar" && resp.oportunidade) {
        void trackAction("reportou_oportunidade", { clienteId: empresaId ?? null, tela: pathname, detalhes: { numero: resp.oportunidade.numero, id: resp.oportunidade.id } });
      }
    } catch (e) {
      setMsgs((m) => [...m, { autor: "ia", texto: `Não consegui responder agora: ${e instanceof Error ? e.message : "erro"}.` }]);
    } finally {
      setBusy(false);
    }
  }

  async function salvarConversaComoOportunidade() {
    const mensagensUser = msgs.filter((m) => m.autor === "user");
    if (!mensagensUser.length) {
      toast.info("Envie uma mensagem primeiro contando o que quer reportar.");
      return;
    }
    try {
      const descricao = mensagensUser.map((m) => m.texto).join("\n---\n");
      const titulo = mensagensUser[0].texto.slice(0, 80);
      const opt = await criarOportunidade({
        tipo: "duvida",
        titulo,
        descricao,
        tela_origem: pathname,
        cliente_id: empresaId,
      });
      setMsgs((m) => [...m, { autor: "ia", texto: `Registrei essa conversa como **${opt.numero}** no Banco de Oportunidades. Bruno vê hoje. Você acompanha em Gestão › Oportunidades e pode ajustar o tipo (bug / melhoria / dúvida) por lá.` }]);
      void trackAction("reportou_oportunidade", { clienteId: empresaId ?? null, tela: pathname, detalhes: { numero: opt.numero, id: opt.id, origem: "botao_manual" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition-transform hover:scale-105"
        title="Abrir o Cérebro LCR"
        aria-label="Abrir o Cérebro LCR"
      >
        <CerebroIcon className="h-7 w-7" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[560px] max-h-[80vh] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <span className="font-display text-base">Cérebro LCR</span>
        <div className="flex items-center gap-2">
          <Select
            value={persona}
            onValueChange={(v) => { setPersona(v as Persona); setPersonaTravada(true); }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mestre">Mestre</SelectItem>
              <SelectItem value="consultor">Consultor</SelectItem>
              <SelectItem value="cuidador">Cuidador</SelectItem>
              <SelectItem value="buddy">Buddy</SelectItem>
              <SelectItem value="reportar">Reportar</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {empresaId && (
        <div className="border-b border-border bg-primary/5 px-4 py-1.5 text-[11px] text-muted-foreground">
          Contexto: cliente em foco nesta tela
        </div>
      )}

      {msgs.filter((m) => m.autor === "user").length > 0 && persona !== "reportar" && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">
          <span>Isso é um bug ou melhoria?</span>
          <button onClick={salvarConversaComoOportunidade} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700">
            <Flag className="h-3 w-3" /> Registrar como oportunidade
          </button>
        </div>
      )}

      {oportunidadeAtiva && (
        <div className="border-b border-border bg-primary/5 px-4 py-1.5 text-[11px] text-primary">
          Editando <span className="font-mono font-semibold">{oportunidadeAtiva.numero}</span> — próximas mensagens enriquecem este registro
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{PERSONAS[persona].saudacao}</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.autor === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
              m.autor === "user"
                ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}>
              {m.autor === "user" ? m.texto : <Markdown className="space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4 [&_h2]:font-display [&_h2]:text-base [&_h2]:mt-1 [&_h3]:font-semibold [&_h3]:text-sm">{m.texto}</Markdown>}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground">{PERSONAS[persona].label} está pensando…</div>}
        <div ref={fimRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            rows={2}
            placeholder={persona === "reportar" ? "Descreva rapidamente: bug, melhoria ou dúvida" : `Pergunte ao ${PERSONAS[persona].label}…`}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="icon" disabled={busy || !pergunta.trim()} onClick={enviar} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

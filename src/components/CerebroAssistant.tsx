import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, LineChart, HeartHandshake, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Ícone do Cérebro: balão de conversa com play (no lugar do brilho).
function CerebroIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2.5c-5.25 0-9.5 3.86-9.5 8.62 0 2.64 1.3 4.99 3.34 6.57L5 21.5l3.86-1.48c.98.28 2.03.43 3.14.43 5.25 0 9.5-3.86 9.5-8.62S17.25 2.5 12 2.5Z" fill="currentColor" />
      <path d="M10 8.3l5.2 3-5.2 3V8.3Z" fill="var(--color-primary)" />
    </svg>
  );
}

type Persona = "mestre" | "consultor" | "cuidador";
type Msg = { autor: "user" | "ia"; texto: string };

const PERSONAS: Record<Persona, { label: string; fn: string; icon: typeof Brain; cor: string; saudacao: string }> = {
  mestre: { label: "Mestre", fn: "cerebro-mestre", icon: Brain, cor: "text-violet-600", saudacao: "Sou o Mestre. Pergunte sobre processos, padrões e procedimentos da LCR." },
  consultor: { label: "Consultor", fn: "cerebro-consultor", icon: LineChart, cor: "text-blue-600", saudacao: "Sou o Consultor. Posso analisar a saúde financeira e gerar insights do cliente." },
  cuidador: { label: "Cuidador", fn: "cerebro-cuidador", icon: HeartHandshake, cor: "text-rose-600", saudacao: "Sou o Cuidador. Cuido do relacionamento e do health score da carteira." },
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function personaDaRota(pathname: string): Persona {
  if (pathname.startsWith("/consultive")) return "consultor";
  if (pathname.startsWith("/cx")) return "cuidador";
  return "mestre";
}

export function CerebroAssistant() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [persona, setPersona] = useState<Persona>("mestre");
  const [personaTravada, setPersonaTravada] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  // empresa em contexto, quando a rota tem um id de empresa
  const empresaId = useMemo(() => {
    if (/^\/(consultive|cx|clientes)\//.test(pathname)) return pathname.match(UUID_RE)?.[0] ?? undefined;
    return undefined;
  }, [pathname]);

  // persona segue a tela, salvo override manual
  useEffect(() => {
    if (!personaTravada) setPersona(personaDaRota(pathname));
  }, [pathname, personaTravada]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function enviar() {
    const q = pergunta.trim();
    if (!q || busy) return;
    setPergunta("");
    setMsgs((m) => [...m, { autor: "user", texto: q }]);
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(PERSONAS[persona].fn, {
        body: { pergunta: q, empresa_id: empresaId },
      });
      if (error) throw error;
      const resp = (data as { ok?: boolean; resposta?: string; error?: string });
      setMsgs((m) => [...m, { autor: "ia", texto: resp?.resposta || resp?.error || "Sem resposta." }]);
    } catch (e) {
      setMsgs((m) => [...m, { autor: "ia", texto: `Não consegui responder agora: ${e instanceof Error ? e.message : "erro"}.` }]);
    } finally {
      setBusy(false);
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
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mestre">Mestre</SelectItem>
              <SelectItem value="consultor">Consultor</SelectItem>
              <SelectItem value="cuidador">Cuidador</SelectItem>
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

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{PERSONAS[persona].saudacao}</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.autor === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
              m.autor === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}>{m.texto}</div>
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
            placeholder={`Pergunte ao ${PERSONAS[persona].label}…`}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="icon" disabled={busy || !pergunta.trim()} onClick={enviar} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { Brain, Send, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mestre")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "knowledge", "/mestre"),
  head: () => ({ meta: [{ title: "Mestre · Cérebro LCR" }] }),
  component: MestrePage,
});

type Msg = { autor: "user" | "ia"; texto: string };

const SUGESTOES = [
  "Qual é o passo a passo da conciliação bancária na LCR?",
  "Quais documentos cada cliente precisa enviar para a contabilização?",
  "Como preencher a planilha de importação de lançamentos do SCI?",
  "Quais são as etapas até o fechamento do balancete?",
];

function MestrePage() {
  const [pergunta, setPergunta] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function enviar(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || busy) return;
    setPergunta("");
    setMsgs((m) => [...m, { autor: "user", texto: q }]);
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cerebro-mestre", { body: { pergunta: q } });
      if (error) throw error;
      const resp = data as { ok?: boolean; resposta?: string; error?: string };
      setMsgs((m) => [...m, { autor: "ia", texto: resp?.resposta || resp?.error || "Sem resposta." }]);
    } catch (e) {
      setMsgs((m) => [...m, { autor: "ia", texto: `Não consegui responder agora: ${e instanceof Error ? e.message : "erro"}.` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Mestre"
        emphasis="· Cérebro LCR"
        description="O Mestre conhece os processos, padrões e procedimentos da LCR. Pergunte sobre o fluxo contábil, regras e boas práticas."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
            <Brain className="h-4 w-4 text-violet-600" />
            <h3 className="font-display text-lg">Conversa com o Mestre</h3>
          </div>
          <CardContent className="p-0">
            <div className="flex h-[58vh] flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
                {msgs.length === 0 && (
                  <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    Sou o Mestre. Pergunte sobre processos, padrões e procedimentos da LCR — ou escolha uma sugestão ao lado.
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={m.autor === "user" ? "flex justify-end" : "flex justify-start"}>
                    {m.autor === "user" ? (
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">{m.texto}</div>
                    ) : (
                      <div className="max-w-[90%] rounded-2xl bg-muted px-4 py-2 text-sm text-foreground"><Markdown>{m.texto}</Markdown></div>
                    )}
                  </div>
                ))}
                {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Mestre está pensando…</div>}
                <div ref={fimRef} />
              </div>
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={pergunta}
                    onChange={(e) => setPergunta(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                    rows={2}
                    placeholder="Pergunte ao Mestre…"
                    className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button size="icon" disabled={busy || !pergunta.trim()} onClick={() => void enviar()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <div className="border-b border-border bg-muted/40 px-6 py-3"><h3 className="font-display text-lg">Perguntas frequentes</h3></div>
          <CardContent className="space-y-2 pt-4">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => void enviar(s)}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import { getDocumentoRevisao, aprovarDocumento, limparLancamentosDocumento } from "@/lib/lcr.functions";
import { DOC_TIPO_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, CheckCircle2, Sparkles, AlertTriangle, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/revisar/$documentoId")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "documentos", "/documentos"),
  head: () => ({ meta: [{ title: "Revisão de classificação — LCR" }] }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({ queryKey: ["doc-revisao", params.documentoId], queryFn: () => getDocumentoRevisao({ data: { id: params.documentoId } }) }),
  component: RevisaoDocumento,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Sugestao = {
  data_lancamento?: string; valor?: number; tipo_movimento?: string;
  conta_codigo?: string; historico_codigo?: string; descricao?: string; confidence?: number;
};
type Classificacao = {
  tipo_documento?: string; cliente_identificado?: string; competencia?: string;
  confidence_geral?: number; dados_extraidos?: unknown; observacoes?: string;
  lancamentos_sugeridos?: Sugestao[]; error?: string;
};

// Rota standalone: voltar + cabeçalho + a visão reutilizável.
function RevisaoDocumento() {
  const { documentoId } = Route.useParams();
  const { data: doc } = useSuspenseQuery({ queryKey: ["doc-revisao", documentoId], queryFn: () => getDocumentoRevisao({ data: { id: documentoId } }) });
  const empresa = (doc?.empresa as { razao_social?: string } | null);

  return (
    <>
      <Link to="/documentos" className="inline-flex items-center text-sm text-soft-foreground hover:text-primary mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" />Documentos
      </Link>
      <div className="mb-6">
        <h1 className="font-display text-3xl">{empresa?.razao_social ?? "Documento"}</h1>
      </div>
      <DocumentoRevisaoView documentoId={documentoId} />
    </>
  );
}

// Visão da Revisão (PDF + classificação da IA + lançamentos sugeridos), embutível
// em qualquer lugar (rota standalone ou aba do Painel do Cliente). Usa useQuery
// (não-suspense) para não exigir boundary externo.
export function DocumentoRevisaoView({ documentoId, onAprovado }: { documentoId: string; onAprovado?: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const key = ["doc-revisao", documentoId];
  const { data: doc, isLoading } = useQuery({ queryKey: key, queryFn: () => getDocumentoRevisao({ data: { id: documentoId } }) });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"aprovar" | "reclassificar" | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const storagePath = (doc as { storage_path?: string | null } | null)?.storage_path ?? (doc as { arquivo_url?: string | null } | null)?.arquivo_url ?? null;

  useEffect(() => {
    if (!storagePath) { setUrl(null); return; }
    let active = true;
    supabase.storage.from("documentos-clientes").createSignedUrl(storagePath, 600).then(({ data }) => {
      if (active) setUrl(data?.signedUrl ?? null);
    });
    return () => { active = false; };
  }, [storagePath]);

  async function aprovar() {
    setBusy("aprovar");
    try {
      await aprovarDocumento({ data: { id: documentoId } });
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      router.invalidate();
      toast.success("Documento aprovado — lançamentos confirmados.");
      onAprovado?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBusy(null); }
  }

  async function reclassificar() {
    setBusy("reclassificar");
    try {
      await limparLancamentosDocumento({ data: { documento_id: documentoId } });
      const { data: res, error } = await supabase.functions.invoke("processar-documento", { body: { documento_id: documentoId } });
      if (error) throw new Error(error.message);
      const r = res as { ok?: boolean; lancamentos_gerados?: number; error?: string } | null;
      if (!r?.ok) throw new Error(r?.error ?? "Falha ao reclassificar");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      router.invalidate();
      toast.success(`Reclassificado — ${r.lancamentos_gerados ?? 0} lançamento(s) gerado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBusy(null); setCooldown(60); }
  }

  if (isLoading) return <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</div>;
  if (!doc) return <div className="p-6 text-muted-foreground">Documento não encontrado.</div>;

  const classificacao = (doc.classificacao_ia ?? {}) as Classificacao;
  const sugestoes = classificacao.lancamentos_sugeridos ?? [];
  const dados = classificacao.dados_extraidos;
  const dadosTexto = typeof dados === "string" ? dados : dados ? JSON.stringify(dados, null, 2) : null;
  const revisado = doc.status_processamento === "revisado";
  const conf = typeof classificacao.confidence_geral === "number" ? classificacao.confidence_geral : null;
  const ext = (storagePath ?? "").split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isImg = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-soft-foreground">
          {DOC_TIPO_LABEL[doc.tipo as keyof typeof DOC_TIPO_LABEL] ?? doc.tipo} · Competência {formatCompetencia(doc.competencia)}
          {doc.arquivo_nome ? ` · ${doc.arquivo_nome}` : ""}
        </p>
        <StatusPill variant={revisado ? "now" : "next"}>{revisado ? "Revisado" : "Aguardando revisão"}</StatusPill>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Documento original */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
            <FileText className="h-4 w-4 text-primary" /><h3 className="font-display text-lg">Documento original</h3>
          </div>
          <CardContent className="p-0">
            {!url ? (
              <div className="flex h-[70vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</div>
            ) : isPdf ? (
              <iframe src={url} title="Documento" className="h-[70vh] w-full" />
            ) : isImg ? (
              <div className="max-h-[70vh] overflow-auto p-4"><img src={url} alt="Documento" className="mx-auto max-w-full" /></div>
            ) : (
              <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
                <p>Pré-visualização indisponível para .{ext}</p>
                <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noopener noreferrer">Abrir arquivo</a></Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Classificação da IA */}
        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-6 py-3">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-display text-lg">Classificação da IA</h3></div>
              {conf != null && (
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", conf < 0.7 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                  Confiança {Math.round(conf * 100)}%
                </span>
              )}
            </div>
            <CardContent className="space-y-3 pt-5 text-sm">
              {classificacao.error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" /> {classificacao.error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Tipo identificado" valor={classificacao.tipo_documento ?? "—"} />
                <Campo label="Competência" valor={classificacao.competencia ?? formatCompetencia(doc.competencia)} />
              </div>
              {dadosTexto && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Dados extraídos</div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs">{dadosTexto}</pre>
                </div>
              )}
              {classificacao.observacoes && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Observações</div>
                  <p className="text-sm text-foreground">{classificacao.observacoes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
              <h3 className="font-display text-lg">Lançamentos sugeridos</h3>
              <span className="text-xs text-muted-foreground">· {sugestoes.length}</span>
            </div>
            <CardContent className="p-0">
              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Data</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sugestoes.map((s, i) => {
                      const baixa = typeof s.confidence === "number" && s.confidence < 0.7;
                      return (
                        <TableRow key={i} className={cn(baixa && "bg-amber-50")}>
                          <TableCell className="text-xs">{s.data_lancamento ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{s.conta_codigo ?? "—"}</TableCell>
                          <TableCell className="max-w-[14rem] truncate text-sm" title={s.descricao ?? ""}>
                            {s.descricao}
                            {baixa && <span className="ml-1 text-[10px] text-amber-700">({Math.round((s.confidence ?? 0) * 100)}%)</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{typeof s.valor === "number" ? brl(s.valor) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                    {sugestoes.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum lançamento sugerido.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={aprovar} disabled={busy !== null}>
              {busy === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Aprovar e confirmar lançamentos
            </Button>
            <Button
              variant="outline"
              onClick={reclassificar}
              disabled={busy !== null || cooldown > 0}
              title={cooldown > 0 ? `Aguarde ${cooldown}s para evitar o limite da API` : undefined}
            >
              {busy === "reclassificar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              {cooldown > 0 ? `Reclassificar com IA (${cooldown}s)` : "Reclassificar com IA"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{valor}</div>
    </div>
  );
}

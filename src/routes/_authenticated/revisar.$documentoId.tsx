import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import { getDocumentoRevisao, aprovarDocumento, limparLancamentosDocumento, mudarTipoDocumento, desmarcarDuplicata } from "@/lib/lcr.functions";
import { DOC_TIPO_LABEL, formatCompetencia } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, ChevronRight, CheckCircle2, Sparkles, AlertTriangle, FileText, Loader2, GitCompare, ArrowRight, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

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
  regra_id?: string; justificativa?: string;
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
  const [busy, setBusy] = useState<"aprovar" | "reclassificar" | "desduplicar" | null>(null);
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

  async function mudarTipo(novo: string) {
    if (!doc || doc.tipo === novo) return;
    try {
      const res = await mudarTipoDocumento({ data: { id: documentoId, tipo: novo as "extrato" } });
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      await qc.invalidateQueries({ queryKey: ["conciliacao-detalhe"] });
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      router.invalidate();
      if (res.mudou && novo === "extrato") toast.success("Tipo alterado para extrato — vinculado à Conciliação bancária.");
      else if (res.mudou) toast.success(`Tipo alterado para ${DOC_TIPO_LABEL[novo as keyof typeof DOC_TIPO_LABEL]}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
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

  async function processarMesmoAssim() {
    setBusy("desduplicar");
    try {
      await desmarcarDuplicata({ data: { documento_id: documentoId } });
      const { data: res, error } = await supabase.functions.invoke("processar-documento", { body: { documento_id: documentoId } });
      if (error) throw new Error(error.message);
      const r = res as { ok?: boolean; lancamentos_gerados?: number; error?: string } | null;
      if (!r?.ok) throw new Error(r?.error ?? "Falha ao processar");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      router.invalidate();
      toast.success(`Processado como extrato próprio — ${r.lancamentos_gerados ?? 0} lançamento(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBusy(null); }
  }

  if (isLoading) return <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</div>;
  if (!doc) return <div className="p-6 text-muted-foreground">Documento não encontrado.</div>;

  const duplicataDe = (doc as { duplicata_de?: string | null }).duplicata_de ?? null;
  const dupOriginal = (doc as { duplicata_original?: { arquivo_nome?: string; competencia?: string } | null }).duplicata_original ?? null;

  const classificacao = (doc.classificacao_ia ?? {}) as Classificacao;
  const sugestoes = classificacao.lancamentos_sugeridos ?? [];
  const dados = classificacao.dados_extraidos;
  const dadosTexto = typeof dados === "string" ? dados : dados ? JSON.stringify(dados, null, 2) : null;
  const revisado = doc.status_processamento === "revisado";
  const conf = typeof classificacao.confidence_geral === "number" ? classificacao.confidence_geral : null;
  const ext = (storagePath ?? "").split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isImg = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
  const isSheet = ["csv", "xlsx", "xls"].includes(ext);
  const isExtrato = doc.tipo === "extrato";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-soft-foreground">
          {DOC_TIPO_LABEL[doc.tipo as keyof typeof DOC_TIPO_LABEL] ?? doc.tipo} · Competência {formatCompetencia(doc.competencia)}
          {doc.arquivo_nome ? ` · ${doc.arquivo_nome}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {duplicataDe && <StatusPill variant="back">Duplicata</StatusPill>}
          <StatusPill variant={revisado ? "now" : "next"}>{revisado ? "Revisado" : "Aguardando revisão"}</StatusPill>
        </div>
      </div>

      {duplicataDe && (
        <Card className="mb-5 border-amber-300 bg-amber-50/60">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <GitCompare className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Extrato duplicado — não gerou razão</p>
                <p className="text-amber-700">
                  Mesma conta/banco/mês de{" "}
                  <Link to="/revisar/$documentoId" params={{ documentoId: duplicataDe }} className="font-medium underline hover:text-amber-900">
                    {dupOriginal?.arquivo_nome ?? "outro extrato"}
                  </Link>
                  . Para evitar razão em dobro, este documento foi marcado como duplicata.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" disabled={busy !== null} onClick={processarMesmoAssim}>
              {busy === "desduplicar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Não é duplicata / processar mesmo assim
            </Button>
          </CardContent>
        </Card>
      )}

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
            ) : isSheet ? (
              <PlanilhaPreview url={url} ext={ext} />
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
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tipo do documento</div>
                  <Select value={doc.tipo} onValueChange={mudarTipo}>
                    <SelectTrigger className="mt-0.5 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["extrato", "nf_entrada", "nf_saida", "fatura_cartao", "recibo", "darf", "planilha_financeira", "movimento_contabil", "outros"] as const).map((t) => (
                        <SelectItem key={t} value={t}>{DOC_TIPO_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {classificacao.tipo_documento && classificacao.tipo_documento.toLowerCase() !== doc.tipo && (
                    <div className="mt-1 text-[10px] text-muted-foreground">IA sugeriu: {classificacao.tipo_documento}</div>
                  )}
                </div>
                <Campo label="Competência" valor={classificacao.competencia ?? formatCompetencia(doc.competencia)} />
              </div>
              {dadosTexto && (
                <details className="group rounded-lg border border-border bg-muted/40">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                    Dados extraídos
                    <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground/70 group-open:hidden">ver</span>
                    <span className="ml-auto hidden text-[10px] font-normal normal-case text-muted-foreground/70 group-open:inline">ocultar</span>
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border bg-card p-3 text-xs">{dadosTexto}</pre>
                </details>
              )}
              {classificacao.observacoes && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Observações</div>
                  <p className="text-sm text-foreground">{classificacao.observacoes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {isExtrato && sugestoes.length === 0 ? (
            // Extratos não geram lançamentos sugeridos — eles alimentam a
            // conciliação bancária. Mostra um card explicativo claro.
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><GitCompare className="h-5 w-5" /></span>
                  <div>
                    <h3 className="font-display text-lg leading-tight">Extrato vinculado à conciliação bancária</h3>
                    <p className="mt-1 text-sm text-soft-foreground">
                      Extratos bancários não geram lançamentos sugeridos aqui — eles entram diretamente como fonte de
                      comparação na <strong>Conciliação bancária</strong> da competência {formatCompetencia(doc.competencia)}.
                      Clique em <strong>"Conciliar agora"</strong> lá para casar com a razão.
                    </p>
                  </div>
                </div>
                {doc.empresa_id && (
                  <Button asChild className="w-full sm:w-auto">
                    <Link to="/conciliacao/$empresaId" params={{ empresaId: doc.empresa_id }}>
                      Abrir conciliação bancária <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
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
                        <TableHead className="w-16">Regra</TableHead>
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
                            <TableCell className="font-mono text-xs">{s.conta_codigo ?? "—"}{s.historico_codigo ? ` · h${s.historico_codigo}` : ""}</TableCell>
                            <TableCell className="text-xs" title={s.justificativa ?? undefined}>
                              {s.regra_id ? (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{s.regra_id}</span>
                              ) : "—"}
                              {s.justificativa && <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{s.justificativa}</div>}
                            </TableCell>
                            <TableCell className="max-w-[12rem] truncate text-sm" title={s.descricao ?? ""}>
                              {s.descricao}
                              {baixa && <span className="ml-1 text-[10px] text-amber-700">({Math.round((s.confidence ?? 0) * 100)}%)</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{typeof s.valor === "number" ? brl(s.valor) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                      {sugestoes.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Nenhum lançamento sugerido.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

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

// Pré-visualização de CSV/XLSX via biblioteca xlsx (suporta ambos formatos).
// Limita a 200 linhas para manter responsivo.
function PlanilhaPreview({ url, ext }: { url: string; ext: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);

  useEffect(() => {
    let active = true;
    setRows(null); setErr(null); setTruncado(false);
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (!active) return;
        try {
          // CSV: o SheetJS assume Windows-1252 p/ bytes crus sem BOM, então um CSV
          // UTF-8 (comum em export BR) vira mojibake ("ó" → "Ã³"). Decodifica o texto
          // explicitamente (UTF-8; se não for UTF-8 válido, cai p/ Windows-1252) e lê
          // como string. Binários (xlsx/xls) trazem o próprio encoding → lê como array.
          let wb;
          if (ext === "csv") {
            const bytes = new Uint8Array(buf);
            let texto: string;
            try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
            catch { texto = new TextDecoder("windows-1252").decode(bytes); }
            wb = XLSX.read(texto, { type: "string" });
          } else {
            wb = XLSX.read(buf, { type: "array" });
          }
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
          // Polimento de exibição (não altera o arquivo — "Baixar original" segue exato):
          // decimais longos de export de pivot (ex.: -17721.203333333335) viram formato
          // pt-BR de 2 casas; inteiros e anos ficam intactos (não thousand-separa 2023).
          const lim = data.slice(0, 200).map((r) => r.map((c) => {
            if (typeof c === "number" && Number.isFinite(c) && !Number.isInteger(c)) {
              return c.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            return String(c ?? "");
          }));
          setRows(lim);
          setTruncado(data.length > 200);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Falha ao ler planilha");
        }
      })
      .catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [url, ext]);

  if (err) {
    return (
      <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Não foi possível pré-visualizar a planilha: {err}</p>
        <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noopener noreferrer">Abrir arquivo</a></Button>
      </div>
    );
  }
  if (!rows) {
    return <div className="flex h-[40vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando planilha…</div>;
  }
  // "Unnamed: N" é artefato de export (colunas de pivot sem cabeçalho, via pandas) —
  // some do cabeçalho da prévia sem descartar a coluna (os dados dela seguem).
  const header = (rows[0] ?? []).map((h) => /^unnamed:\s*\d+$/i.test(h) ? "" : h);
  const body = rows.slice(1);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
        <span>Planilha .{ext} · {rows.length} linha(s){truncado ? " (primeiras 200)" : ""}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:underline">Baixar original</a>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur">
            <tr>
              {header.map((h, i) => <th key={i} className="border-b border-border px-2 py-1.5 text-left font-medium text-foreground">{h || `Col ${i + 1}`}</th>)}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr key={i} className={i % 2 ? "bg-muted/20" : ""}>
                {header.map((_, j) => <td key={j} className="border-b border-border/60 px-2 py-1 align-top">{row[j] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

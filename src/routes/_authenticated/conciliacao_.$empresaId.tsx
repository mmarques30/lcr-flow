import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/status-pill";
import { getConciliacaoDetalhe, ensureConciliacao, setConciliacaoExtratoCsv, listLancamentosConciliacao, conciliarParManual, editarLancamento } from "@/lib/lcr.functions";
import { formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, Upload, Download, CheckCircle2, Sparkles, Wand2, ListChecks, AlertTriangle, FileText, Link2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conciliacao_/$empresaId")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "conciliacao", "/conciliacao"),
  head: () => ({ meta: [{ title: "Conciliação cliente — LCR" }] }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({ queryKey: ["conciliacao-detalhe", params.empresaId], queryFn: () => getConciliacaoDetalhe({ data: { empresa_id: params.empresaId } }) }),
  component: ConciliacaoCliente,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Linha = { data: string | null; descricao: string; valor: number; id?: string };
type Resultado = {
  total_razao: number; total_extrato: number; conciliados_count: number;
  conciliados: { razao: Linha; extrato: Linha; fonte: string; motivo?: string }[];
  divergencias_razao: Linha[]; divergencias_extrato: Linha[];
} | null;

async function baixar(path: string) {
  const { data, error } = await supabase.storage.from("conciliacoes").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

// Rota standalone (continua acessível); reaproveita os mesmos blocos do Painel do Cliente.
function ConciliacaoCliente() {
  const { empresaId } = Route.useParams();
  const { data } = useSuspenseQuery({ queryKey: ["conciliacao-detalhe", empresaId], queryFn: () => getConciliacaoDetalhe({ data: { empresa_id: empresaId } }) });
  const competencia = data.competencia;

  return (
    <>
      <Link to="/conciliacao" className="inline-flex items-center text-sm text-soft-foreground hover:text-primary mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" />Conciliação
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{data.empresa.razao_social}</h1>
          <p className="mt-1 text-sm text-soft-foreground">Competência {formatCompetencia(competencia)}</p>
        </div>
      </div>

      <div className="mb-6">
        <RazaoContabil empresaId={empresaId} competencia={competencia} />
      </div>
      <ConciliacaoBancaria empresaId={empresaId} competencia={competencia} />
    </>
  );
}

type LancConc = {
  id: string; data_lancamento: string | null; valor: number | null; descricao: string | null;
  conciliado: boolean; confidence: number | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string } | null;
};

const precisaRevisao = (l: LancConc) => (l.confidence != null && l.confidence < 0.7) || !l.conta;
function statusLancamento(l: LancConc): { label: string; variant: Parameters<typeof StatusPill>[0]["variant"] } {
  if (l.conciliado) return { label: "Conciliado", variant: "now" };
  if (precisaRevisao(l)) return { label: "Aguardando revisão", variant: "back" };
  return { label: "Aprovado", variant: "next" };
}

// TAB "Razão contábil": lançamentos da IA da competência, com status por linha e
// "Revisar com IA". NÃO concilia aqui (a conciliação fica na aba/bloco de baixo).
export function RazaoContabil({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const key = ["lanc-conc", empresaId, competencia];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => listLancamentosConciliacao({ data: { empresa_id: empresaId, competencia } }) });
  const lancs = (data?.lancamentos ?? []) as LancConc[];
  const [soARevisar, setSoARevisar] = useState(false);

  const aRever = lancs.filter(precisaRevisao).length;
  const aprovados = lancs.filter((l) => !precisaRevisao(l)).length;
  const visiveis = soARevisar ? lancs.filter(precisaRevisao) : lancs;

  function revisarComIA() {
    if (lancs.length === 0) { toast.info("Nenhum lançamento nesta competência."); return; }
    if (aRever === 0) toast.success(`Revisão IA: os ${aprovados} lançamento(s) estão com conta sugerida e confiança alta. Nada a revisar. 🎉`);
    else toast.warning(`Revisão IA: ${aprovados} aprovado(s) automaticamente. ${aRever} precisam da sua revisão (confiança < 70% ou sem conta) — destacados em amarelo.`);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg">Razão contábil · lançamentos da competência</h3>
          <span className="text-xs text-muted-foreground">· {lancs.length} lançamento(s) · {aprovados} aprovado(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={soARevisar} onChange={(e) => setSoARevisar(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]" />
            Mostrar só a revisar
          </label>
          {aRever > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> {aRever} a revisar</span>}
          <Button variant="outline" size="sm" disabled={lancs.length === 0} onClick={revisarComIA} title="A IA valida os lançamentos com conta sugerida e confiança alta (≥70%) e destaca os que precisam de revisão.">
            <Sparkles className="mr-1 h-4 w-4" /> Revisar com IA
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="max-h-[28rem] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Data</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Histórico</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-40">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const alerta = precisaRevisao(l);
                const st = statusLancamento(l);
                return (
                  <TableRow key={l.id} className={cn(alerta && "bg-amber-50")}>
                    <TableCell className="text-sm">{l.data_lancamento ? new Date(l.data_lancamento).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-sm">
                      {l.conta ? <span className="font-mono text-xs">{l.conta.codigo}</span> : <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> sem conta</span>}
                      {l.conta && <div className="text-xs text-muted-foreground">{l.conta.descricao}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.historico?.codigo ?? "—"}</TableCell>
                    <TableCell className="max-w-[18rem] truncate text-sm" title={l.descricao ?? ""}>
                      {l.descricao}
                      {l.confidence != null && l.confidence < 0.7 && <span className="ml-1 text-[10px] text-amber-700">({Math.round(l.confidence * 100)}%)</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{l.valor == null ? "—" : brl(l.valor)}</TableCell>
                    <TableCell><StatusPill variant={st.variant}>{st.label}</StatusPill></TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && visiveis.length === 0 && lancs.length > 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nada a revisar — todos aprovados.</TableCell></TableRow>}
              {!isLoading && lancs.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum lançamento nesta competência. Processe um documento com IA para gerar lançamentos.</TableCell></TableRow>}
              {isLoading && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// TAB "Conciliação bancária": cruza os lançamentos (razão) com o extrato importado.
export function ConciliacaoBancaria({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const qc = useQueryClient();
  const key = ["conciliacao-detalhe", empresaId, competencia];
  const { data } = useQuery({ queryKey: key, queryFn: () => getConciliacaoDetalhe({ data: { empresa_id: empresaId, competencia } }) });
  const extratoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"extrato" | "conciliar" | null>(null);

  const conc = data?.conciliacao ?? null;
  const resultado = (conc?.resultado ?? null) as Resultado;
  const temExtrato = !!conc?.extrato_csv_url;

  async function enviarExtrato(file: File) {
    setBusy("extrato");
    try {
      const { id } = await ensureConciliacao({ data: { empresa_id: empresaId, competencia } });
      const safeName = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${empresaId}/${competencia}/extrato-${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from("conciliacoes").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      await setConciliacaoExtratoCsv({ data: { id, extrato_csv_url: path } });
      await qc.invalidateQueries({ queryKey: key });
      toast.success("Extrato importado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setBusy(null);
      if (extratoRef.current) extratoRef.current.value = "";
    }
  }

  async function conciliar() {
    if (!conc) return;
    setBusy("conciliar");
    try {
      const { data: res, error } = await supabase.functions.invoke("conciliar", { body: { conciliacao_id: conc.id } });
      if (error) throw new Error(error.message);
      if (res && res.ok === false) throw new Error(res.error ?? "Falha na conciliação");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["conciliacoes"] });
      toast.success(`Conciliação concluída — ${res.conciliados} conciliados, ${res.divergencias_count} divergência(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(null);
    }
  }

  // seleção para pareamento manual + edição de lançamento na divergência
  const [selRazao, setSelRazao] = useState<number | null>(null);
  const [selExtrato, setSelExtrato] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ id: string; data: string; valor: string; descricao: string } | null>(null);
  const [acting, setActing] = useState(false);

  async function conciliarManual() {
    if (!conc || selRazao === null || selExtrato === null) return;
    setActing(true);
    try {
      await conciliarParManual({ data: { conciliacao_id: conc.id, razao_idx: selRazao, extrato_idx: selExtrato } });
      setSelRazao(null); setSelExtrato(null);
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["conciliacoes"] });
      toast.success("Par conciliado manualmente.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setActing(false); }
  }

  async function salvarEdicao() {
    if (!edit) return;
    setActing(true);
    try {
      await editarLancamento({ data: { id: edit.id, data_lancamento: edit.data || undefined, valor: edit.valor ? Number(edit.valor.replace(",", ".")) : undefined, descricao: edit.descricao || undefined } });
      setEdit(null);
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      toast.success("Lançamento atualizado. Reconciliando…");
      await conciliar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setActing(false); }
  }

  return (
    <>
      <h2 className="mb-1 font-display text-xl">Conciliar com extrato bancário (CSV)</h2>
      <p className="mb-4 text-sm text-soft-foreground">A razão são os lançamentos aprovados (gerados pela IA). Importe o extrato bancário para cruzar automaticamente.</p>

      <input ref={extratoRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarExtrato(f); }} />
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-medium leading-tight">Extrato bancário</div>
              <div className="text-xs text-muted-foreground">{temExtrato ? "Arquivo importado" : "Nenhum arquivo importado ainda"}</div>
            </div>
            <StatusPill variant={temExtrato ? "now" : "next"}>{temExtrato ? "Importado" : "Pendente"}</StatusPill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy === "extrato"} onClick={() => extratoRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />{busy === "extrato" ? "Enviando..." : temExtrato ? "Substituir" : "Importar CSV"}
            </Button>
            {temExtrato && (
              <Button variant="ghost" size="sm" onClick={() => conc?.extrato_csv_url && baixar(conc.extrato_csv_url)}>
                <Download className="mr-1 h-4 w-4" />Baixar
              </Button>
            )}
            <Button disabled={!temExtrato || busy === "conciliar"} onClick={conciliar}>
              <Wand2 className="mr-1.5 h-4 w-4" />{busy === "conciliar" ? "Conciliando..." : "Conciliar agora"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="mb-6 text-xs text-muted-foreground">Cruza os lançamentos da razão com o extrato — por regras (valor + data ±3 dias) e, no que sobrar, por IA.</p>

      {!resultado ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {temExtrato ? "Pronto para conciliar — clique em “Conciliar agora”." : "Importe o extrato bancário em CSV para iniciar."}
        </CardContent></Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Mini label="Conciliados" value={resultado.conciliados_count} tone="ok" />
            <Mini label="Divergências (razão)" value={resultado.divergencias_razao.length} tone="warn" />
            <Mini label="Divergências (extrato)" value={resultado.divergencias_extrato.length} tone="warn" />
          </div>

          <Secao titulo="Conciliados" icon={<CheckCircle2 className="h-4 w-4 text-primary" />}>
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Razão</TableHead><TableHead>Extrato</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Fonte</TableHead></TableRow></TableHeader>
              <TableBody>
                {resultado.conciliados.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{c.extrato.data ?? c.razao.data ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.razao.descricao}</TableCell>
                    <TableCell className="text-sm">{c.extrato.descricao}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(Math.abs(c.extrato.valor))}</TableCell>
                    <TableCell>
                      {c.fonte === "ia"
                        ? <span className="inline-flex items-center gap-1 text-xs text-primary" title={c.motivo}><Sparkles className="h-3 w-3" />IA</span>
                        : <span className="text-xs text-muted-foreground">regra</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {resultado.conciliados.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum item conciliado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Secao>

          {(resultado.divergencias_razao.length > 0 || resultado.divergencias_extrato.length > 0) && (
            <Card className="border-amber-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-amber-50/60 px-6 py-3">
                <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><h3 className="font-display text-lg">Divergências — ajuste manual</h3></div>
                <Button size="sm" disabled={acting || selRazao === null || selExtrato === null} onClick={conciliarManual}>
                  <Link2 className="mr-1 h-4 w-4" /> Conciliar par selecionado
                </Button>
              </div>
              <CardContent className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
                <DivergCol
                  titulo="Na razão, sem par no extrato" linhas={resultado.divergencias_razao}
                  sel={selRazao} onSel={(i) => setSelRazao(selRazao === i ? null : i)}
                  onEdit={(l) => setEdit({ id: l.id ?? "", data: l.data ?? "", valor: String(l.valor ?? ""), descricao: l.descricao ?? "" })}
                />
                <DivergCol
                  titulo="No extrato, sem par na razão" linhas={resultado.divergencias_extrato}
                  sel={selExtrato} onSel={(i) => setSelExtrato(selExtrato === i ? null : i)}
                />
              </CardContent>
              <div className="px-6 pb-4 text-xs text-muted-foreground">
                Selecione uma linha de cada lado e clique em <strong>Conciliar par selecionado</strong> para casar manualmente. Ou edite o lançamento da razão (✏️) para corrigir valor/data e reconciliar automaticamente.
              </div>
            </Card>
          )}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl">Editar lançamento</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>Descrição</Label><Input value={edit.descricao} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Data (AAAA-MM-DD)</Label><Input value={edit.data} onChange={(e) => setEdit({ ...edit, data: e.target.value })} placeholder="2026-06-30" /></div>
                <div className="space-y-1.5"><Label>Valor</Label><Input value={edit.valor} onChange={(e) => setEdit({ ...edit, valor: e.target.value })} placeholder="1234.56" /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={acting || !edit?.id} onClick={salvarEdicao}>{acting ? "Salvando…" : "Salvar e reconciliar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Coluna de divergências com seleção (radio) e edição opcional do lançamento.
function DivergCol({ titulo, linhas, sel, onSel, onEdit }: {
  titulo: string; linhas: Linha[]; sel: number | null;
  onSel: (i: number) => void; onEdit?: (l: Linha) => void;
}) {
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <h4 className="font-display text-sm">{titulo}</h4>
        <span className="ml-auto text-xs text-muted-foreground">{linhas.length}</span>
      </div>
      <div className="max-h-72 divide-y divide-border overflow-y-auto">
        {linhas.map((l, i) => (
          <div key={i} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", sel === i && "bg-primary/10")}>
            <input type="radio" checked={sel === i} onChange={() => onSel(i)} className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]" />
            <button type="button" onClick={() => onSel(i)} className="flex-1 text-left">
              <div className="truncate" title={l.descricao}>{l.descricao}</div>
              <div className="text-xs text-muted-foreground">{l.data ?? "—"}</div>
            </button>
            <span className={cn("font-mono text-sm", l.valor < 0 ? "text-destructive" : "text-primary-hover")}>{brl(Math.abs(l.valor))}</span>
            {onEdit && l.id && (
              <button type="button" onClick={() => onEdit(l)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar lançamento">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {linhas.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">Sem divergências.</div>}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-2 font-display text-3xl ${tone === "warn" && value > 0 ? "text-destructive" : "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Secao({ titulo, icon, children }: { titulo: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-6 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
        {icon}<h3 className="font-display text-lg">{titulo}</h3>
      </div>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}


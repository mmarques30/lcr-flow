import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { StatusPill } from "@/components/status-pill";
import { getConciliacaoDetalhe, getEmpresa, listLancamentosConciliacao, editarLancamento, createLancamento, deleteLancamento, limparConciliacao, listPlanoContas, listHistoricosSci, listDocumentos, enriquecerExtrato, listDocsSuporte } from "@/lib/lcr.functions";
import { DOC_TIPO_LABEL } from "@/lib/format";
import { formatCompetencia } from "@/lib/format";
import { DocumentoErroHint } from "@/components/documento-erro-hint";
import { avisarPropagacao } from "@/lib/propagacao-toast";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, Download, CheckCircle2, Sparkles, Wand2, ListChecks, AlertTriangle, FileText, Link2, Pencil, ChevronsUpDown, Check, Plus, Trash2, ArrowUpFromLine, Info } from "lucide-react";
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

const FEBRABAN: Record<string, string> = {
  itau: "341", itaú: "341", bradesco: "237", brasil: "001", bb: "001", caixa: "104",
  santander: "033", inter: "077", sicoob: "756", sicredi: "748", nubank: "260",
};

function formatContaBancaria(contas: { banco: string | null; agencia: string | null; conta: string | null }[]): string | null {
  const c = contas[0];
  if (!c?.banco && !c?.conta) return null;
  const bancoLower = (c.banco ?? "").toLowerCase();
  const febr = Object.entries(FEBRABAN).find(([k]) => bancoLower.includes(k))?.[1];
  const agConta = [c.agencia, c.conta].filter(Boolean).join("-");
  if (febr && c.banco) return `${febr} - ${c.banco}${agConta ? ` ${agConta}` : ""}`;
  return [c.banco, agConta].filter(Boolean).join(" · ") || null;
}

function formatDataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

type Linha = { data: string | null; descricao: string; valor: number; id?: string };
type ResultadoSaldo = {
  saldo_inicial: number | null;
  saldo_final: number | null;
  movimentacao_liquida: number;
  saldo_calculado: number | null;
  delta: number | null;
  confere: boolean;
  motivo?: string;
};
type LancFaltante = { id: string; data: string | null; valor: number; descricao?: string | null };
type Faltantes = {
  extrato_sem_classificacao: Linha[];
  classificado_sem_extrato: LancFaltante[];
  faltantes_count: number;
};
// #132: pareamento D/C linha a linha removido (conciliados/divergencias_*).
// Motor v3 (docs/conciliacao-v3-spec.md): só saldo + faltantes.
type Resultado = {
  total_razao: number; total_extrato: number;
  // "lancamentos_ia": extrato foi enviado como PDF/XLS/imagem (sem CSV) — o
  // motor usou os lançamentos fonte_extrato=true (já extraídos pela IA) como
  // fonte do extrato. Nesse modo "classificado sem extrato" fica sempre 0.
  extrato_fonte?: "csv" | "lancamentos_ia";
  saldo?: ResultadoSaldo;
  faltantes?: Faltantes;
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
  fonte_extrato?: boolean | null;
  enriquecido?: boolean | null;
  participante?: string | null;
  part_deb?: string | null;
  part_cred?: string | null;
  part_aprendido?: boolean | null;
  documento_numero?: string | null;
  documento_suporte_id?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string } | null;
};

// Confiança mínima p/ um lançamento contar como revisado. Alinha com o motor
// (classifica <80% como "aguardando revisão"). Rafa/Cleiton pediram trava
// obrigatória: não deixar conciliar enquanto houver lançamento abaixo disso ou
// sem conta. Aprovar/reclassificar no front seta confidence=1 → sai da revisão.
const CONF_MIN_REVISAO = 0.8;
const precisaRevisao = (l: LancConc) => (l.confidence != null && l.confidence < CONF_MIN_REVISAO) || !l.conta;
function statusLancamento(l: LancConc): { label: string; variant: Parameters<typeof StatusPill>[0]["variant"] } {
  if (l.conciliado) return { label: "Conciliado", variant: "now" };
  if (precisaRevisao(l)) return { label: "Aguardando revisão", variant: "back" };
  return { label: "Aprovado", variant: "next" };
}

function statusExtrato(l: LancConc): { label: string; variant: Parameters<typeof StatusPill>[0]["variant"] } {
  if (precisaRevisao(l)) return { label: "Aguardando revisão", variant: "back" };
  if (l.enriquecido) return { label: "Com suporte", variant: "now" };
  if (l.fonte_extrato) return { label: "Aguardando revisão", variant: "back" };
  return { label: "Com suporte", variant: "now" };
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
    if (aRever === 0) toast.success(`Revisão IA: os ${aprovados} lançamento(s) estão com conta sugerida e confiança alta. Nada a revisar.`);
    else toast.warning(`Revisão IA: ${aprovados} aprovado(s) automaticamente. ${aRever} precisam da sua revisão (confiança < 80% ou sem conta) — destacados em amarelo.`);
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
          <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", aRever > 0 ? "bg-amber-100 font-medium text-amber-800 ring-1 ring-amber-300" : "text-muted-foreground")}>
            <input type="checkbox" checked={soARevisar} onChange={(e) => setSoARevisar(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]" />
            Filtrar apenas a revisar
          </label>
          {aRever > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> {aRever} a revisar</span>}
          <Button variant="outline" size="sm" disabled={lancs.length === 0} onClick={revisarComIA} title="A IA valida os lançamentos com conta sugerida e confiança alta (≥80%) e destaca os que precisam de revisão.">
            <Sparkles className="mr-1 h-4 w-4" /> Revisar com IA
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
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
                      {l.confidence != null && l.confidence < CONF_MIN_REVISAO && <span className="ml-1 text-[10px] text-amber-700">({Math.round(l.confidence * 100)}%)</span>}
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

// TAB "Conciliação bancária": revisão/edição humana de TODOS os registros
// extraídos pela IA (lançamentos aprovados + os que foram p/ revisão) e, abaixo,
// o cruzamento com o extrato bancário.
export function ConciliacaoBancaria({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const qc = useQueryClient();
  const key = ["conciliacao-detalhe", empresaId, competencia];
  const { data } = useQuery({ queryKey: key, queryFn: () => getConciliacaoDetalhe({ data: { empresa_id: empresaId, competencia } }) });
  const { data: empresaData } = useQuery({ queryKey: ["empresa", empresaId], queryFn: () => getEmpresa({ data: { id: empresaId } }), staleTime: 60_000 });
  const contaBancariaLabel = formatContaBancaria((empresaData?.contas_bancarias ?? []) as { banco: string | null; agencia: string | null; conta: string | null }[]);
  const [busy, setBusy] = useState<"analisar" | "finalizar" | null>(null);

  // Todos os lançamentos extraídos da competência (compartilha cache com a Razão).
  const lancKey = ["lanc-conc", empresaId, competencia];
  const { data: lancData, isLoading: lancLoading } = useQuery({ queryKey: lancKey, queryFn: () => listLancamentosConciliacao({ data: { empresa_id: empresaId, competencia } }) });
  const lancs = (lancData?.lancamentos ?? []) as LancConc[];
  const extratoLancs = lancs.filter((l) => l.fonte_extrato);
  const aRever = lancs.filter(precisaRevisao).length;
  const aprovados = lancs.length - aRever;
  // Sub-abas internas (v2): Lançamentos · Conciliação — divergências inline em Lançamentos.
  const [subtab, setSubtab] = useState<"lancamentos" | "conciliacao">("lancamentos");

  // Trava de revisão (Rafa/Cleiton): não deixar conciliar com pendência. O
  // filtro "só a revisar" + o scroll levam o usuário direto pra tabela editável.
  const [soARevisar, setSoARevisar] = useState(false);
  const tabelaRef = useRef<HTMLDivElement>(null);
  const divergenciasRef = useRef<HTMLDivElement>(null);
  function irParaRevisao() {
    setSubtab("lancamentos");
    setSoARevisar(true);
    setTimeout(() => tabelaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
  function scrollParaDivergencias() {
    setSubtab("lancamentos");
    setTimeout(() => divergenciasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
  const semSuporteExtrato = extratoLancs.filter((l) => !l.enriquecido).length;

  // Extratos bancários que a IA NÃO conseguiu processar nesta competência.
  // Só extrato conta aqui: docs contábeis (DARF, pro-labore, NFSe…) sem lançamento
  // pertencem à tela de Documentos, não à conciliação bancária.
  const { data: docsData } = useQuery({ queryKey: ["documentos"], queryFn: () => listDocumentos() });
  const docsErro = ((docsData ?? []) as { id: string; competencia: string | null; status_processamento: string | null; arquivo_nome: string | null; tipo: string | null; classificacao_ia?: unknown; empresa?: { id: string } | null }[])
    .filter((d) => d.empresa?.id === empresaId && d.competencia === competencia && d.status_processamento === "erro" && d.tipo === "extrato");

  const conc = data?.conciliacao ?? null;
  const resultado = (conc?.resultado ?? null) as Resultado;
  // "Sem match" = lançamentos classificado_sem_extrato (faltante #2 do motor de
  // saldo, saldo.ts): vieram do extrato (fonte_extrato=true) mas o CSV atual não
  // tem mais a linha correspondente (ex.: CSV reenviado sem aquele movimento).
  const idsSemMatch = new Set((resultado?.faltantes?.classificado_sem_extrato ?? []).map((f) => f.id));
  const [soSemMatch, setSoSemMatch] = useState(false);
  const semMatchCount = extratoLancs.filter((l) => idsSemMatch.has(l.id)).length;
  const visiveisLancs = extratoLancs
    .filter((l) => !soARevisar || precisaRevisao(l))
    .filter((l) => !soSemMatch || idsSemMatch.has(l.id));
  // Motor v3 (#132/#133 — pareamento D/C removido): saldo confere + faltantes = 0.
  const saldoConfere = resultado?.saldo?.confere === true;
  const faltantesCount = resultado?.faltantes?.faltantes_count ?? 0;
  const temExtrato = !!conc?.extrato_csv_url;
  const extratoInfo = (data as unknown as { extrato?: { id: string; arquivo_nome: string | null; recebido_em: string; saldo_inicial: number | null; saldo_final: number | null; movimentacao_debito?: number; movimentacao_credito?: number; movimentacao_liquida?: number } | null })?.extrato ?? null;
  const outrosLancs = (data as unknown as { outros_lancamentos?: number })?.outros_lancamentos ?? 0;

  async function invalidarAnaliseAposEdicao() {
    if (conc && resultado) {
      await limparConciliacao({ data: { conciliacao_id: conc.id } });
      await qc.invalidateQueries({ queryKey: key });
      toast.info("Re-analise as divergências após a alteração.");
    }
  }

  async function analisarDivergencias(): Promise<boolean> {
    if (!conc) return false;
    const fresh = qc.getQueryData<{ lancamentos: LancConc[] }>(lancKey);
    const pendentes = (fresh?.lancamentos ?? lancs).filter(precisaRevisao).length;
    if (pendentes > 0) {
      toast.error(`Existem ${pendentes} lançamento(s) pendentes de revisão. Revise antes de analisar.`);
      irParaRevisao();
      return false;
    }
    setBusy("analisar");
    try {
      const { data: res, error } = await supabase.functions.invoke("conciliar", { body: { conciliacao_id: conc.id, modo: "analisar" } });
      if (error) throw new Error(error.message);
      if (res && res.ok === false) throw new Error(res.error ?? "Falha na análise");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["conciliacoes"] });
      const divs = res.divergencias_count ?? 0;
      if (divs > 0) {
        toast.warning(`Análise concluída — ${divs} divergência(s) encontrada(s). Arrume antes de conciliar.`);
        scrollParaDivergencias();
      } else {
        toast.success(`Análise concluída — valores conferem. Clique em Conciliar para finalizar.`);
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function finalizarConciliacao(): Promise<boolean> {
    if (!conc) return false;
    const fresh = qc.getQueryData<{ lancamentos: LancConc[] }>(lancKey);
    const pendentes = (fresh?.lancamentos ?? lancs).filter(precisaRevisao).length;
    if (pendentes > 0) {
      toast.error(`Existem ${pendentes} lançamento(s) pendentes de revisão.`);
      irParaRevisao();
      return false;
    }
    if (!resultado) {
      toast.error("Analise as divergências antes de conciliar.");
      return false;
    }
    if (!saldoConfere) {
      toast.error(resultado.saldo?.motivo ?? "Saldo não confere. Verifique o extrato antes de conciliar.");
      scrollParaDivergencias();
      return false;
    }
    if (faltantesCount > 0) {
      toast.error(`Existem ${faltantesCount} transação(ões) faltante(s). Resolva antes de conciliar.`);
      scrollParaDivergencias();
      return false;
    }
    setBusy("finalizar");
    try {
      const { data: res, error } = await supabase.functions.invoke("conciliar", { body: { conciliacao_id: conc.id, modo: "finalizar" } });
      if (error) throw new Error(error.message);
      if (res && res.ok === false) throw new Error(res.error ?? "Falha na conciliação");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["conciliacoes"] });
      toast.success(`Conciliação finalizada — ${res.conciliados} conciliado(s).`);
      setSubtab("conciliacao");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      return false;
    } finally {
      setBusy(null);
    }
  }

  // edição/inclusão de lançamento (o pareamento manual razão×extrato foi
  // substituído pelo motor de saldo + faltantes — #131/#132)
  const [edit, setEdit] = useState<{ id: string; data: string; valor: string; descricao: string; conta_codigo: string; historico_codigo: string; part_deb: string; part_cred: string } | null>(null);
  const [novo, setNovo] = useState<{ data: string; valor: string; descricao: string; conta_codigo: string } | null>(null);
  const [acting, setActing] = useState(false);

  function abrirEdicao(l: LancConc) {
    setEdit({
      id: l.id,
      data: l.data_lancamento ? l.data_lancamento.slice(0, 10) : "",
      valor: l.valor != null ? String(Math.abs(l.valor)) : "",
      descricao: l.descricao ?? "",
      conta_codigo: l.conta?.codigo ?? "",
      historico_codigo: l.historico?.codigo ?? "",
      part_deb: l.part_deb ?? "",
      part_cred: l.part_cred ?? "",
    });
  }

  function abrirNovo(descPrefill?: string, valorPrefill?: number, dataPrefill?: string) {
    setNovo({
      data: dataPrefill ?? new Date().toISOString().slice(0, 10),
      valor: valorPrefill != null ? String(Math.abs(valorPrefill)) : "",
      descricao: descPrefill ?? "",
      conta_codigo: "",
    });
  }

  async function salvarNovo() {
    if (!novo) return;
    if (!novo.valor) { toast.error("Informe o valor."); return; }
    setActing(true);
    try {
      await createLancamento({ data: {
        empresa_id: empresaId,
        competencia,
        data_lancamento: novo.data || undefined,
        valor: Number(novo.valor.replace(",", ".")),
        descricao: novo.descricao || undefined,
        conta_codigo: novo.conta_codigo || undefined,
      } });
      setNovo(null);
      await qc.invalidateQueries({ queryKey: lancKey });
      await invalidarAnaliseAposEdicao();
      toast.success("Lançamento incluído.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setActing(false); }
  }

  async function excluirLancamento(id: string, descricao?: string | null) {
    if (!confirm(`Excluir o lançamento "${descricao ?? id}"? Esta ação não pode ser desfeita.`)) return;
    setActing(true);
    try {
      await deleteLancamento({ data: { id } });
      await qc.invalidateQueries({ queryKey: lancKey });
      await invalidarAnaliseAposEdicao();
      toast.success("Lançamento excluído.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setActing(false); }
  }

  function editarFaltante(id: string) {
    const l = lancs.find((x) => x.id === id);
    if (l) abrirEdicao(l);
  }

  async function salvarEdicao() {
    if (!edit) return;
    setActing(true);
    try {
      const resultado = await editarLancamento({ data: {
        id: edit.id,
        data_lancamento: edit.data || undefined,
        valor: edit.valor ? Number(edit.valor.replace(",", ".")) : undefined,
        descricao: edit.descricao || undefined,
        conta_codigo: edit.conta_codigo || undefined,
        historico_codigo: edit.historico_codigo || undefined,
        part_deb: edit.part_deb.trim() || null,
        part_cred: edit.part_cred.trim() || null,
      } });
      setEdit(null);
      await qc.invalidateQueries({ queryKey: ["lanc-conc"] });
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      await invalidarAnaliseAposEdicao();
      avisarPropagacao(resultado, "Lançamento atualizado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setActing(false); }
  }

  // Três travas (#133 — docs/conciliacao-v3-spec.md): Analisar exige revisão
  // zerada + extrato presente; Conciliar exige revisão zerada + saldo confere +
  // faltantes = 0 + análise feita. Pareamento D/C removido em #132 (não trava).
  const podeAnalisar = temExtrato && aRever === 0 && !busy;
  const podeFinalizar = temExtrato && aRever === 0 && !!resultado && saldoConfere && faltantesCount === 0 && !busy;

  return (
    <>
      <Tabs value={subtab} onValueChange={(v) => setSubtab(v as typeof subtab)}>
        <TabsList className="mb-1 h-auto w-full justify-start gap-8 rounded-none bg-transparent p-0 shadow-none">
          <TabsTrigger
            value="lancamentos"
            className="inline-flex items-center gap-2 rounded-none border-0 bg-transparent px-0 py-2 text-sm font-semibold text-muted-foreground shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full bg-primary", subtab !== "lancamentos" && "opacity-0")} aria-hidden />
            Lançamentos
          </TabsTrigger>
          <TabsTrigger
            value="conciliacao"
            className="inline-flex items-center gap-2 rounded-none border-0 bg-transparent px-0 py-2 text-sm font-semibold text-muted-foreground shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full bg-primary", subtab !== "conciliacao" && "opacity-0")} aria-hidden />
            Conciliação
          </TabsTrigger>
        </TabsList>

        {/* ─────────── Aba Lançamentos: cards + tabela do extrato + docs suporte ─────────── */}
        <TabsContent value="lancamentos" className="mt-4">
      {/* Aviso: extrato real não chegou via Gestta */}
      {!temExtrato && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-medium">Extrato bancário ainda não chegou</div>
            <p className="text-xs text-amber-800 mt-0.5">
              A conciliação precisa do <strong>extrato da conta corrente</strong> (saldo inicial → movimentações → saldo final).
              Comprovantes avulsos, transferências e posição de investimentos <strong>não</strong> substituem o extrato.
              Verifique no Gestta se ele já foi enviado pelo cliente — ou anexe manualmente em <strong>Documentos</strong> (tipo: Extrato bancário).
            </p>
          </div>
        </div>
      )}

      {/* Contador de revisão + trava obrigatória (Rafa/Cleiton): não deixa
          conciliar enquanto houver lançamento pendente de revisão. */}
      {lancs.length > 0 && (
        <div className={cn("mb-4 rounded-2xl border px-5 py-3", aRever > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {aRever > 0 ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              <span className={cn("font-medium", aRever > 0 ? "text-amber-800" : "text-emerald-800")}>
                {aprovados} aprovado{aprovados === 1 ? "" : "s"} · {aRever} aguardando revisão
              </span>
            </div>
            {aRever > 0 && (
              <Button variant="outline" size="sm" onClick={irParaRevisao} className="border-amber-400 text-amber-800 hover:bg-amber-100">
                Ir para lista de revisão
              </Button>
            )}
          </div>
          {aRever > 0 && (
            <p className="mt-1.5 text-sm text-amber-700">
              A conciliação fica bloqueada até você revisar (aprovar ou reclassificar) todos os lançamentos pendentes.
            </p>
          )}
        </div>
      )}

      {/* KPI strip: extrato + movimentado + outros lançamentos (3 cards) */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-2xl border-0 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
              <StatusPill variant={temExtrato ? "now" : "next"}>{temExtrato ? "Disponível" : "Pendente"}</StatusPill>
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">Extrato bancário</div>
            <div className="font-display text-lg leading-tight truncate" title={extratoInfo?.arquivo_nome ?? ""}>
              {temExtrato ? (extratoInfo?.arquivo_nome ?? "Extrato vinculado") : "Aguardando extração"}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {temExtrato ? "Extraído via Gestta" : "Quando chegar, a análise libera"}
            </div>
            {temExtrato && conc?.extrato_csv_url && (
              <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-[11px]" onClick={() => baixar(conc.extrato_csv_url!)}>
                <Download className="mr-1 h-3 w-3" />Baixar
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-soft">
          <CardContent className="p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ArrowUpFromLine className="h-4 w-4" />
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">Movimentado no mês</div>
            <div className="font-display text-2xl leading-tight">
              {extratoInfo?.movimentacao_liquida != null && extratoInfo.movimentacao_liquida !== 0
                ? <span className={extratoInfo.movimentacao_liquida >= 0 ? "text-emerald-600" : "text-rose-600"}>{extratoInfo.movimentacao_liquida >= 0 ? "+" : ""}{brl(extratoInfo.movimentacao_liquida)}</span>
                : <span className="text-muted-foreground text-lg">—</span>}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {extratoInfo != null
                ? `↑ ${brl(extratoInfo.movimentacao_credito ?? 0)} · ↓ ${brl(extratoInfo.movimentacao_debito ?? 0)}`
                : "Sem extrato"}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ListChecks className="h-4 w-4" />
              </div>
              <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                <Button size="sm" disabled={!podeAnalisar} onClick={analisarDivergencias} className="h-8 rounded-full"
                  title={aRever > 0 ? `${aRever} lançamento(s) pendentes de revisão` : (!temExtrato ? "Aguardando o extrato" : "Cruzar razão × extrato")}>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />{busy === "analisar" ? "Analisando…" : "Analisar divergências"}
                </Button>
                <Button
                  size="sm"
                  variant={podeFinalizar ? "default" : "secondary"}
                  disabled={!podeFinalizar}
                  onClick={finalizarConciliacao}
                  className={cn("h-8 rounded-full", !podeFinalizar && "bg-muted text-muted-foreground hover:bg-muted")}
                  title={
                    aRever > 0 ? `${aRever} lançamento(s) pendentes de revisão`
                      : !resultado ? "Analise as divergências primeiro"
                      : !saldoConfere ? (resultado.saldo?.motivo ?? "Saldo não confere")
                      : faltantesCount > 0 ? `${faltantesCount} transação(ões) faltante(s) pendente(s)`
                      : "Finalizar conciliação"
                  }
                >
                  <Wand2 className="mr-1 h-3.5 w-3.5" />{busy === "finalizar" ? "Conciliando…" : "Conciliar"}
                </Button>
              </div>
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">Outros lançamentos</div>
            <div className="font-display text-2xl leading-tight">{outrosLancs.toLocaleString("pt-BR")}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">Manuais, NFs e recibos fora do extrato</div>
          </CardContent>
        </Card>
      </div>

      {/* Aviso: extratos que a IA não conseguiu processar — travam a conciliação */}
      {docsErro.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{docsErro.length} extrato(s) bancário(s) com falha de processamento</span>
          </div>
          <p className="mt-1 text-sm text-amber-700">
            A IA não conseguiu extrair os lançamentos — a conciliação fica travada até tratar manualmente na aba <strong>Documentos</strong>:
          </p>
          <ul className="mt-2 space-y-2 text-sm text-amber-800">
            {docsErro.map((d) => (
              <li key={d.id} className="rounded-lg border border-amber-200 bg-white/60 px-3 py-2">
                <div className="font-mono text-xs">{d.arquivo_nome ?? d.tipo ?? d.id}</div>
                <DocumentoErroHint classificacao_ia={d.classificacao_ia} compact className="mt-1" />
                <Link to="/revisar/$documentoId" params={{ documentoId: d.id }} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                  Ver detalhes →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lançamentos do extrato — apenas linhas originadas do extrato bancário */}
      <Card className="mb-6" ref={tabelaRef}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">Lançamentos do extrato</h3>
            <span className="text-xs text-muted-foreground">
              · {visiveisLancs.length}{visiveisLancs.length !== extratoLancs.length ? ` de ${extratoLancs.length}` : ""} linha(s)
              {soARevisar ? " · filtrando revisão" : ""}{soSemMatch ? " · filtrando sem match" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {semMatchCount > 0 && (
              <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", soSemMatch ? "bg-rose-100 font-medium text-rose-800 ring-1 ring-rose-300" : "text-muted-foreground")} title="Lançamentos que vieram do extrato mas o CSV atual não tem mais a linha correspondente (ex.: CSV reenviado sem esse movimento)">
                <input type="checkbox" checked={soSemMatch} onChange={(e) => setSoSemMatch(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]" />
                Só sem match ({semMatchCount})
              </label>
            )}
            {(soARevisar || soSemMatch) && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSoARevisar(false); setSoSemMatch(false); }}>Ver todos</Button>
            )}
            {semSuporteExtrato > 0 && (
            <Button size="sm" variant="outline" disabled={acting} className="h-8" onClick={async () => {
              setActing(true);
              try {
                const res = await enriquecerExtrato({ data: { empresa_id: empresaId, competencia, force: true } });
                await qc.invalidateQueries({ queryKey: lancKey });
                toast.success(`Enriquecimento: ${res.enriquecidos} casados / ${res.sem_suporte} sem suporte.`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro");
              } finally { setActing(false); }
            }}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />Enriquecer ({semSuporteExtrato})
            </Button>
            )}
          </div>
        </div>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Data</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Participante / NF</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveisLancs.map((l) => {
                  const alerta = precisaRevisao(l);
                  const semSuporte = !l.enriquecido;
                  const statusInfo = semSuporte
                    ? { label: "Sem documento suporte", variant: "back" as const }
                    : l.enriquecido
                      ? { label: "Com suporte", variant: "now" as const }
                      : statusExtrato(l);
                  // Sinal/cor pela natureza real do movimento — não pelo sinal de l.valor,
                  // que o sistema sempre persiste absoluto (ver nota em sci-xls.ts). Sem
                  // natureza conhecida (lançamento manual/legado) fica neutro: não dá pra
                  // saber se é entrada ou saída, então não assume nenhum dos dois.
                  const natureza = (l.natureza_movimento ?? "").toLowerCase();
                  const valorPositivo = natureza.startsWith("c"); // creditou o banco → entrada
                  const valorNegativo = natureza.startsWith("d"); // debitou o banco → saída
                  return (
                    <TableRow key={l.id} className={cn(alerta && "bg-amber-50", semSuporte && "bg-amber-50/60")}>
                      <TableCell className="text-sm">{formatDataBR(l.data_lancamento)}</TableCell>
                      <TableCell className="text-sm">
                        {contaBancariaLabel ?? (l.conta ? (
                          <>
                            <span className="font-mono text-xs">{l.conta.codigo}</span>
                            <div className="text-xs text-muted-foreground">{l.conta.descricao}</div>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> sem conta</span>
                        ))}
                      </TableCell>
                      <TableCell className="max-w-[18rem] truncate text-sm" title={l.descricao ?? ""}>
                        {l.descricao}
                        {l.confidence != null && l.confidence < CONF_MIN_REVISAO && (
                          <span className="ml-1 text-[10px] text-amber-700">({Math.round(l.confidence * 100)}%)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const p = l.part_deb || l.part_cred || l.participante;
                          return p ? (
                            <div className="flex items-center gap-1 max-w-[12rem]">
                              <span className="truncate font-medium text-foreground" title={p}>{p}</span>
                              {l.part_aprendido && (
                                <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-700" title="Preenchido pelo aprendizado de participante — confira e edite se necessário">aprendido</span>
                              )}
                            </div>
                          ) : <span className="text-muted-foreground">—</span>;
                        })()}
                        {l.documento_numero ? <div className="font-mono text-[10px] text-muted-foreground">NF {l.documento_numero}</div> : null}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm", valorPositivo && "text-emerald-600", valorNegativo && "text-rose-600")}>
                        {l.valor == null ? "—" : <>{valorPositivo ? "+" : valorNegativo ? "-" : ""}{brl(l.valor)}</>}
                      </TableCell>
                      <TableCell><StatusPill variant={statusInfo.variant}>{statusInfo.label}</StatusPill></TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <button type="button" onClick={() => abrirEdicao(l)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar / classificar">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" disabled={acting} onClick={() => excluirLancamento(l.id, l.descricao)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" title="Excluir lançamento">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!lancLoading && soSemMatch && visiveisLancs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-emerald-700">Nenhum lançamento sem match — todos têm linha correspondente no extrato atual.</TableCell></TableRow>
                )}
                {!lancLoading && !soSemMatch && soARevisar && extratoLancs.length > 0 && visiveisLancs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-emerald-700">Nada a revisar no extrato — pode analisar divergências.</TableCell></TableRow>
                )}
                {!lancLoading && extratoLancs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma linha do extrato nesta competência. Quando o extrato for processado, as movimentações aparecem aqui.</TableCell></TableRow>
                )}
                {lancLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Saldo + faltantes (motor v3) — sempre visível quando há extrato */}
      <div ref={divergenciasRef} className="mb-6">
        {resultado?.saldo?.confere && (resultado?.faltantes?.faltantes_count ?? 0) === 0 && conc?.status !== "concluida" && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Saldo confere e não há transações faltantes — pronto para conciliar</span>
            </div>
          </div>
        )}
        {temExtrato && (
          <SaldoFaltantesPanel
            saldo={resultado?.saldo}
            faltantes={resultado?.faltantes}
            analisado={!!resultado}
            revisaoPendente={aRever > 0}
            acting={acting}
            extratoFonte={resultado?.extrato_fonte}
            onClassificar={(l) => abrirNovo(l.descricao, l.valor, l.data ?? undefined)}
            onEditar={editarFaltante}
            onExcluir={(id) => excluirLancamento(id, lancs.find((x) => x.id === id)?.descricao)}
          />
        )}
        {resultado && conc?.status === "concluida" && (
          <p className="mt-2 text-center text-sm text-emerald-700">Conciliação finalizada — nenhuma pendência.</p>
        )}
      </div>

      {/* Documentos suporte recebidos — sinalização de falta de suporte (A) fica aqui, não vira sub-aba */}
      <DocsSuporteCard empresaId={empresaId} competencia={competencia} />
        </TabsContent>

        {/* ─────────── Aba Conciliação: ação de conciliar + o que foi conciliado ─────────── */}
        <TabsContent value="conciliacao" className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl">Resultado da conciliação</h2>
            <Button
              variant="outline"
              size="sm"
              disabled={acting || !resultado || !conc}
              title={!resultado || !conc ? "Rode a conciliação primeiro" : "Limpar resultado"}
              onClick={async () => {
                if (!conc) return;
                if (!confirm("Limpar o resultado da conciliação? Os lançamentos voltam ao estado “não conciliados” para você rodar de novo.")) return;
                setActing(true);
                try {
                  await limparConciliacao({ data: { conciliacao_id: conc.id } });
                  await qc.invalidateQueries({ queryKey: key });
                  await qc.invalidateQueries({ queryKey: lancKey });
                  toast.success("Resultado da conciliação limpo.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Erro");
                } finally { setActing(false); }
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Limpar resultado
            </Button>
          </div>

          {!resultado ? (
            <Card><CardContent className="py-10 text-center">
              {!temExtrato ? (
                <span className="text-muted-foreground">Aguardando a extração do extrato no Gestta.</span>
              ) : aRever > 0 ? (
                <div className="space-y-3">
                  <p className="text-amber-800">{aRever} lançamento(s) pendentes de revisão. Revise antes de analisar.</p>
                  <Button variant="outline" onClick={irParaRevisao} className="border-amber-400 text-amber-800 hover:bg-amber-100">Ir para revisão</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-muted-foreground">Analise as divergências na aba Lançamentos antes de ver o resultado aqui.</p>
                  <Button variant="outline" onClick={() => { setSubtab("lancamentos"); void analisarDivergencias(); }}>
                    <Sparkles className="mr-1 h-4 w-4" />Analisar divergências
                  </Button>
                </div>
              )}
            </CardContent></Card>
          ) : conc?.status !== "concluida" ? (
            <Card><CardContent className="py-10 text-center space-y-3">
              <p className="text-muted-foreground">
                {!saldoConfere
                  ? (resultado.saldo?.motivo ?? "Saldo não confere") + " — resolva na aba Lançamentos e clique em Conciliar."
                  : faltantesCount > 0
                    ? `${faltantesCount} transação(ões) faltante(s) — resolva na aba Lançamentos e clique em Conciliar.`
                    : "Análise concluída — clique em Conciliar na aba Lançamentos para finalizar."}
              </p>
              <Button variant="outline" onClick={() => setSubtab("lancamentos")}>Ir para Lançamentos</Button>
            </CardContent></Card>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SaldoMini label="Saldo inicial" value={resultado.saldo?.saldo_inicial ?? null} />
                <SaldoMini label="Saldo final" value={resultado.saldo?.saldo_final ?? null} />
                <SaldoMini label="Movimentação (D/C)" value={resultado.saldo?.movimentacao_liquida ?? null} signed />
                <DeltaMini saldo={resultado.saldo} analisado={true} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                <div className="flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium">Conciliação finalizada — saldo confere e nenhuma transação faltante.</span>
                </div>
                <span className="text-xs text-emerald-700">{resultado.total_razao} lançamento(s) na razão · {resultado.total_extrato} linha(s) no extrato</span>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!novo} onOpenChange={(o) => !o && setNovo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl">Adicionar lançamento manual</DialogTitle></DialogHeader>
          {novo && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>Conta contábil</Label><ContaCombobox value={novo.conta_codigo} onChange={(codigo) => setNovo({ ...novo, conta_codigo: codigo })} /></div>
              <div className="space-y-1.5"><Label>Descrição</Label><Input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} placeholder="Ex: Pagto fornecedor X" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Data (AAAA-MM-DD)</Label><Input value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} placeholder="2026-06-30" /></div>
                <div className="space-y-1.5"><Label>Valor</Label><Input value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} placeholder="1234.56" /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use para lançamentos que <strong>não vieram via documento processado</strong> — fluxo de caixa,
                ajustes contábeis pontuais, adições do contador. Entra como <strong>validado</strong> na competência {formatCompetencia(competencia)}.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(null)}>Cancelar</Button>
            <Button disabled={acting} onClick={salvarNovo}>{acting ? "Salvando…" : "Incluir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl">Editar lançamento</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Conta contábil</Label><ContaCombobox value={edit.conta_codigo} onChange={(codigo) => setEdit({ ...edit, conta_codigo: codigo })} /></div>
                <div className="space-y-1.5"><Label>Histórico contábil</Label><HistoricoCombobox value={edit.historico_codigo} onChange={(codigo) => setEdit({ ...edit, historico_codigo: codigo })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Descrição</Label><Input value={edit.descricao} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Data (AAAA-MM-DD)</Label><Input value={edit.data} onChange={(e) => setEdit({ ...edit, data: e.target.value })} placeholder="2026-06-30" /></div>
                <div className="space-y-1.5"><Label>Valor</Label><Input value={edit.valor} onChange={(e) => setEdit({ ...edit, valor: e.target.value })} placeholder="1234.56" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Participante (débito)</Label><Input value={edit.part_deb} onChange={(e) => setEdit({ ...edit, part_deb: e.target.value })} placeholder="Ex: Andressa Silva" /></div>
                <div className="space-y-1.5"><Label>Participante (crédito)</Label><Input value={edit.part_cred} onChange={(e) => setEdit({ ...edit, part_cred: e.target.value })} placeholder="Ex: Andressa Silva" /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Participante em branco é normal — só contas que exigem preenchem. Ao preencher, o sistema
                <strong> aprende por cliente</strong>: transações futuras com a mesma descrição são autopreenchidas.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={acting || !edit?.id} onClick={salvarEdicao}>{acting ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Painel v3 (motor de saldo + faltantes) — substitui o pareamento manual D/C.
// KPIs de saldo inicial/final/movimentação/delta com badge confere/não confere,
// e as duas listas de faltantes: extrato sem classificação, classificado sem extrato.
function SaldoFaltantesPanel({ saldo, faltantes, analisado, revisaoPendente, acting, extratoFonte, onClassificar, onEditar, onExcluir }: {
  saldo?: ResultadoSaldo;
  faltantes?: Faltantes;
  analisado: boolean;
  revisaoPendente: boolean;
  acting: boolean;
  extratoFonte?: "csv" | "lancamentos_ia";
  onClassificar: (l: Linha) => void;
  onEditar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const extratoSemClassificacao = faltantes?.extrato_sem_classificacao ?? [];
  const classificadoSemExtrato = faltantes?.classificado_sem_extrato ?? [];
  const faltantesCount = faltantes?.faltantes_count ?? 0;
  const emptyHint = revisaoPendente
    ? "Revise todos os lançamentos pendentes antes de analisar."
    : !analisado
      ? "Clique em Analisar divergências para calcular o saldo e cruzar razão × extrato."
      : "Nenhuma pendência — tudo classificado e coberto pelo extrato.";

  return (
    <div className="space-y-4">
      {analisado && extratoFonte === "lancamentos_ia" && (
        <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <span>O extrato desta competência foi enviado como PDF/imagem (sem CSV) — o saldo e as faltantes usam os lançamentos já extraídos pela IA. "Classificado sem extrato" não se aplica nesse modo (sem uma segunda fonte independente pra comparar).</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SaldoMini label="Saldo inicial" value={saldo?.saldo_inicial ?? null} />
        <SaldoMini label="Saldo final (informado)" value={saldo?.saldo_final ?? null} />
        <SaldoMini label="Movimentação (D/C)" value={analisado ? (saldo?.movimentacao_liquida ?? 0) : null} signed />
        <DeltaMini saldo={saldo} analisado={analisado} />
      </div>

      {analisado && saldo && !saldo.confere && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span>{saldo.motivo ?? "Saldo inicial + movimentação não bate com o saldo final informado."}</span>
        </div>
      )}

      <Card className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-[#fff8f0] shadow-none">
        <div className="border-b border-amber-200/80 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <h3 className="font-display text-lg leading-tight text-amber-950">Transações faltantes</h3>
            {analisado && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">{faltantesCount} {faltantesCount === 1 ? "item" : "itens"}</span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-amber-900/80">Toda linha do extrato precisa de classificação — e todo lançamento com origem no extrato precisa ter linha correspondente</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-amber-200/80">
          <FaltanteCol titulo="Extrato sem classificação" count={extratoSemClassificacao.length} emptyHint={emptyHint}>
            {extratoSemClassificacao.map((l, i) => (
              <FaltanteRow key={i} data={l.data} descricao={l.descricao} valor={l.valor}>
                <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" disabled={acting} onClick={() => onClassificar(l)}>
                  Classificar
                </Button>
              </FaltanteRow>
            ))}
          </FaltanteCol>
          <FaltanteCol titulo="Classificado sem extrato" count={classificadoSemExtrato.length} emptyHint={emptyHint}>
            {classificadoSemExtrato.map((l) => (
              <FaltanteRow key={l.id} data={l.data} descricao={l.descricao ?? null} valor={l.valor}>
                <button type="button" onClick={() => onEditar(l.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar / classificar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={acting} onClick={() => onExcluir(l.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" title="Excluir lançamento">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </FaltanteRow>
            ))}
          </FaltanteCol>
        </div>
      </Card>
    </div>
  );
}

function SaldoMini({ label, value, signed }: { label: string; value: number | null; signed?: boolean }) {
  return (
    <Card className="rounded-2xl border-0 shadow-soft">
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-2xl leading-tight">
          {value == null ? (
            <span className="text-lg text-muted-foreground">—</span>
          ) : (
            <span className={signed ? (value >= 0 ? "text-emerald-600" : "text-rose-600") : ""}>
              {signed && value >= 0 ? "+" : ""}{brl(value)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaMini({ saldo, analisado }: { saldo?: ResultadoSaldo; analisado: boolean }) {
  const confere = saldo?.confere ?? false;
  return (
    <Card className={cn("rounded-2xl border-0 shadow-soft", analisado && !confere && "ring-1 ring-rose-300")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Delta (saldo)</div>
          {analisado && saldo && (
            <StatusPill variant={confere ? "now" : "back"}>{confere ? "Confere" : "Não confere"}</StatusPill>
          )}
        </div>
        <div className={cn("mt-2 font-display text-2xl leading-tight", !analisado || saldo?.delta == null ? "" : confere ? "text-emerald-600" : "text-rose-600")}>
          {!analisado || saldo?.delta == null ? <span className="text-lg text-muted-foreground">—</span> : brl(saldo.delta)}
        </div>
      </CardContent>
    </Card>
  );
}

// Coluna de faltantes com contador + ação por item (classificar, ou editar/excluir).
function FaltanteCol({ titulo, count, emptyHint, children }: {
  titulo: string; count: number; emptyHint: string; children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-primary">
        {titulo}
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{count}</span>
      </h4>
      <div className="max-h-72 divide-y divide-amber-100 overflow-y-auto">
        {count === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">{emptyHint}</div> : children}
      </div>
    </div>
  );
}

function FaltanteRow({ data, descricao, valor, children }: {
  data: string | null; descricao: string | null; valor: number; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground">{formatDataBR(data)}</span>
      <span className="min-w-0 flex-1 truncate" title={descricao ?? ""}>{descricao ?? "—"}</span>
      <span className="shrink-0 font-mono text-sm text-foreground">{brl(valor)}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

// Seletor de conta contábil pesquisável (código ou descrição) sobre o plano de contas.
function ContaCombobox({ value, onChange }: { value: string; onChange: (codigo: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["plano-contas"], queryFn: () => listPlanoContas(), staleTime: 5 * 60_000 });
  const contas = (data ?? []) as { codigo: string; descricao: string; tipo: string | null; ativo: boolean }[];
  const sel = contas.find((c) => c.codigo === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {sel ? <><span className="font-mono text-xs">{sel.codigo}</span> · {sel.descricao}</> : (value ? value : <span className="text-muted-foreground">Selecionar conta…</span>)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] max-w-[90vw] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por código ou nome…" />
          <CommandList>
            <CommandEmpty>{isLoading ? "Carregando…" : "Nenhuma conta encontrada."}</CommandEmpty>
            <CommandGroup>
              {contas.map((c) => (
                <CommandItem key={c.codigo} value={`${c.codigo} ${c.descricao}`} onSelect={() => { onChange(c.codigo); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.codigo ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2">{c.codigo}</span>
                  <span className="truncate">{c.descricao}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Seletor de histórico contábil pesquisável (código ou nome) sobre o Plano de
// Históricos SCI oficial — #140.
function HistoricoCombobox({ value, onChange }: { value: string; onChange: (codigo: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["historicos-sci"], queryFn: () => listHistoricosSci(), staleTime: 5 * 60_000 });
  const historicos = (data ?? []) as { codigo: number; nome: string; apelido: string | null }[];
  const sel = historicos.find((h) => String(h.codigo) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {sel ? <><span className="font-mono text-xs">{sel.codigo}</span> · {sel.nome}</> : (value ? value : <span className="text-muted-foreground">Selecionar histórico…</span>)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] max-w-[90vw] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por código ou nome…" />
          <CommandList>
            <CommandEmpty>{isLoading ? "Carregando…" : "Nenhum histórico encontrado."}</CommandEmpty>
            <CommandGroup>
              {historicos.map((h) => (
                <CommandItem key={h.codigo} value={`${h.codigo} ${h.nome}`} onSelect={() => { onChange(String(h.codigo)); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === String(h.codigo) ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2">{h.codigo}</span>
                  <span className="truncate">{h.nome}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DocsSuporteCard({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const { data: docs } = useQuery({
    queryKey: ["docs-suporte", empresaId, competencia],
    queryFn: () => listDocsSuporte({ data: { empresa_id: empresaId, competencia } }),
  });
  const lista = (docs ?? []) as Array<{ id: string; tipo: string; arquivo_nome: string | null; recebido_em: string; lancamento_match: { id: string; descricao: string | null; valor: number | null } | null }>;
  const orfaos = lista.filter((d) => !d.lancamento_match).length;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg">Documentos suporte recebidos</h3>
          <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label="Comprovantes vinculados às linhas do extrato" />
          {lista.length > 0 && <span className="text-xs text-muted-foreground">· {lista.length}{orfaos > 0 ? ` · ${orfaos} sem match` : ""}</span>}
        </div>
        {orfaos > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            <AlertTriangle className="h-3 w-3" /> {orfaos} sem linha correspondente no extrato
          </span>
        )}
      </div>
      <CardContent className="p-0">
        {lista.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">Nenhum documento suporte recebido nesta competência.</div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Recebido em</TableHead>
              <TableHead>Linha do extrato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((d) => (
              <TableRow key={d.id} className={cn(!d.lancamento_match && "bg-amber-50/40")}>
                <TableCell className="text-sm truncate max-w-[20rem]" title={d.arquivo_nome ?? ""}>
                  {d.arquivo_nome ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{DOC_TIPO_LABEL[d.tipo as keyof typeof DOC_TIPO_LABEL] ?? d.tipo}</TableCell>
                <TableCell className="text-xs">{new Date(d.recebido_em).toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="text-xs">
                  {d.lancamento_match ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Link2 className="h-3 w-3" />
                      <span className="truncate max-w-[16rem]">{d.lancamento_match.descricao ?? d.lancamento_match.id.slice(0, 8)}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> Sem match no extrato
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </CardContent>
    </Card>
  );
}

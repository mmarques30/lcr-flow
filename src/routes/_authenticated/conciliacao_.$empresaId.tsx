import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getConciliacaoDetalhe, ensureConciliacao, setConciliacaoExtratoCsv, listLancamentosConciliacao, toggleLancamentoConciliado, bulkConciliarLancamentos } from "@/lib/lcr.functions";
import { CONCILIACAO_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, Upload, Download, AlertCircle, CheckCircle2, Sparkles, Wand2, ListChecks, AlertTriangle } from "lucide-react";
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

type Linha = { data: string | null; descricao: string; valor: number };
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

function ConciliacaoCliente() {
  const { empresaId } = Route.useParams();
  const qc = useQueryClient();
  const key = ["conciliacao-detalhe", empresaId];
  const { data } = useSuspenseQuery({ queryKey: key, queryFn: () => getConciliacaoDetalhe({ data: { empresa_id: empresaId } }) });
  const extratoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"extrato" | "conciliar" | null>(null);

  const conc = data.conciliacao;
  const competencia = data.competencia;
  const resultado = (conc?.resultado ?? null) as Resultado;
  const temExtrato = !!conc?.extrato_csv_url;

  async function enviar(_tipo: "extrato", file: File) {
    setBusy("extrato");
    try {
      const { id } = await ensureConciliacao({ data: { empresa_id: empresaId, competencia } });
      const path = `${empresaId}/${competencia}/extrato-${crypto.randomUUID()}-${file.name}`;
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
        {conc && (
          <StatusPill variant={variantFor(conc.status)}>{CONCILIACAO_STATUS_LABEL[conc.status as keyof typeof CONCILIACAO_STATUS_LABEL]}</StatusPill>
        )}
      </div>

      <div className="mb-6">
        <LancamentosConciliacao empresaId={empresaId} competencia={competencia} />
      </div>

      <h2 className="mb-1 font-display text-xl">Conciliar com extrato bancário (CSV)</h2>
      <p className="mb-3 text-sm text-soft-foreground">A razão é a tabela de lançamentos acima (gerada pela IA). Importe só o extrato bancário para cruzar.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <FonteCard
          titulo="Extrato bancário" enviado={temExtrato} busy={busy === "extrato"}
          inputRef={extratoRef} onFile={(f) => enviar("extrato", f)}
          onBaixar={() => conc?.extrato_csv_url && baixar(conc.extrato_csv_url)}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button onClick={conciliar} disabled={!temExtrato || busy === "conciliar"}>
          <Wand2 className="h-4 w-4 mr-1.5" />{busy === "conciliar" ? "Conciliando..." : "Conciliar agora"}
        </Button>
        <span className="text-xs text-muted-foreground">Cruza os lançamentos da razão (acima) com o extrato — por regras (valor + data ±3 dias) e, no que sobrar, por IA.</span>
      </div>

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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Divergencias titulo="Na razão, sem par no extrato" linhas={resultado.divergencias_razao} />
            <Divergencias titulo="No extrato, sem par na razão" linhas={resultado.divergencias_extrato} />
          </div>
        </div>
      )}
    </>
  );
}

type LancConc = {
  id: string; data_lancamento: string | null; valor: number | null; descricao: string | null;
  conciliado: boolean; confidence: number | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string } | null;
};

function LancamentosConciliacao({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const qc = useQueryClient();
  const key = ["lanc-conc", empresaId, competencia];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => listLancamentosConciliacao({ data: { empresa_id: empresaId, competencia } }) });
  const lancs = (data?.lancamentos ?? []) as LancConc[];
  const [busyId, setBusyId] = useState<string | null>(null);

  const precisaRevisao = (l: LancConc) => (l.confidence != null && l.confidence < 0.7) || !l.conta;
  const aRever = lancs.filter(precisaRevisao).length;
  const conciliados = lancs.filter((l) => l.conciliado).length;
  const todosConciliados = lancs.length > 0 && conciliados === lancs.length;
  const [bulkBusy, setBulkBusy] = useState(false);
  const [soNaoConciliados, setSoNaoConciliados] = useState(false);
  const visiveis = soNaoConciliados ? lancs.filter((l) => !l.conciliado) : lancs;

  async function toggle(id: string, conciliado: boolean) {
    setBusyId(id);
    try {
      await toggleLancamentoConciliado({ data: { id, conciliado } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBusyId(null); }
  }

  async function toggleTodos(marcar: boolean) {
    setBulkBusy(true);
    try {
      const res = await bulkConciliarLancamentos({ data: { empresa_id: empresaId, competencia, conciliado: marcar } });
      await qc.invalidateQueries({ queryKey: key });
      toast.success(`${res.atualizados} lançamento(s) ${marcar ? "marcado(s)" : "desmarcado(s)"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBulkBusy(false); }
  }

  async function aplicarRegraIA() {
    setBulkBusy(true);
    try {
      const res = await bulkConciliarLancamentos({ data: { empresa_id: empresaId, competencia, conciliado: true, apenasAlta: true } });
      await qc.invalidateQueries({ queryKey: key });
      if (res.atualizados === 0 && aRever === 0) toast.success("Regra IA: tudo já está conciliado. 🎉");
      else if (aRever > 0) toast.warning(`Regra IA: ${res.atualizados} conciliado(s) automaticamente. ${aRever} lançamento(s) ainda precisam de revisão (confiança < 70% ou sem conta) — destacados em amarelo.`);
      else toast.success(`Regra IA: ${res.atualizados} lançamento(s) conciliados automaticamente.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBulkBusy(false); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg">Razão contábil · lançamentos da competência</h3>
          <span className="text-xs text-muted-foreground">· {lancs.length} lançamento(s) · {conciliados} conciliado(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={soNaoConciliados} onChange={(e) => setSoNaoConciliados(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]" />
            Mostrar só não conciliados
          </label>
          {aRever > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> {aRever} a revisar</span>}
          <Button variant="outline" size="sm" disabled={bulkBusy || lancs.length === 0} onClick={aplicarRegraIA} title="Concilia automaticamente os lançamentos com conta sugerida e confiança alta (≥70%).">
            <Sparkles className="mr-1 h-4 w-4" /> Aplicar regra IA
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
                <TableHead className="w-28 text-center">
                  <div className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={todosConciliados}
                      disabled={bulkBusy || lancs.length === 0}
                      onChange={(e) => toggleTodos(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      title={todosConciliados ? "Desmarcar todos" : "Marcar todos"}
                    />
                    <span>Conciliado</span>
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const alerta = precisaRevisao(l);
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
                    <TableCell className="text-center">
                      <input type="checkbox" checked={l.conciliado} disabled={busyId === l.id} onChange={(e) => toggle(l.id, e.target.checked)} className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]" />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && visiveis.length === 0 && lancs.length > 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Todos os lançamentos já estão conciliados.</TableCell></TableRow>}
              {!isLoading && lancs.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum lançamento nesta competência. Faça upload de um documento para gerar lançamentos.</TableCell></TableRow>}
              {isLoading && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FonteCard({ titulo, enviado, busy, inputRef, onFile, onBaixar }: {
  titulo: string; enviado: boolean; busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>; onFile: (f: File) => void; onBaixar: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg">{titulo}</h3>
          <StatusPill variant={enviado ? "now" : "next"}>{enviado ? "Importado" : "Pendente"}</StatusPill>
        </div>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />{busy ? "Enviando..." : enviado ? "Substituir CSV" : "Importar CSV"}
          </Button>
          {enviado && <Button variant="ghost" size="sm" onClick={onBaixar}><Download className="h-4 w-4 mr-1" />Baixar</Button>}
        </div>
      </CardContent>
    </Card>
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

function Divergencias({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <Card>
      <div className="px-6 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-status-back-foreground" /><h3 className="font-display text-base">{titulo}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{linhas.length}</span>
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
          <TableBody>
            {linhas.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm">{l.data ?? "—"}</TableCell>
                <TableCell className="text-sm">{l.descricao}</TableCell>
                <TableCell className={`text-right font-mono text-sm ${l.valor < 0 ? "text-destructive" : "text-primary-hover"}`}>{brl(l.valor)}</TableCell>
              </TableRow>
            ))}
            {linhas.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Sem divergências.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

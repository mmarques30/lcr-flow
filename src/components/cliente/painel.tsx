// Componentes das abas do Painel do Cliente. Reorganizam telas existentes
// reaproveitando as MESMAS server functions — sem reescrever a lógica de negócio.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusPill, variantFor } from "@/components/status-pill";
import { Markdown } from "@/components/markdown";
import { listDocumentos, gerarPlanilhaSci, getHistoricoCerebro, createDocumento, ensureCompetencia, listLancamentosConciliacao, getEmpresa, editarLancamento, type SciLinha } from "@/lib/lcr.functions";
import { baixarPlanilhaSciXls, bancoCodigoDe, linhasSciPreview, mapaPdcApelidos, validarLancamentosSci, type SciCelula } from "@/lib/sci-xls";
import { DOC_TIPO_LABEL, DOC_STATUS_LABEL, formatCompetencia, competenciaAtual } from "@/lib/format";
import { documentoComErroProcessamento } from "@/lib/documento-erros";
import { DocumentoErroHint } from "@/components/documento-erro-hint";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, ClipboardCheck, Download, FileSpreadsheet, X, Plus, Eye, ChevronRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DocumentoRevisaoView } from "@/routes/_authenticated/revisar.$documentoId";

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Compõe um identificador curto para o documento usando o que a IA já
// extraiu (nº NF, emitente, valor) e cai no arquivo_nome se nada vier.
function nomeCurtoDoc(d: { arquivo_nome?: string | null; classificacao_ia?: unknown; dados_extraidos?: unknown }): string {
  const ci = d.classificacao_ia && typeof d.classificacao_ia === "object" ? (d.classificacao_ia as { dados_extraidos?: unknown }).dados_extraidos : null;
  const dados = (ci ?? d.dados_extraidos) as Record<string, unknown> | null;
  if (dados && typeof dados === "object") {
    const numero = (dados.numero_nf ?? dados.numero ?? dados.nf ?? dados.documento ?? "") as string | number;
    const fornecedor = (dados.fornecedor ?? dados.emitente ?? dados.cliente ?? dados.razao_social ?? dados.empresa ?? "") as string;
    const valor = (dados.valor_total ?? dados.valor ?? "") as string | number;
    const partes: string[] = [];
    if (numero) partes.push(`Nº ${String(numero).trim()}`);
    if (fornecedor) partes.push(String(fornecedor).trim().slice(0, 40));
    if (valor !== "" && valor != null) {
      const n = Number(valor);
      if (!Number.isNaN(n)) partes.push(n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
    }
    if (partes.length > 0) return partes.join(" · ");
  }
  if (d.arquivo_nome) return d.arquivo_nome.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").slice(0, 80);
  return "";
}

// ---------------------------------------------------------------- Documentos
export function DocumentosTab({ empresaId, competencia }: { empresaId: string; competencia?: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["documentos", empresaId, competencia ?? "all"],
    queryFn: () => listDocumentos({ data: { empresa_id: empresaId, competencia } }),
  });
  const docs = data ?? [];
  const [processando, setProcessando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  async function processarIA(id: string) {
    setProcessando(id);
    try {
      const { data: res, error } = await supabase.functions.invoke("processar-documento", { body: { documento_id: id } });
      if (error) throw new Error(error.message);
      if (res && res.ok === false) throw new Error(res.error ?? "Falha ao processar");
      await qc.invalidateQueries({ queryKey: ["documentos"] });
      toast.success("Documento processado pela IA.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setProcessando(null); }
  }

  async function baixar(path: string) {
    const { data: signed, error } = await supabase.storage.from("documentos-clientes").createSignedUrl(path, 60);
    if (error || !signed?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5">
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {docs.length} documento(s)
        {competencia && <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{formatCompetencia(competencia)}</span>}
      </p>
      <UploadDocDialog empresaId={empresaId} competenciaPadrao={competencia} />
    </div>
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Documento</TableHead><TableHead>Competência</TableHead><TableHead>Origem</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => {
              const nome = nomeCurtoDoc(d);
              return (
              <TableRow key={d.id}>
                <TableCell className="text-sm">
                  <div className="font-medium" title={d.arquivo_nome ?? ""}>{nome || DOC_TIPO_LABEL[d.tipo]}</div>
                  {nome && <div className="text-[11px] text-muted-foreground">{DOC_TIPO_LABEL[d.tipo]}</div>}
                </TableCell>
                <TableCell className="text-sm">{formatCompetencia(d.competencia)}</TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">{d.origem}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <span className="flex items-center gap-1.5">
                      {d.duplicata_de && <StatusPill variant="back">Duplicata</StatusPill>}
                      {documentoComErroProcessamento(d) ? (
                        <StatusPill variant="back">Erro IA</StatusPill>
                      ) : (
                        <StatusPill variant={variantFor(d.status)}>{DOC_STATUS_LABEL[d.status]}</StatusPill>
                      )}
                    </span>
                    {documentoComErroProcessamento(d) && (
                      <DocumentoErroHint classificacao_ia={d.classificacao_ia} compact />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {d.arquivo_url && (() => {
                      const classificado = d.status_processamento === "classificado" || d.status_processamento === "revisado";
                      const comErro = documentoComErroProcessamento(d);
                      return (
                        <Button variant={aberto === d.id ? "default" : "outline"} size="sm" onClick={() => setAberto(aberto === d.id ? null : d.id)} title={comErro ? "Ver falha de processamento" : classificado ? "Ver documento + análise da IA" : "Ver documento"}>
                          {comErro ? <AlertTriangle className="mr-1 h-4 w-4" /> : classificado ? <ClipboardCheck className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}
                          {aberto === d.id ? "Fechar" : comErro ? "Ver erro" : classificado ? "Revisar" : "Ver"}
                        </Button>
                      );
                    })()}
                    {d.arquivo_url && (
                      <Button variant="ghost" size="sm" disabled={processando === d.id} onClick={() => processarIA(d.id)} title="Processar com IA">
                        {processando === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                    )}
                    {d.arquivo_url && (
                      <Button variant="ghost" size="sm" onClick={() => baixar(d.arquivo_url!)} title="Baixar arquivo"><Download className="h-4 w-4" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {!isLoading && docs.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum documento para este cliente.</TableCell></TableRow>}
            {isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>

      {aberto && (
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg">Revisão do documento</h3>
            <Button variant="ghost" size="sm" onClick={() => setAberto(null)}><X className="mr-1 h-4 w-4" />Fechar</Button>
          </div>
          <DocumentoRevisaoView documentoId={aberto} onAprovado={() => setAberto(null)} />
        </div>
      )}
    </div>
  );
}

// Upload manual de documento para ESTE cliente (mesma lógica da tela Documentos:
// sobe ao bucket, registra o documento e dispara o processamento da IA).
function UploadDocDialog({ empresaId, competenciaPadrao }: { empresaId: string; competenciaPadrao?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState("extrato");
  const [competencia, setCompetencia] = useState(competenciaPadrao ?? competenciaAtual());
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast.error("Selecione um arquivo."); return; }
    if (!/^\d{4}-\d{2}$/.test(competencia)) { toast.error("Competência no formato AAAA-MM."); return; }
    setLoading(true);
    try {
      const { id: competencia_id } = await ensureCompetencia({ data: { empresa_id: empresaId, competencia } });
      const safeName = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${empresaId}/${competencia}/auto/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("documentos-clientes").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (upErr) { toast.error(upErr.message); setLoading(false); return; }
      const doc = await createDocumento({
        data: {
          empresa_id: empresaId,
          tipo: tipo as "extrato",
          competencia,
          competencia_id,
          arquivo_url: path,
          storage_path: path,
          arquivo_nome: file.name,
          arquivo_tamanho_bytes: file.size,
          mime_type: file.type || "application/pdf",
        },
      });
      qc.invalidateQueries({ queryKey: ["documentos"] });
      toast.success("Documento enviado. Processando com IA…");
      setOpen(false); setFile(null);
      void supabase.functions.invoke("processar-documento", { body: { documento_id: doc.id } }).then(({ data, error }) => {
        qc.invalidateQueries({ queryKey: ["documentos"] });
        qc.invalidateQueries({ queryKey: ["lanc-conc"] });
        const r = data as { ok?: boolean; lancamentos_gerados?: number; error?: string } | null;
        if (error || !r?.ok) toast.error(r?.error ?? "Falha no processamento IA.");
        else toast.success(`IA classificou — ${r.lancamentos_gerados ?? 0} lançamento(s) gerado(s).`);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> Upload manual</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">Upload manual</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de documento</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DOC_TIPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Competência</Label><Input value={competencia} onChange={(e) => setCompetencia(e.target.value)} placeholder="2026-06" /></div>
            <div className="space-y-1.5"><Label>Arquivo</Label><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Enviando..." : "Registrar"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------- Planilha SCI
function exportarCsv(empresa: string, competencia: string, linhas: SciLinha[]) {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["Código", "Descrição", "Tipo", "Total"].join(";");
  const corpo = linhas.map((l) => [esc(l.codigo), esc(l.descricao), esc(l.tipo), brl(l.total)].join(";"));
  const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
  const rodape = ["", "", esc("TOTAL"), brl(totalGeral)].join(";");
  const csv = "﻿" + [header, ...corpo, rodape].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SCI_${empresa.replace(/[^\w]+/g, "_")}_${competencia}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type SciLancDet = {
  id: string; data_lancamento: string | null; valor: number | null; descricao: string | null;
  documento_numero?: string | null;
  part_deb?: string | null;
  part_cred?: string | null;
  natureza_movimento?: string | null;
  regra_id?: string | null;
  justificativa?: string | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string } | null;
};

// Célula código + nome para a prévia da planilha (débito/crédito).
function CelSci({ cel }: { cel: SciCelula }) {
  return (
    <TableCell className="text-sm">
      <span className="font-mono text-xs">{cel.codigo === "" ? "—" : cel.codigo}</span>
      {cel.nome && <div className="text-xs text-muted-foreground">{cel.nome}</div>}
    </TableCell>
  );
}

// Célula editável inline — usada nas colunas Documento (nº NF) e Complemento.
// Persiste no blur via editarLancamento e invalida o cache da prévia.
function CelEditavel({ id, initial, campo, placeholder, maxLength = 80, mono = false }: {
  id?: string; initial: string;
  campo: "descricao" | "documento_numero" | "part_deb" | "part_cred";
  placeholder: string; maxLength?: number; mono?: boolean;
}) {
  const qc = useQueryClient();
  const [val, setVal] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(initial), [initial]);

  async function persistir() {
    if (!id || val === initial) return;
    setBusy(true);
    try {
      await editarLancamento({ data: { id, [campo]: val || "" } as { id: string; descricao?: string; documento_numero?: string; part_deb?: string; part_cred?: string } });
      qc.invalidateQueries({ queryKey: ["lanc-conc"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      setVal(initial);
    } finally { setBusy(false); }
  }

  return (
    <input
      type="text"
      value={val}
      onChange={(e) => setVal(e.target.value.slice(0, maxLength))}
      onBlur={persistir}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder={placeholder}
      disabled={!id || busy}
      className={cn(
        "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none transition-colors",
        "hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-card",
        mono && "font-mono text-xs",
        busy && "opacity-50",
      )}
    />
  );
}

export function PlanilhaSciTab({ empresaId, empresaNome, competencia }: { empresaId: string; empresaNome: string; competencia: string }) {
  const [linhas, setLinhas] = useState<SciLinha[] | null>(null);
  const [totais, setTotais] = useState<{ lanc: number; valor: number }>({ lanc: 0, valor: 0 });
  const [busy, setBusy] = useState(false);

  // Detalhamento: lançamentos individuais da competência (sempre carregados).
  const { data: det } = useQuery({ queryKey: ["lanc-conc", empresaId, competencia], queryFn: () => listLancamentosConciliacao({ data: { empresa_id: empresaId, competencia } }) });
  const lancs = (det?.lancamentos ?? []) as SciLancDet[];
  const totalGeral = lancs.reduce((s, l) => s + (l.valor ?? 0), 0);
  const contasDistintas = new Set(lancs.map((l) => l.conta?.codigo).filter(Boolean)).size;

  // Código do banco (contrapartida débito/crédito) a partir da conta bancária da empresa.
  const { data: emp } = useQuery({ queryKey: ["empresa", empresaId], queryFn: () => getEmpresa({ data: { id: empresaId } }) });
  const contasBanc = (emp as { contas_bancarias?: { banco: string | null }[] } | undefined)?.contas_bancarias ?? [];
  const bancoCodigo = bancoCodigoDe(contasBanc[0]?.banco ?? null);
  const bancoNome = contasBanc[0]?.banco ?? "";
  // Plano de Contas oficial LCR (Anexo 1) — códigos reduzidos SCI + validação pré-envio.
  const { data: pdcLcr } = useQuery({
    queryKey: ["plano-de-contas-lcr-codigos"],
    queryFn: async () => {
      const { data } = await supabase.from("plano_de_contas_lcr").select("codigo, apelido, requer_participante");
      return (data ?? []) as { codigo: number; apelido: number | null; requer_participante: boolean }[];
    },
    staleTime: 10 * 60_000,
  });
  const pdcApelidos = mapaPdcApelidos(pdcLcr ?? []);
  const codigosValidos = new Set<string>((pdcLcr ?? []).flatMap((c) => [String(c.codigo), c.apelido != null ? String(c.apelido) : ""].filter(Boolean)));
  const requerParticipante = new Set<string>((pdcLcr ?? []).filter((c) => c.requer_participante).flatMap((c) => [String(c.codigo), c.apelido != null ? String(c.apelido) : ""].filter(Boolean)));

  // Plano de Históricos SCI (Anexo 2) — set de códigos com pula_complemento=true.
  const { data: histPula } = useQuery({
    queryKey: ["historicos-sci-pula-complemento"],
    queryFn: async () => {
      const { data } = await supabase.from("historicos_sci_lcr").select("codigo").eq("pula_complemento", true);
      return new Set<string>((data ?? []).map((r) => String((r as { codigo: number }).codigo)));
    },
    staleTime: 10 * 60_000,
  });
  const lancsComPula = lancs.map((l) => l.historico?.codigo && histPula?.has(String(l.historico.codigo))
    ? { ...l, historico: { ...l.historico, pula_complemento: true } }
    : l);

  const previewRows = linhasSciPreview(lancsComPula, bancoCodigo, pdcApelidos, bancoNome);

  function baixarXls() {
    if (codigosValidos.size > 0) {
      const invalidos = validarLancamentosSci(lancsComPula, codigosValidos);
      if (invalidos.length > 0) {
        const primeiros = invalidos.slice(0, 5).map((i) => `${i.codigo}${i.descricao ? ` (${i.descricao})` : ""}`).join(", ");
        toast.error(`Exportação bloqueada: ${invalidos.length} lançamento(s) usam código de conta fora do Plano de Contas oficial LCR — ${primeiros}${invalidos.length > 5 ? "…" : ""}`);
        return;
      }
    }
    const n = baixarPlanilhaSciXls(empresaNome, competencia, lancsComPula, bancoCodigo, pdcApelidos);
    if (n === 0) toast.warning("Nenhum lançamento com conta para exportar.");
    else toast.success(`Planilha SCI (.xls) gerada — ${n} lançamento(s) no layout de importação.`);
  }

  async function gerar() {
    setBusy(true);
    try {
      const res = await gerarPlanilhaSci({ data: { empresa_id: empresaId, competencia } });
      setLinhas(res.linhas);
      setTotais({ lanc: res.total_lancamentos, valor: res.total_valor });
      if (res.linhas.length === 0) toast.warning("Nenhum lançamento nesta competência.");
      else toast.success(`Planilha SCI gerada — ${res.total_lancamentos} lançamentos em ${res.linhas.length} contas.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {/* Ações — título suprimido (já está no filtro de competência do header) */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={gerar}><FileSpreadsheet className="mr-1 h-4 w-4" />{busy ? "Gerando…" : "Gerar SCI"}</Button>
        <Button variant="outline" size="sm" disabled={lancs.length === 0} onClick={baixarXls} title="Baixa o arquivo de importação SCI (.xls) — uma linha por lançamento, layout do modelo">
          <Download className="mr-1 h-4 w-4" />Baixar SCI (.xls)
        </Button>
        <Button variant="outline" size="sm" disabled={!linhas || linhas.length === 0} onClick={() => linhas && exportarCsv(empresaNome, competencia, linhas)}>
          <Download className="mr-1 h-4 w-4" />Baixar CSV
        </Button>
      </div>

{/* Prévia da planilha SCI (layout do modelo de importação, por lançamento) */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h4 className="font-display text-lg">Prévia da planilha SCI</h4>
          <span className="text-xs text-muted-foreground">· layout de importação · {previewRows.length} lançamento(s)</span>
          <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            Edite Part Déb, Part Cred, Complemento e Documento direto na tabela — salva automaticamente
          </span>
        </div>
        <CardContent className="p-0">
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">DATA</TableHead>
                  <TableHead>DÉBITO</TableHead>
                  <TableHead>CRÉDITO</TableHead>
                  <TableHead className="text-center">PART DÉB</TableHead>
                  <TableHead className="text-center">PART CRED</TableHead>
                  <TableHead className="text-right">VALOR</TableHead>
                  <TableHead>HISTÓRICO</TableHead>
                  <TableHead>COMPLEMENTO</TableHead>
                  <TableHead className="text-center">DOCUMENTO</TableHead>
                  <TableHead className="text-center whitespace-nowrap">C.CUSTO DÉB</TableHead>
                  <TableHead className="text-center whitespace-nowrap">C.CUSTO CRED</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{r.data}</TableCell>
                    <CelSci cel={r.debito} />
                    <CelSci cel={r.credito} />
                    <TableCell className={cn("w-24 p-1.5", requerParticipante.has(String(r.debito.codigo)) && !r.part_deb && "bg-amber-50")}>
                      <CelEditavel id={r.id} initial={r.part_deb} campo="part_deb" placeholder={requerParticipante.has(String(r.debito.codigo)) && !r.part_deb ? "obrigatório" : "—"} maxLength={40} mono />
                    </TableCell>
                    <TableCell className={cn("w-24 p-1.5", requerParticipante.has(String(r.credito.codigo)) && !r.part_cred && "bg-amber-50")}>
                      <CelEditavel id={r.id} initial={r.part_cred} campo="part_cred" placeholder={requerParticipante.has(String(r.credito.codigo)) && !r.part_cred ? "obrigatório" : "—"} maxLength={40} mono />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(r.valor)}</TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{r.historico.codigo || "—"}</span>
                      {r.historico.nome && <div className="text-xs text-muted-foreground">{r.historico.nome}</div>}
                    </TableCell>
                    <TableCell className="max-w-[16rem] p-1.5">
                      <CelEditavel id={r.id} initial={r.complemento} campo="descricao" placeholder="complemento contábil" maxLength={200} />
                    </TableCell>
                    <TableCell className="w-32 p-1.5">
                      <CelEditavel id={r.id} initial={r.documento} campo="documento_numero" placeholder="nº NF / doc" maxLength={40} mono />
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">—</TableCell>
                    <TableCell className="text-center text-muted-foreground">—</TableCell>
                  </TableRow>
                ))}
                {previewRows.length === 0 && <TableRow><TableCell colSpan={11} className="py-6 text-center text-muted-foreground">Nenhum lançamento com conta nesta competência.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalhamento por lançamento — collapsible, fechado por padrão */}
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <h4 className="font-display text-lg">Detalhamento por lançamento</h4>
            <span className="text-xs text-muted-foreground">· {lancs.length} lançamento(s)</span>
            <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">ver detalhes</span>
            <span className="ml-auto hidden text-[11px] text-muted-foreground group-open:inline">ocultar</span>
          </summary>
          <CardContent className="p-0">
            <div className="max-h-[28rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="w-24">Data</TableHead><TableHead>Conta</TableHead><TableHead>Histórico</TableHead><TableHead>Regra</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {lancs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">{l.data_lancamento ? new Date(l.data_lancamento).toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="text-sm">
                        {l.conta ? <span className="font-mono text-xs">{l.conta.codigo}</span> : <span className="text-xs text-amber-700">sem conta</span>}
                        {l.conta && <div className="text-xs text-muted-foreground">{l.conta.descricao}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{l.historico?.codigo ?? "—"}</TableCell>
                      <TableCell className="max-w-[10rem] text-xs" title={l.justificativa ?? undefined}>
                        {l.regra_id ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{l.regra_id}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {l.justificativa && <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{l.justificativa}</div>}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm" title={l.descricao ?? ""}>{l.descricao}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{l.valor == null ? "—" : brl(l.valor)}</TableCell>
                    </TableRow>
                  ))}
                  {lancs.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum lançamento nesta competência.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </details>
      </Card>

    </div>
  );
}

// ------------------------------------------------------------------ Histórico
export function HistoricoTab({ empresaId }: { empresaId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["historico-cerebro-cliente", empresaId],
    queryFn: () => getHistoricoCerebro({ data: { empresa_id: empresaId } }),
  });
  const itens = data?.items ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {itens.map((it) => (
            <details key={it.id} className="group px-4 py-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs font-medium capitalize text-primary">{it.persona}</span>
                  <span className="text-xs text-muted-foreground">{it.consultor}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{it.created_at ? new Date(it.created_at as string).toLocaleString("pt-BR") : ""}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium">{it.pergunta}</div>
                <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground group-open:hidden">{it.resposta}</div>
              </summary>
              <Markdown className="mt-2 text-sm text-foreground">{it.resposta ?? ""}</Markdown>
            </details>
          ))}
          {!isLoading && itens.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum registro do Cérebro para este cliente ainda.</div>}
          {isLoading && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// Componentes das abas do Painel do Cliente. Reorganizam telas existentes
// reaproveitando as MESMAS server functions — sem reescrever a lógica de negócio.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { Markdown } from "@/components/markdown";
import { listDocumentos, gerarPlanilhaSci, getHistoricoCerebro, type SciLinha } from "@/lib/lcr.functions";
import { DOC_TIPO_LABEL, DOC_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, ClipboardCheck, Download, FileSpreadsheet, X } from "lucide-react";
import { toast } from "sonner";
import { DocumentoRevisaoView } from "@/routes/_authenticated/revisar.$documentoId";

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- Documentos
export function DocumentosTab({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["documentos"], queryFn: () => listDocumentos() });
  const docs = (data ?? []).filter((d) => d.empresa?.id === empresaId);
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
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Tipo</TableHead><TableHead>Competência</TableHead><TableHead>Origem</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-sm">{DOC_TIPO_LABEL[d.tipo]}</TableCell>
                <TableCell className="text-sm">{formatCompetencia(d.competencia)}</TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">{d.origem}</TableCell>
                <TableCell><StatusPill variant={variantFor(d.status)}>{DOC_STATUS_LABEL[d.status]}</StatusPill></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {(d.status_processamento === "classificado" || d.status_processamento === "revisado") && (
                      <Button variant={aberto === d.id ? "default" : "outline"} size="sm" onClick={() => setAberto(aberto === d.id ? null : d.id)} title="Ver documento + análise da IA">
                        <ClipboardCheck className="mr-1 h-4 w-4" />{aberto === d.id ? "Fechar" : "Revisar"}
                      </Button>
                    )}
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
            ))}
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

export function PlanilhaSciTab({ empresaId, empresaNome, competencia }: { empresaId: string; empresaNome: string; competencia: string }) {
  const [linhas, setLinhas] = useState<SciLinha[] | null>(null);
  const [totais, setTotais] = useState<{ lanc: number; valor: number }>({ lanc: 0, valor: 0 });
  const [busy, setBusy] = useState(false);

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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg">Planilha SCI · {formatCompetencia(competencia)}</h3>
          {linhas && <span className="text-xs text-muted-foreground">· {totais.lanc} lançamentos em {linhas.length} contas</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={gerar}><FileSpreadsheet className="mr-1 h-4 w-4" />{busy ? "Gerando…" : "Gerar SCI"}</Button>
          <Button variant="outline" size="sm" disabled={!linhas || linhas.length === 0} onClick={() => linhas && exportarCsv(empresaNome, competencia, linhas)}>
            <Download className="mr-1 h-4 w-4" />Baixar CSV
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        {!linhas ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Clique em “Gerar SCI” para agregar os lançamentos aprovados da competência por conta.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Conta</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.codigo}>
                  <TableCell className="font-mono text-sm">{l.codigo}</TableCell>
                  <TableCell>{l.descricao}</TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">{l.tipo}</TableCell>
                  <TableCell className="text-right font-mono">{brl(l.total)}</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum lançamento nesta competência.</TableCell></TableRow>}
              {linhas.length > 0 && (
                <TableRow className="border-t-2 border-border font-semibold">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono">{brl(totais.valor)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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

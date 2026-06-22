import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listLancamentosAgrupados, gerarPlanilhaSci, registrarPlanilhaSci, type SciLinha } from "@/lib/lcr.functions";
import { formatCompetencia, LANCAMENTO_STATUS_LABEL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Search, Upload, Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/lancamentos")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "lancamentos", "/lancamentos"),
  head: () => ({ meta: [{ title: "Lançamentos — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["lancamentos"], queryFn: () => listLancamentosAgrupados() }),
  component: LancamentosPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

type Hist = { id: string; empresa_id: string; status: keyof typeof LANCAMENTO_STATUS_LABEL; total_lancamentos: number; planilha_url: string | null; created_at: string };
type Linha = { id: string; razao_social: string; prontos: number; ultima: Hist | null };

async function baixarPlanilha(path: string) {
  const { data, error } = await supabase.storage.from("planilhas-sci").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Exporta as linhas agregadas como CSV (separador ;, decimal vírgula — abre no Excel pt-BR).
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

function LinhaCliente({ linha, competencia, onGerar }: { linha: Linha; competencia: string; onGerar: (id: string, nome: string) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const u = linha.ultima;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = `${linha.id}/${competencia}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("planilhas-sci").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      await registrarPlanilhaSci({ data: { empresa_id: linha.id, competencia, planilha_url: path } });
      qc.invalidateQueries({ queryKey: ["lancamentos"] });
      toast.success("Planilha SCI enviada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{linha.razao_social}</TableCell>
      <TableCell><span className={linha.prontos > 0 ? "text-foreground" : "text-muted-foreground"}>{linha.prontos}</span></TableCell>
      <TableCell>
        {u ? <StatusPill variant={variantFor(u.status)}>{LANCAMENTO_STATUS_LABEL[u.status]}</StatusPill>
          : <span className="text-xs text-muted-foreground">sem planilha</span>}
      </TableCell>
      <TableCell className="text-sm">{u ? u.total_lancamentos : "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{u ? new Date(u.created_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" onClick={() => onGerar(linha.id, linha.razao_social)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />Gerar SCI
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          <Button variant="outline" size="icon" disabled={busy} onClick={() => inputRef.current?.click()} title="Enviar planilha pronta">
            <Upload className="h-4 w-4" />
          </Button>
          {u?.planilha_url && (
            <Button variant="ghost" size="icon" onClick={() => baixarPlanilha(u.planilha_url!)} title="Baixar planilha">
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function LancamentosPage() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({ queryKey: ["lancamentos"], queryFn: () => listLancamentosAgrupados() });
  const [preview, setPreview] = useState<{ empresa: string; competencia: string; linhas: SciLinha[]; totalLancamentos: number; totalValor: number } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const linhas: Linha[] = useMemo(() => {
    return data.grupos.map((g) => ({
      id: g.id,
      razao_social: g.razao_social,
      prontos: g.prontos,
      ultima: (data.historico as Hist[]).find((h) => h.empresa_id === g.id) ?? null,
    }));
  }, [data]);

  const filtradas = useMemo(() => linhas.filter((l) => {
    if (q && !l.razao_social.toLowerCase().includes(q.toLowerCase())) return false;
    if (status === "sem") return !l.ultima;
    if (status === "prontos") return l.prontos > 0;
    if (status !== "all") return l.ultima?.status === status;
    return true;
  }), [linhas, q, status]);

  async function gerar(empresaId: string, empresaNome: string) {
    try {
      const res = await gerarPlanilhaSci({ data: { empresa_id: empresaId, competencia: data.competencia } });
      qc.invalidateQueries({ queryKey: ["lancamentos"] });
      if (res.linhas.length === 0) {
        toast.warning("Nenhum lançamento encontrado para esta competência.");
      } else {
        toast.success(`Planilha SCI gerada — ${res.total_lancamentos} lançamentos em ${res.linhas.length} contas.`);
      }
      setPreview({ empresa: empresaNome, competencia: res.competencia, linhas: res.linhas, totalLancamentos: res.total_lancamentos, totalValor: res.total_valor });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
      <PageHeader title="Lançamentos contábeis" description={`Competência ${formatCompetencia(data.competencia)} — geração e envio de planilhas SCI.`} />

      <ResumoTela itens={[
        { label: "Clientes", value: linhas.length },
        { label: "Docs prontos", value: linhas.filter((l) => l.prontos > 0).length },
        { label: "Com planilha", value: linhas.filter((l) => l.ultima).length, tone: "ok" as const },
        { label: "Sem planilha", value: linhas.filter((l) => !l.ultima).length, tone: "warn" as const },
      ]} />

      <Card>
        <div className="p-4 border-b border-border grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="pl-8" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="prontos">Com documentos prontos</SelectItem>
              <SelectItem value="sem">Sem planilha</SelectItem>
              {Object.entries(LANCAMENTO_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground self-center justify-self-end">{filtradas.length} cliente(s)</div>
        </div>

        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Docs prontos</TableHead><TableHead>Status</TableHead><TableHead>Lançamentos</TableHead><TableHead>Última planilha</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((l) => <LinhaCliente key={l.id} linha={l} competencia={data.competencia} onGerar={gerar} />)}
            {filtradas.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum cliente encontrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Planilha SCI — {preview?.empresa}</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {preview && `${formatCompetencia(preview.competencia)} · ${preview.totalLancamentos} lançamentos agregados em ${preview.linhas.length} contas.`}
            </p>
            <Button
              size="sm"
              disabled={!preview || preview.linhas.length === 0}
              onClick={() => preview && exportarCsv(preview.empresa, preview.competencia, preview.linhas)}
            >
              <Download className="h-4 w-4 mr-1" />Baixar CSV
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Conta</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {preview?.linhas.map((l) => (
                  <TableRow key={l.codigo}>
                    <TableCell className="font-mono text-sm">{l.codigo}</TableCell>
                    <TableCell>{l.descricao}</TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">{l.tipo}</TableCell>
                    <TableCell className="text-right font-mono">{brl(l.total)}</TableCell>
                  </TableRow>
                ))}
                {preview && preview.linhas.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhum lançamento nesta competência.</TableCell></TableRow>
                )}
              </TableBody>
              {preview && preview.linhas.length > 0 && (
                <tfoot>
                  <TableRow className="border-t-2 border-border font-semibold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right font-mono">{brl(preview.totalValor)}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

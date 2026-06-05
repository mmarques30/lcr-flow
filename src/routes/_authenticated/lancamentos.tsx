import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { PageHeader, DemoFlag } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listLancamentosAgrupados, gerarPlanilhaSci, registrarPlanilhaSci } from "@/lib/lcr.functions";
import { formatCompetencia, LANCAMENTO_STATUS_LABEL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { FileSpreadsheet, Upload, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/lancamentos")({
  head: () => ({ meta: [{ title: "Lançamentos — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["lancamentos"], queryFn: () => listLancamentosAgrupados() }),
  component: LancamentosPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

type Grupo = { id: string; razao_social: string; prontos: number };

async function baixarPlanilha(path: string) {
  const { data, error } = await supabase.storage.from("planilhas-sci").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function GrupoCard({ grupo, competencia, onGerar }: { grupo: Grupo; competencia: string; onGerar: (id: string, nome: string) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = `${grupo.id}/${competencia}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("planilhas-sci").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      await registrarPlanilhaSci({ data: { empresa_id: grupo.id, competencia, planilha_url: path } });
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
    <Card className="card-interactive">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-foreground">{grupo.razao_social}</div>
            <div className="mt-1 text-sm text-soft-foreground">{grupo.prontos} documento(s) prontos</div>
          </div>
          <span className="icon-chip h-10 w-10 shrink-0"><FileSpreadsheet className="h-5 w-5" /></span>
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={grupo.prontos === 0} onClick={() => onGerar(grupo.id, grupo.razao_social)}>
            Gerar planilha SCI
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          <Button variant="outline" size="icon" disabled={busy} onClick={() => inputRef.current?.click()} title="Enviar planilha pronta">
            <Upload className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LancamentosPage() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({ queryKey: ["lancamentos"], queryFn: () => listLancamentosAgrupados() });
  const [preview, setPreview] = useState<{ empresa: string } | null>(null);

  async function gerar(empresaId: string, empresaNome: string) {
    try {
      await gerarPlanilhaSci({ data: { empresa_id: empresaId, competencia: data.competencia } });
      qc.invalidateQueries({ queryKey: ["lancamentos"] });
      toast.success("Planilha SCI gerada.");
      setPreview({ empresa: empresaNome });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <>
      <PageHeader title="Lançamentos contábeis" description={`Competência ${formatCompetencia(data.competencia)} — geração e envio de planilhas SCI.`} actions={<DemoFlag />} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        {data.grupos.map((g) => (
          <GrupoCard key={g.id} grupo={g} competencia={data.competencia} onGerar={gerar} />
        ))}
      </div>

      <h2 className="font-display text-xl mb-3">Histórico de planilhas</h2>
      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Competência</TableHead><TableHead>Lançamentos</TableHead><TableHead>Status</TableHead><TableHead>Gerada em</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data.historico.map((h) => {
              const emp = data.grupos.find((g) => g.id === h.empresa_id);
              return (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{emp?.razao_social ?? "—"}</TableCell>
                  <TableCell>{formatCompetencia(h.competencia)}</TableCell>
                  <TableCell>{h.total_lancamentos}</TableCell>
                  <TableCell><StatusPill variant={variantFor(h.status)}>{LANCAMENTO_STATUS_LABEL[h.status]}</StatusPill></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>
                    {h.planilha_url && (
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => baixarPlanilha(h.planilha_url!)} title="Baixar planilha">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {data.historico.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma planilha gerada.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Preview — {preview?.empresa}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Pré-visualização do conteúdo da planilha SCI gerada (mockup).</p>
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Histórico</TableHead><TableHead>Débito</TableHead><TableHead>Crédito</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {[
                ["02/05", "Recebimento cliente A", "1.1.01", "3.1.01", "1.250,00"],
                ["05/05", "Pagamento fornecedor B", "4.1.02", "1.1.01", "890,40"],
                ["08/05", "Tarifa bancária", "4.3.01", "1.1.01", "32,50"],
                ["12/05", "Recebimento cliente C", "1.1.01", "3.1.01", "4.700,00"],
                ["15/05", "DARF Simples Nacional", "4.4.01", "1.1.01", "612,30"],
              ].map((row, i) => (
                <TableRow key={i}>{row.map((c, j) => <TableCell key={j} className={j === 4 ? "text-right font-mono" : ""}>{c}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}

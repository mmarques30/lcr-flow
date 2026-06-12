import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { PageHeader, DemoFlag } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listLancamentosAgrupados, gerarPlanilhaSci, registrarPlanilhaSci } from "@/lib/lcr.functions";
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
          <Button size="sm" disabled={linha.prontos === 0} onClick={() => onGerar(linha.id, linha.razao_social)}>
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
  const [preview, setPreview] = useState<{ empresa: string } | null>(null);
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

import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Download, Sparkles, Eye, Loader2 } from "lucide-react";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listDocumentos, listEmpresas, createDocumento, setDocumentoStatus, ensureCompetencia } from "@/lib/lcr.functions";
import { DOC_TIPO_LABEL, DOC_STATUS_LABEL, formatCompetencia, competenciaAtual } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/documentos")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "documentos", "/documentos"),
  head: () => ({ meta: [{ title: "Documentos — LCR Contábil" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ["documentos"], queryFn: () => listDocumentos() }),
      context.queryClient.ensureQueryData({ queryKey: ["empresas"], queryFn: () => listEmpresas() }),
    ]);
  },
  component: DocsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function DocsPage() {
  const qc = useQueryClient();
  const { data: docs } = useSuspenseQuery({ queryKey: ["documentos"], queryFn: () => listDocumentos() });
  const { data: empresas } = useSuspenseQuery({ queryKey: ["empresas"], queryFn: () => listEmpresas() });
  const [empresa, setEmpresa] = useState("all");
  const [tipo, setTipo] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [processando, setProcessando] = useState<string | null>(null);
  const [verDados, setVerDados] = useState<{ nome: string; dados: Record<string, unknown> } | null>(null);

  async function processarIA(id: string) {
    setProcessando(id);
    try {
      const { data, error } = await supabase.functions.invoke("processar-documento", { body: { documento_id: id } });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error ?? "Falha ao processar");
      qc.invalidateQueries({ queryKey: ["documentos"] });
      toast.success("Documento processado pela IA.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setProcessando(null);
    }
  }

  function temDados(dados: unknown): dados is Record<string, unknown> {
    return !!dados && typeof dados === "object" && Object.keys(dados as object).length > 0;
  }

  const filtered = useMemo(() => docs.filter((d) => {
    if (empresa !== "all" && d.empresa?.id !== empresa) return false;
    if (tipo !== "all" && d.tipo !== tipo) return false;
    if (status !== "all" && d.status !== status) return false;
    return true;
  }), [docs, empresa, tipo, status]);

  async function baixar(path: string) {
    // gera uma URL assinada temporária (60s) para o arquivo no bucket privado
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function avancarStatus(id: string, atual: string) {
    const ordem = ["recebido", "classificado", "processado", "conciliado"] as const;
    const idx = ordem.indexOf(atual as (typeof ordem)[number]);
    if (idx < 0 || idx === ordem.length - 1) return;
    await setDocumentoStatus({ data: { id, status: ordem[idx + 1] } });
    qc.invalidateQueries({ queryKey: ["documentos"] });
  }

  return (
    <>
      <PageHeader
        title="Documentos"
        description="Documentos recebidos via Gestta ou upload manual."
        actions={
          <>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Upload manual</Button></DialogTrigger>
              <UploadDialog empresas={empresas} onSuccess={() => setOpen(false)} />
            </Dialog>
          </>
        }
      />

      <ResumoTela itens={[
        { label: "Documentos", value: docs.length },
        { label: "Recebidos", value: docs.filter((d) => d.status === "recebido").length },
        { label: "Classificados", value: docs.filter((d) => d.status === "classificado").length },
        { label: "Processados", value: docs.filter((d) => d.status === "processado").length, tone: "ok" as const },
        { label: "Conciliados", value: docs.filter((d) => d.status === "conciliado").length, tone: "ok" as const },
      ]} />

      <Card className="border-border">
        <div className="space-y-3 border-b border-border p-4">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">Todos</TabsTrigger>
              {Object.entries(DOC_STATUS_LABEL).map(([k, v]) => <TabsTrigger key={k} value={k}>{v}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select value={empresa} onValueChange={setEmpresa}>
              <SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(DOC_TIPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="self-center text-sm text-muted-foreground">{filtered.length} documento(s)</div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Recebido em</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.empresa?.razao_social}</TableCell>
                <TableCell className="text-sm">{DOC_TIPO_LABEL[d.tipo]}</TableCell>
                <TableCell className="text-sm">{formatCompetencia(d.competencia)}</TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">{d.origem}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(d.recebido_em).toLocaleDateString("pt-BR")}</TableCell>
                <TableCell><StatusPill variant={variantFor(d.status)}>{DOC_STATUS_LABEL[d.status]}</StatusPill></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {temDados(d.dados_extraidos) && (
                      <Button variant="ghost" size="sm" onClick={() => setVerDados({ nome: d.arquivo_nome ?? d.empresa?.razao_social ?? "Documento", dados: d.dados_extraidos as Record<string, unknown> })} title="Ver dados extraídos">
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {d.arquivo_url && (
                      <Button variant="ghost" size="sm" disabled={processando === d.id} onClick={() => processarIA(d.id)} title="Processar com IA (Claude)">
                        {processando === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                    )}
                    {d.arquivo_url && (
                      <Button variant="ghost" size="sm" onClick={() => baixar(d.arquivo_url!)} title="Baixar arquivo">
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    {d.status !== "conciliado" && (
                      <Button variant="outline" size="sm" onClick={() => avancarStatus(d.id, d.status)}>Avançar</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum documento.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!verDados} onOpenChange={(o) => !o && setVerDados(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Dados extraídos — {verDados?.nome}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Campos identificados pela IA (Claude) a partir do documento.</p>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs">{JSON.stringify(verDados?.dados ?? {}, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadDialog({ empresas, onSuccess }: { empresas: { id: string; razao_social: string }[]; onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ empresa_id: "", tipo: "extrato", competencia: competenciaAtual() });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.empresa_id) return toast.error("Selecione o cliente");
    if (!form.competencia.match(/^\d{4}-\d{2}$/)) return toast.error("Competência no formato AAAA-MM");
    if (!file) return toast.error("Selecione um arquivo");
    setLoading(true);
    try {
      // 1) garante a competência e obtém o id
      const { id: competencia_id } = await ensureCompetencia({
        data: { empresa_id: form.empresa_id, competencia: form.competencia },
      });

      // 2) upload real do arquivo no Storage (bucket privado "documentos")
      const path = `${form.empresa_id}/${competencia_id}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("documentos")
        .upload(path, file, { upsert: false, cacheControl: "3600" });
      if (upErr) {
        toast.error(upErr.message);
        setLoading(false);
        return;
      }

      // 3) registra o documento apontando para o arquivo enviado
      await createDocumento({
        data: {
          empresa_id: form.empresa_id,
          tipo: form.tipo as "extrato",
          competencia: form.competencia,
          competencia_id,
          arquivo_url: path,
          arquivo_nome: file.name,
          arquivo_tamanho_bytes: file.size,
        },
      });

      qc.invalidateQueries({ queryKey: ["documentos"] });
      toast.success("Documento enviado.");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally { setLoading(false); }
  }

  return (
    <DialogContent>
      <DialogHeader><DialogTitle className="font-display text-2xl">Upload manual</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Cliente</Label>
          <Select value={form.empresa_id} onValueChange={(v) => setForm({ ...form, empresa_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de documento</Label>
          <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(DOC_TIPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Competência</Label><Input value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} placeholder="2026-05" /></div>
          <div className="space-y-1.5">
            <Label>Arquivo</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Enviando..." : "Registrar"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

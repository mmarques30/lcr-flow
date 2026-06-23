import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listConciliacoes, ensureConciliacao, setConciliacaoRazaoCsv } from "@/lib/lcr.functions";
import { CONCILIACAO_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Download } from "lucide-react";
import { toast } from "sonner";
import { requireAcesso } from "@/lib/guard";
import { Sparkline, serieUltimosDias } from "@/components/sparkline";

export const Route = createFileRoute("/_authenticated/conciliacao")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "conciliacao", "/conciliacao"),
  head: () => ({ meta: [{ title: "Conciliação — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() }),
  component: ConciliacaoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

type ConcRow = { id: string; competencia: string; status: string; divergencias_count: number; created_at?: string | null; razao_csv_url: string | null; planilha_conciliacao_url: string | null };
type EmpRow = { id: string; razao_social: string; conciliacoes: ConcRow[] };

async function baixar(path: string) {
  const { data, error } = await supabase.storage.from("conciliacoes").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return toast.error(error?.message ?? "Não foi possível gerar o link.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function EmpresaRow({ empresa, competencia }: { empresa: EmpRow; competencia: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const conc = empresa.conciliacoes.find((c) => c.competencia === competencia) ?? empresa.conciliacoes[0];
  const status = conc?.status ?? "nao_iniciada";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { id } = await ensureConciliacao({ data: { empresa_id: empresa.id, competencia } });
      const path = `${empresa.id}/${competencia}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("conciliacoes").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      await setConciliacaoRazaoCsv({ data: { id, razao_csv_url: path } });
      qc.invalidateQueries({ queryKey: ["conciliacoes"] });
      toast.success("Razão CSV importada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{empresa.razao_social}</TableCell>
      <TableCell>{conc ? formatCompetencia(conc.competencia) : formatCompetencia(competencia)}</TableCell>
      <TableCell><StatusPill variant={variantFor(status)}>{CONCILIACAO_STATUS_LABEL[status as keyof typeof CONCILIACAO_STATUS_LABEL]}</StatusPill></TableCell>
      <TableCell>{conc?.divergencias_count ?? 0}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => inputRef.current?.click()} title="Importar razão CSV">
            <Upload className="h-4 w-4" />
          </Button>
          {conc?.razao_csv_url && (
            <Button variant="ghost" size="sm" onClick={() => baixar(conc.razao_csv_url!)} title="Baixar razão CSV">
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/conciliacao/$empresaId" params={{ empresaId: empresa.id }}>Conciliar</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ConciliacaoPage() {
  const { data } = useSuspenseQuery({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() });
  const [status, setStatus] = useState("all");
  const [comp, setComp] = useState(data.competencia);

  const empresas = data.empresas as EmpRow[];
  const competencias = useMemo(() => {
    const set = new Set<string>([data.competencia]);
    empresas.forEach((e) => e.conciliacoes.forEach((c) => set.add(c.competencia)));
    return [...set].sort().reverse();
  }, [empresas, data.competencia]);

  const statusDe = (e: EmpRow) => (e.conciliacoes.find((c) => c.competencia === comp) ?? e.conciliacoes[0])?.status ?? "nao_iniciada";
  const filtradas = status === "all" ? empresas : empresas.filter((e) => statusDe(e) === status);
  const serieConc = serieUltimosDias(empresas.flatMap((e) => e.conciliacoes.map((c) => c.created_at)));

  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        description={`Status das conciliações da competência ${formatCompetencia(data.competencia)}. Importe a razão CSV por cliente para iniciar.`}
      />

      <ResumoTela itens={[
        { label: "Clientes", value: empresas.length },
        { label: "Concluídas", value: empresas.filter((e) => statusDe(e) === "concluida").length, tone: "ok" as const },
        { label: "Em andamento", value: empresas.filter((e) => statusDe(e) === "em_andamento").length },
        { label: "Divergências", value: empresas.filter((e) => statusDe(e) === "divergencias").length, tone: "warn" as const },
        { label: "Não iniciadas", value: empresas.filter((e) => statusDe(e) === "nao_iniciada").length },
      ]} />

      <Card className="mb-6 p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="label-cat">Atividade de conciliação · últimos 14 dias</span>
          <span className="text-sm font-semibold">{serieConc.reduce((s, d) => s + d.v, 0)}</span>
        </div>
        <Sparkline data={serieConc} id="spark-conc" />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">Todas</TabsTrigger>
              {Object.entries(CONCILIACAO_STATUS_LABEL).map(([k, v]) => <TabsTrigger key={k} value={k}>{v}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-3">
            <Select value={comp} onValueChange={setComp}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Competência" /></SelectTrigger>
              <SelectContent>
                {competencias.map((c) => <SelectItem key={c} value={c}>{formatCompetencia(c)}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{filtradas.length} cliente(s)</span>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Competência</TableHead><TableHead>Status</TableHead><TableHead>Divergências</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((e) => (
              <EmpresaRow key={e.id} empresa={e} competencia={comp} />
            ))}
            {filtradas.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma conciliação neste status.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

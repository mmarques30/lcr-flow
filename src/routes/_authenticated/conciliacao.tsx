import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { PageHeader, DemoFlag } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { listConciliacoes, ensureConciliacao, setConciliacaoRazaoCsv } from "@/lib/lcr.functions";
import { CONCILIACAO_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conciliacao")({
  head: () => ({ meta: [{ title: "Conciliação — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() }),
  component: ConciliacaoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

type ConcRow = { id: string; competencia: string; status: string; divergencias_count: number; razao_csv_url: string | null; planilha_conciliacao_url: string | null };
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
          <Link to="/conciliacao/$empresaId" params={{ empresaId: empresa.id }}>
            <Button variant="outline" size="sm">Conciliar</Button>
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ConciliacaoPage() {
  const { data } = useSuspenseQuery({ queryKey: ["conciliacoes"], queryFn: () => listConciliacoes() });

  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        description={`Status das conciliações da competência ${formatCompetencia(data.competencia)}. Importe a razão CSV por cliente para iniciar.`}
        actions={<DemoFlag />}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Cliente</TableHead><TableHead>Competência</TableHead><TableHead>Status</TableHead><TableHead>Divergências</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data.empresas.map((e) => (
              <EmpresaRow key={e.id} empresa={e as EmpRow} competencia={data.competencia} />
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

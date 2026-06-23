import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getConciliacaoDetalhe, ensureConciliacao, setConciliacaoRazaoCsv, setConciliacaoExtratoCsv } from "@/lib/lcr.functions";
import { CONCILIACAO_STATUS_LABEL, formatCompetencia } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { requireAcesso } from "@/lib/guard";
import { ChevronLeft, Upload, Download, AlertCircle, CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

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
  const razaoRef = useRef<HTMLInputElement>(null);
  const extratoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"razao" | "extrato" | "conciliar" | null>(null);

  const conc = data.conciliacao;
  const competencia = data.competencia;
  const resultado = (conc?.resultado ?? null) as Resultado;
  const temRazao = !!conc?.razao_csv_url;
  const temExtrato = !!conc?.extrato_csv_url;

  async function enviar(tipo: "razao" | "extrato", file: File) {
    setBusy(tipo);
    try {
      const { id } = await ensureConciliacao({ data: { empresa_id: empresaId, competencia } });
      const path = `${empresaId}/${competencia}/${tipo}-${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("conciliacoes").upload(path, file, { upsert: false, cacheControl: "3600" });
      if (error) { toast.error(error.message); return; }
      if (tipo === "razao") await setConciliacaoRazaoCsv({ data: { id, razao_csv_url: path } });
      else await setConciliacaoExtratoCsv({ data: { id, extrato_csv_url: path } });
      await qc.invalidateQueries({ queryKey: key });
      toast.success(tipo === "razao" ? "Razão importada." : "Extrato importado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setBusy(null);
      if (razaoRef.current) razaoRef.current.value = "";
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <FonteCard
          titulo="Razão (SCI)" enviado={temRazao} busy={busy === "razao"}
          inputRef={razaoRef} onFile={(f) => enviar("razao", f)}
          onBaixar={() => conc?.razao_csv_url && baixar(conc.razao_csv_url)}
        />
        <FonteCard
          titulo="Extrato bancário" enviado={temExtrato} busy={busy === "extrato"}
          inputRef={extratoRef} onFile={(f) => enviar("extrato", f)}
          onBaixar={() => conc?.extrato_csv_url && baixar(conc.extrato_csv_url)}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button onClick={conciliar} disabled={!temRazao || !temExtrato || busy === "conciliar"}>
          <Wand2 className="h-4 w-4 mr-1.5" />{busy === "conciliar" ? "Conciliando..." : "Conciliar agora"}
        </Button>
        <span className="text-xs text-muted-foreground">Pareamento por regras (valor + data ±3 dias) e, no que sobrar, por IA.</span>
      </div>

      {!resultado ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {temRazao && temExtrato ? "Pronto para conciliar — clique em “Conciliar agora”." : "Importe a razão (SCI) e o extrato bancário em CSV para iniciar."}
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

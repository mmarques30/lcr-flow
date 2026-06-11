import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getEmpresa } from "@/lib/lcr.functions";
import { ChevronLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/conciliacao/$empresaId")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "conciliacao", "/conciliacao"),
  head: () => ({ meta: [{ title: "Conciliação cliente — LCR" }] }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({ queryKey: ["empresa", params.empresaId], queryFn: () => getEmpresa({ data: { id: params.empresaId } }) }),
  component: ConciliacaoCliente,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const RAZAO = [
  { data: "02/05", historico: "Recebimento cliente A", valor: 1250.0 },
  { data: "05/05", historico: "Pagamento fornecedor B", valor: -890.4 },
  { data: "08/05", historico: "Tarifa bancária", valor: -32.5 },
  { data: "12/05", historico: "Recebimento cliente C", valor: 4700.0 },
  { data: "15/05", historico: "DARF Simples Nacional", valor: -612.3 },
];
const EXTRATO = [
  { data: "02/05", historico: "TED CLIENTE A LTDA", valor: 1250.0, match: true },
  { data: "05/05", historico: "PIX FORNEC B SA", valor: -890.4, match: true },
  { data: "08/05", historico: "TAR MANUTENCAO CC", valor: -32.5, match: true },
  { data: "11/05", historico: "DEPOSITO DIN", valor: 350.0, match: false },
  { data: "12/05", historico: "TED CLIENTE C LTDA", valor: 4700.0, match: true },
  { data: "15/05", historico: "DARF DAS", valor: -612.3, match: true },
];

function ConciliacaoCliente() {
  const { empresaId } = Route.useParams();
  const { data: empresa } = useSuspenseQuery({ queryKey: ["empresa", empresaId], queryFn: () => getEmpresa({ data: { id: empresaId } }) });

  return (
    <>
      <Link to="/conciliacao" className="inline-flex items-center text-sm text-soft-foreground hover:text-primary mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" />Conciliação
      </Link>
      <h1 className="font-display text-3xl mb-6">{empresa.razao_social}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/40">
            <h3 className="font-display text-lg">Razão SCI</h3>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Histórico</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {RAZAO.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{r.data}</TableCell>
                    <TableCell className="text-sm">{r.historico}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${r.valor < 0 ? "text-destructive" : "text-primary-hover"}`}>{r.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/40">
            <h3 className="font-display text-lg">Extrato bancário</h3>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead></TableHead><TableHead>Data</TableHead><TableHead>Histórico</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {EXTRATO.map((r, i) => (
                  <TableRow key={i} className={!r.match ? "bg-status-back/20" : ""}>
                    <TableCell>
                      {r.match ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertCircle className="h-4 w-4 text-status-back-foreground" />}
                    </TableCell>
                    <TableCell className="text-sm">{r.data}</TableCell>
                    <TableCell className="text-sm">{r.historico}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${r.valor < 0 ? "text-destructive" : "text-primary-hover"}`}>{r.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">Estado mockado — divergência destacada em linha amarela. Implementação real da reconciliação será conectada ao SCI.</p>
    </>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusPill, variantFor } from "@/components/status-pill";
import { getEmpresa } from "@/lib/lcr.functions";
import { EMPRESA_STATUS_LABEL, REGIME_LABEL, DOC_TIPO_LABEL } from "@/lib/format";
import { ChevronLeft } from "lucide-react";
import { requireAcesso } from "@/lib/guard";

export const Route = createFileRoute("/_authenticated/clientes_/$id")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "clientes", "/clientes"),
  head: ({ params }) => ({ meta: [{ title: `Cliente — LCR Contábil` }, { name: "cliente-id", content: params.id }] }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({ queryKey: ["empresa", params.id], queryFn: () => getEmpresa({ data: { id: params.id } }) }),
  component: ClienteDetalhe,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Cliente não encontrado.</div>,
});

function ClienteDetalhe() {
  const { id } = Route.useParams();
  const { data: empresa } = useSuspenseQuery({ queryKey: ["empresa", id], queryFn: () => getEmpresa({ data: { id } }) });

  return (
    <>
      <Link to="/clientes" className="inline-flex items-center text-sm text-soft-foreground hover:text-primary mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" />Clientes
      </Link>
      <div className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">{empresa.razao_social}</h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StatusPill variant={variantFor(empresa.status)}>{EMPRESA_STATUS_LABEL[empresa.status]}</StatusPill>
            {(empresa.tags ?? []).map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-soft-foreground">#{t}</span>
            ))}
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div className="font-mono">{empresa.cnpj}</div>
          <div>{REGIME_LABEL[empresa.regime]}</div>
        </div>
      </div>

      <Tabs defaultValue="visao">
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="conciliacao">Conciliação</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-border"><CardContent className="pt-6">
              <h3 className="font-display text-lg mb-3">Contas bancárias</h3>
              {empresa.contas_bancarias.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p> :
                <ul className="space-y-2">
                  {empresa.contas_bancarias.map((c) => (
                    <li key={c.id} className="flex justify-between text-sm border-b border-border pb-2 last:border-0">
                      <span className="font-medium">{c.banco}</span>
                      <span className="font-mono text-muted-foreground">Ag {c.agencia} · CC {c.conta}</span>
                    </li>
                  ))}
                </ul>}
            </CardContent></Card>
            <Card className="border-border"><CardContent className="pt-6">
              <h3 className="font-display text-lg mb-3">Documentos esperados</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {empresa.documentos_esperados.map((d) => (
                  <span key={d.id} className="text-sm text-soft-foreground">• {DOC_TIPO_LABEL[d.tipo]}</span>
                ))}
              </div>
            </CardContent></Card>
            <Card className="border-border lg:col-span-2"><CardContent className="pt-6">
              <h3 className="font-display text-lg mb-3">Dados gerais</h3>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><dt className="text-muted-foreground">Nome fantasia</dt><dd>{empresa.nome_fantasia ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Segmento</dt><dd>{empresa.segmento ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Regime</dt><dd>{REGIME_LABEL[empresa.regime]}</dd></div>
                <div><dt className="text-muted-foreground">CNPJ</dt><dd className="font-mono">{empresa.cnpj}</dd></div>
              </dl>
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="documentos" className="mt-4"><Card className="border-border"><CardContent className="pt-6 text-sm text-muted-foreground">Use a tela <Link to="/documentos" className="text-primary hover:underline">Documentos</Link> para gerir os documentos deste cliente.</CardContent></Card></TabsContent>
        <TabsContent value="lancamentos" className="mt-4"><Card className="border-border"><CardContent className="pt-6 text-sm text-muted-foreground">Histórico de planilhas SCI deste cliente em <Link to="/lancamentos" className="text-primary hover:underline">Lançamentos</Link>.</CardContent></Card></TabsContent>
        <TabsContent value="conciliacao" className="mt-4"><Card className="border-border"><CardContent className="pt-6 text-sm text-muted-foreground">Acesse <Link to="/conciliacao" className="text-primary hover:underline">Conciliação</Link> para iniciar o batimento.</CardContent></Card></TabsContent>
        <TabsContent value="historico" className="mt-4"><Card className="border-border"><CardContent className="pt-6 text-sm text-muted-foreground">Histórico de competências fechadas será exibido aqui.</CardContent></Card></TabsContent>
        <TabsContent value="config" className="mt-4"><Card className="border-border"><CardContent className="pt-6 text-sm text-muted-foreground">Configurações de plano de contas, históricos padrão e integrações específicas deste cliente.</CardContent></Card></TabsContent>
      </Tabs>
    </>
  );
}

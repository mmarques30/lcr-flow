import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getProcesso } from "@/lib/lcr.functions";
import { requireAcesso } from "@/lib/guard";
import { ArrowLeft, ExternalLink, Video, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/knowledge_/processo/$codigo")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "knowledge", "/knowledge"),
  head: () => ({ meta: [{ title: "Processo — LCR Contábil" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData({ queryKey: ["kb-processo", params.codigo], queryFn: () => getProcesso({ data: { codigo: params.codigo } }) }),
  component: ProcessoPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function ProcessoPage() {
  const { codigo } = Route.useParams();
  const { data } = useSuspenseQuery({ queryKey: ["kb-processo", codigo], queryFn: () => getProcesso({ data: { codigo } }) });
  const p = data.processo;

  if (!p) return (
    <div className="space-y-4">
      <Link to="/knowledge" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
      <p className="text-muted-foreground">Processo não encontrado.</p>
    </div>
  );

  return (
    <>
      <Link to="/knowledge" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Base de Conhecimento</Link>
      <PageHeader
        title={p.nome}
        description={p.descricao ?? undefined}
        actions={p.link_execucao ? <Button asChild><a href={p.link_execucao} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> Abrir ferramenta</a></Button> : undefined}
      />
      <div className="mb-6 flex items-center gap-2"><Badge variant="secondary">{p.codigo}</Badge><Badge variant="outline">{p.area}</Badge></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-display text-xl">Passos</h2>
          <Card className="divide-y divide-border">
            {data.passos.map((s) => (
              <div key={s.id} className="flex gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.ordem}</div>
                <div>
                  <div className="font-medium">{s.titulo}</div>
                  {s.descricao && <div className="text-sm text-muted-foreground">{s.descricao}</div>}
                </div>
              </div>
            ))}
            {data.passos.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Passos ainda não documentados.</div>}
          </Card>

          {data.artigos.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 font-display text-xl">Artigos relacionados</h2>
              <Card className="divide-y divide-border">
                {data.artigos.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-4 py-3 text-sm"><FileText className="h-4 w-4 text-muted-foreground" /> {a.titulo}</div>
                ))}
              </Card>
            </>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-display text-xl">Vídeos</h2>
          <Card className="divide-y divide-border">
            {data.videos.map((v) => (
              <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Video className="h-4 w-4" /></div>
                <div className="text-sm font-medium">{v.titulo}</div>
              </a>
            ))}
            {data.videos.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Sem vídeos.</div>}
          </Card>
          <p className="mt-4 text-xs text-muted-foreground">Dúvidas sobre este processo? Pergunte ao Mestre no assistente — ele já sabe que você está no {p.codigo}.</p>
        </div>
      </div>
    </>
  );
}

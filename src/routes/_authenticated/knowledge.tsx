import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { PageHeader, ResumoTela } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getKnowledgeHub, criarArtigoConhecimento } from "@/lib/lcr.functions";
import { requireAcesso } from "@/lib/guard";
import { Search, ArrowRight, Upload, Plus, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/knowledge")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "knowledge", "/knowledge"),
  head: () => ({ meta: [{ title: "Base de Conhecimento — LCR Contábil" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["knowledge-hub"], queryFn: () => getKnowledgeHub() }),
  component: KnowledgePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const CATEGORIAS = [
  { v: "procedimento", l: "Procedimento" },
  { v: "decisao", l: "Decisão" },
  { v: "padrao", l: "Padrão" },
  { v: "faq", l: "FAQ" },
];

type Processo = { id: number; codigo: string; nome: string };

function ImportarDialog({ processos, open, onOpenChange }: { processos: Processo[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("procedimento");
  const [processoId, setProcessoId] = useState("none");
  const [tags, setTags] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() { setTitulo(""); setCategoria("procedimento"); setProcessoId("none"); setTags(""); setConteudo(""); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const texto = await file.text();
    setConteudo(texto);
    if (!titulo) setTitulo(file.name.replace(/\.(md|markdown|txt)$/i, ""));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function salvar() {
    if (!titulo.trim() || !conteudo.trim()) { toast.error("Informe título e conteúdo."); return; }
    setBusy(true);
    try {
      await criarArtigoConhecimento({ data: {
        titulo: titulo.trim(),
        conteudo_markdown: conteudo,
        categoria,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        processo_id: processoId === "none" ? null : Number(processoId),
      } });
      toast.success("Artigo adicionado à base.");
      qc.invalidateQueries({ queryKey: ["knowledge-hub"] });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Importar conhecimento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Título</label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Procedimento de fechamento" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Categoria</label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIAS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Processo (opcional)</label>
              <Select value={processoId} onValueChange={setProcessoId}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {processos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.codigo} — {p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tags (separadas por vírgula)</label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="conciliação, fechamento" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Conteúdo (Markdown)</label>
              <input ref={fileRef} type="file" accept=".md,.markdown,.txt" className="hidden" onChange={onFile} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" /> Carregar arquivo (.md/.txt)
              </Button>
            </div>
            <textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              rows={10}
              placeholder="Cole aqui o conteúdo do documento, ou carregue um arquivo .md/.txt"
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Adicionar à base"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgePage() {
  const { data } = useSuspenseQuery({ queryKey: ["knowledge-hub"], queryFn: () => getKnowledgeHub() });
  const [q, setQ] = useState("");
  const [area, setArea] = useState("all");
  const [importOpen, setImportOpen] = useState(false);

  const processos = useMemo(() => data.processos.filter((p) => {
    if (area !== "all" && p.area !== area) return false;
    if (q && !(`${p.codigo} ${p.nome} ${p.descricao ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }), [data.processos, q, area]);

  return (
    <>
      <PageHeader
        title="Base de"
        emphasis="Conhecimento"
        description="Processos, padrões e procedimentos da LCR. Pergunte ao Mestre no assistente (canto inferior direito)."
        actions={<Button onClick={() => setImportOpen(true)}><Plus className="mr-1 h-4 w-4" /> Importar conhecimento</Button>}
      />

      <ResumoTela itens={[
        { label: "Processos", value: data.processos.length },
        { label: "Áreas", value: data.areas.length },
        { label: "Artigos", value: data.artigos.length, tone: "ok" as const },
      ]} />

      {/* HERO — visão geral da base de conhecimento */}
      <div className="mb-5 relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-primary-foreground/70">Base de conhecimento LCR</div>
            <div className="mt-3 flex items-end gap-3">
              <span className="font-display text-6xl font-bold leading-none">{data.processos.length}</span>
              <span className="mb-2 text-xs text-primary-foreground/70">processos catalogados</span>
            </div>
            <div className="mt-2 text-xs text-primary-foreground/70">{data.areas.length} áreas · {data.artigos.length} artigo(s)</div>
          </div>
          <div className="grid max-w-md grid-cols-2 gap-2">
            {data.areas.slice(0, 6).map((a) => (
              <div key={a.area} className="rounded-xl bg-primary-foreground/8 px-3 py-2 text-xs">
                <div className="uppercase tracking-wider text-primary-foreground/60">{a.area}</div>
                <div className="mt-0.5 font-display text-lg font-bold">{a.total}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Card className="mb-6 rounded-3xl border-0 shadow-soft overflow-hidden">
        <div className="grid grid-cols-1 gap-3 border-b border-border p-4 md:grid-cols-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar processo" className="pl-8" />
          </div>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger><SelectValue placeholder="Área" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as áreas</SelectItem>
              {data.areas.map((a) => <SelectItem key={a.area} value={a.area}>{a.area} ({a.total})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Processo</TableHead>
              <TableHead className="w-36">Área</TableHead>
              <TableHead className="w-20 text-center">Passos</TableHead>
              <TableHead className="w-20 text-center">Artigos</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processos.map((p) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant="secondary">{p.codigo}</Badge></TableCell>
                <TableCell>
                  <div className="font-medium">{p.nome}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{p.descricao}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.area}</TableCell>
                <TableCell className="text-center text-sm">{p.passos}</TableCell>
                <TableCell className="text-center text-sm">{p.artigos}</TableCell>
                <TableCell className="text-right">
                  <Link to="/knowledge/processo/$codigo" params={{ codigo: p.codigo }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Abrir <ArrowRight className="h-3 w-3" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {processos.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum processo encontrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <h2 className="mb-3 flex items-center gap-2 font-display text-xl"><FileText className="h-5 w-5 text-primary" /> Artigos</h2>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead className="w-40">Categoria</TableHead>
              <TableHead>Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.artigos.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.titulo}</TableCell>
                <TableCell>{a.categoria ? <Badge variant="secondary">{a.categoria}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{(a.tags ?? []).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div></TableCell>
              </TableRow>
            ))}
            {data.artigos.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Nenhum artigo ainda. Use “Importar conhecimento” para adicionar conteúdo real.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <ImportarDialog processos={data.processos} open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

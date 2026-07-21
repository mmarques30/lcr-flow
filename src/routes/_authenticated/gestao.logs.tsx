import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAcesso } from "@/lib/guard";
import { analiseUso, analiseTempoRevisaoSci, fmtDuracao, telaLabel, ACAO_LABEL, type AnaliseUsuario } from "@/lib/logs.functions";
import { getHistoricoCerebro } from "@/lib/lcr.functions";
import { supabase } from "@/integrations/supabase/client";
import { Download, Users, Activity, Brain, Timer, Clock, MonitorSmartphone, ChevronDown, Workflow, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/gestao/logs")({
  beforeLoad: ({ context }) => requireAcesso(context.queryClient, "gestao:logs", "/gestao/logs"),
  head: () => ({ meta: [{ title: "Logs de uso — Gestão — LCR Contábil" }] }),
  component: LogsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

// Horários sempre convertidos pro fuso do navegador (o banco grava UTC).
const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });

function LogsPage() {
  const [dias, setDias] = useState(30);
  const [sel, setSel] = useState<AnaliseUsuario | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["analise-uso", dias],
    queryFn: () => analiseUso(dias),
    staleTime: 60_000,
  });
  const { data: cerebro } = useQuery({
    queryKey: ["historico-cerebro", "all", "all"],
    queryFn: () => getHistoricoCerebro({ data: {} }),
    staleTime: 60_000,
  });
  // #137 — tempo médio revisão → SCI (pausa após 5min de inatividade).
  const { data: tempoSci } = useQuery({
    queryKey: ["tempo-revisao-sci", dias],
    queryFn: () => analiseTempoRevisaoSci(dias),
    staleTime: 60_000,
  });
  // Nome dos clientes para os processos (id → nome curto)
  const { data: nomesClientes } = useQuery({
    queryKey: ["empresas-nomes"],
    queryFn: async () => {
      const { data: rows } = await supabase.from("empresas").select("id, razao_social, nome_fantasia");
      return new Map((rows ?? []).map((r) => [r.id, r.nome_fantasia ?? r.razao_social]));
    },
    staleTime: 10 * 60_000,
  });
  const nomeCliente = (id: string) => nomesClientes?.get(id) ?? id.slice(0, 8);

  const usuarios = data?.usuarios ?? [];

  function exportarCsv() {
    const rows = [["colaborador", "perfil", "ultimo_acesso", "sessoes", "tempo_total_min", "processos", "tempo_medio_processo_min", "clientes", "perguntas_cerebro", "top_tela", "pct_top_tela"]];
    for (const u of usuarios) {
      const tMedio = u.processos.length ? Math.round(u.processos.reduce((s, p) => s + p.duracao_ms, 0) / u.processos.length / 60000) : 0;
      rows.push([
        u.nome, u.perfil ?? "", u.ultimo_acesso ?? "", String(u.sessoes.length),
        String(Math.round(u.tempo_total_ms / 60000)), String(u.processos.length), String(tMedio),
        String(u.clientes_tocados), String(u.cerebro_perguntas),
        u.tempo_por_tela[0]?.tela ?? "", String(u.tempo_por_tela[0]?.pct ?? 0),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `uso-equipe-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado.");
  }

  return (
    <>
      <PageHeader
        title="Logs de"
        emphasis="uso"
        description="Quem acessou, o que fez, onde passou o tempo, o que perguntou ao Cérebro e quanto tempo levou por processo. Sessão = eventos com até 30min de intervalo; processo = bloco contínuo de trabalho num mesmo cliente."
        actions={
          <div className="flex items-center gap-2">
            <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportarCsv}><Download className="mr-1 h-4 w-4" /> CSV</Button>
          </div>
        }
      />

      {/* HERO — resumo do período */}
      <div className="mb-6 relative overflow-hidden rounded-3xl bg-deep p-7 text-primary-foreground">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-accent-lime/20 blur-3xl" />
        <div className="relative grid grid-cols-2 gap-6 md:grid-cols-4">
          <HeroStat icon={Users} label="Ativos hoje" value={String(data?.ativos_hoje ?? 0)} sub={`${usuarios.length} no período`} />
          <HeroStat icon={Timer} label="Tempo de uso" value={fmtDuracao(data?.tempo_total_ms ?? 0)} sub="soma da equipe" />
          <HeroStat icon={Activity} label="Eventos" value={String(data?.total_eventos ?? 0)} sub="ações registradas" />
          <HeroStat icon={Brain} label="Cérebro" value={String(data?.perguntas_cerebro ?? 0)} sub="perguntas feitas" />
        </div>
      </div>

      <Tabs defaultValue="pessoas">
        <TabsList className="mb-4">
          <TabsTrigger value="pessoas">Pessoas</TabsTrigger>
          <TabsTrigger value="atividade">Atividade</TabsTrigger>
          <TabsTrigger value="cerebro">Cérebro</TabsTrigger>
          <TabsTrigger value="produtividade">Produtividade</TabsTrigger>
          <TabsTrigger value="conciliacao-sci">Conciliação → SCI</TabsTrigger>
        </TabsList>

        {/* ── PESSOAS: tabela-resumo, clique abre trilha completa ── */}
        <TabsContent value="pessoas">
          <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Tempo</TableHead>
                  <TableHead className="text-right">Sessões</TableHead>
                  <TableHead className="text-right">Processos</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Cérebro</TableHead>
                  <TableHead>Tela principal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usuarios.map((u) => (
                  <TableRow key={u.user_id} className="cursor-pointer hover:bg-accent/10" onClick={() => setSel(u)}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{u.nome.slice(0, 2).toUpperCase()}</span>
                        <span className="font-medium">{u.nome}</span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">{u.perfil ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.ultimo_acesso ? fmtDataHora(u.ultimo_acesso) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{fmtDuracao(u.tempo_total_ms)}</TableCell>
                    <TableCell className="text-right">{u.sessoes.length}</TableCell>
                    <TableCell className="text-right">{u.processos.length}</TableCell>
                    <TableCell className="text-right">{u.clientes_tocados}</TableCell>
                    <TableCell className="text-right">{u.cerebro_perguntas}</TableCell>
                    <TableCell>
                      {u.tempo_por_tela[0] ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-24 truncate">{u.tempo_por_tela[0].tela}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${u.tempo_por_tela[0].pct}%` }} />
                          </div>
                          <span className="text-muted-foreground">{u.tempo_por_tela[0].pct}%</span>
                        </div>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {usuarios.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Nenhum evento no período."}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
              Clique numa linha para ver a trilha completa da pessoa: sessões, processos por cliente, onde passa o tempo e o que perguntou ao Cérebro.
            </div>
          </Card>
        </TabsContent>

        {/* ── ATIVIDADE: expansível por pessoa, tudo que fez, horário local ── */}
        <TabsContent value="atividade">
          <div className="space-y-2">
            {usuarios.map((u) => (
              <details key={u.user_id} className="group overflow-hidden rounded-2xl border-0 bg-card shadow-soft">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{u.nome.slice(0, 2).toUpperCase()}</span>
                  <span className="font-medium">{u.nome}</span>
                  <Badge variant="secondary">{u.eventos} eventos</Badge>
                  <span className="text-xs text-muted-foreground">último: {u.ultimo_acesso ? fmtDataHora(u.ultimo_acesso) : "—"}</span>
                  <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border">
                  <AtividadePessoa usuario={u} nomeCliente={nomeCliente} />
                </div>
              </details>
            ))}
            {usuarios.length === 0 && (
              <Card className="rounded-3xl border-0 p-10 text-center text-sm text-muted-foreground shadow-soft">Nenhum evento registrado ainda.</Card>
            )}
          </div>
        </TabsContent>

        {/* ── CÉREBRO ── */}
        <TabsContent value="cerebro">
          <Card className="rounded-3xl border-0 shadow-soft">
            <div className="divide-y divide-border">
              {(cerebro?.items ?? []).map((it) => (
                <details key={it.id} className="group px-5 py-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge variant="secondary" className="capitalize">{it.persona}</Badge>
                      <span className="text-sm font-medium">{it.consultor}</span>
                      {it.cliente && <span className="text-xs text-muted-foreground">· {it.cliente}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{it.created_at ? fmtDataHora(String(it.created_at)) : ""}</span>
                    </div>
                    <div className="mt-1 text-sm">{it.pergunta}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground group-open:hidden">{it.resposta}</div>
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-xs text-foreground">{it.resposta}</div>
                </details>
              ))}
              {(cerebro?.items ?? []).length === 0 && (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma interação com o Cérebro ainda.</div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* ── PRODUTIVIDADE: por processo executado ── */}
        <TabsContent value="produtividade">
          <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Colaborador</th>
                    <th className="px-3 py-2.5 text-right">Processos executados</th>
                    <th className="px-3 py-2.5 text-right">Tempo médio/processo</th>
                    <th className="px-3 py-2.5 text-right">Tempo em processos</th>
                    <th className="px-3 py-2.5 text-right">Clientes distintos</th>
                    <th className="px-3 py-2.5 text-right">Tempo total</th>
                    <th className="px-3 py-2.5 text-right">Cérebro</th>
                    <th className="px-3 py-2.5 text-right">Oportunidades</th>
                    <th className="px-4 py-2.5 text-left">Tela principal</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => {
                    const tProc = u.processos.reduce((s, p) => s + p.duracao_ms, 0);
                    const tMedio = u.processos.length ? tProc / u.processos.length : 0;
                    return (
                      <tr key={u.user_id} className="cursor-pointer border-t border-border hover:bg-accent/10" onClick={() => setSel(u)}>
                        <td className="px-4 py-2.5 font-medium">{u.nome}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{u.processos.length}</td>
                        <td className="px-3 py-2.5 text-right">{u.processos.length ? fmtDuracao(tMedio) : "—"}</td>
                        <td className="px-3 py-2.5 text-right">{u.processos.length ? fmtDuracao(tProc) : "—"}</td>
                        <td className="px-3 py-2.5 text-right">{u.clientes_tocados}</td>
                        <td className="px-3 py-2.5 text-right">{fmtDuracao(u.tempo_total_ms)}</td>
                        <td className="px-3 py-2.5 text-right">{u.cerebro_perguntas}</td>
                        <td className="px-3 py-2.5 text-right">{u.acoes["reportou_oportunidade"] ?? 0}</td>
                        <td className="px-4 py-2.5">
                          {u.tempo_por_tela[0] ? (
                            <span className="text-xs">{u.tempo_por_tela[0].tela} <span className="text-muted-foreground">({u.tempo_por_tela[0].pct}%)</span></span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {usuarios.length === 0 && (
                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">Sem atividade no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
              Processo = bloco contínuo de trabalho num mesmo cliente (início quando abre o cliente, fim quando troca de cliente ou para por 30min).
              É o tempo por processo executado — base do cálculo de ROI. Clique numa linha para ver os processos da pessoa.
            </div>
          </Card>
        </TabsContent>
        {/* ── CONCILIAÇÃO → SCI (#137): tempo ativo, pausa após 5min idle ── */}
        <TabsContent value="conciliacao-sci">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Card className="rounded-2xl border-0 p-4 shadow-soft">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> Tempo médio revisão → SCI</div>
              <div className="mt-1.5 font-display text-2xl font-bold">{tempoSci && tempoSci.amostras > 0 ? fmtDuracao(tempoSci.media_ms) : "—"}</div>
            </Card>
            <Card className="rounded-2xl border-0 p-4 shadow-soft">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Processos medidos</div>
              <div className="mt-1.5 font-display text-2xl font-bold">{tempoSci?.amostras ?? 0}</div>
            </Card>
            <Card className="rounded-2xl border-0 p-4 shadow-soft">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">SCI gerados no período</div>
              <div className="mt-1.5 font-display text-2xl font-bold">{tempoSci?.processos.length ?? 0}</div>
            </Card>
          </div>
          <Card className="rounded-3xl border-0 shadow-soft overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>SCI gerado</TableHead>
                  <TableHead className="text-right">Tempo ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...(tempoSci?.processos ?? [])].reverse().slice(0, 100).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{nomeCliente(p.cliente_id)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDataHora(p.inicio)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDataHora(p.fim)}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{p.duracao_ativa_ms > 0 ? fmtDuracao(p.duracao_ativa_ms) : "—"}</Badge></TableCell>
                  </TableRow>
                ))}
                {(tempoSci?.processos.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">Nenhum "Baixar SCI" registrado no período.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
              Tempo ativo = do primeiro evento de conciliação (abriu/analisou/finalizou/aprovou) até "Baixar SCI", somando só os intervalos ≤ 5min entre eventos — pausas maiores (aba aberta ociosa) não entram na conta.
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {sel && (
        <PainelPessoa
          usuario={sel}
          onClose={() => setSel(null)}
          nomeCliente={nomeCliente}
          cerebroItems={(cerebro?.items ?? []).filter((i) => i.consultor === sel.nome)}
        />
      )}
    </>
  );
}

function HeroStat({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary-foreground/70">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2 font-display text-4xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs text-primary-foreground/70">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 py-2 text-center">
      <div className="font-display text-base font-bold leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** Timeline de UMA pessoa agrupada por dia — tudo que fez, no horário local. */
function AtividadePessoa({ usuario, nomeCliente }: { usuario: AnaliseUsuario; nomeCliente: (id: string) => string }) {
  const porDia = useMemo(() => {
    const grupos = new Map<string, typeof usuario.logs>();
    for (const l of usuario.logs) {
      const dia = new Date(l.criado_em).toLocaleDateString("sv-SE"); // yyyy-mm-dd no fuso local
      const g = grupos.get(dia) ?? [];
      g.push(l);
      grupos.set(dia, g);
    }
    return [...grupos.entries()];
  }, [usuario.logs]);

  return (
    <div className="max-h-96 divide-y divide-border overflow-y-auto">
      {porDia.map(([dia, itens]) => (
        <div key={dia} className="px-5 py-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fmtDia(itens[0].criado_em)}</div>
          <div className="space-y-0.5">
            {itens.map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-xs">
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{fmtHora(l.criado_em)}</span>
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", l.acao === "perguntou_cerebro" ? "bg-violet-100 text-violet-700" : "bg-primary/8 text-primary")}>
                  {ACAO_LABEL[l.acao] ?? l.acao}
                </span>
                <span className="truncate text-muted-foreground">
                  {telaLabel(l.tela)}{l.cliente_id ? ` · ${nomeCliente(l.cliente_id)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PainelPessoa({ usuario, onClose, nomeCliente, cerebroItems }: {
  usuario: AnaliseUsuario;
  onClose: () => void;
  nomeCliente: (id: string) => string;
  cerebroItems: { id: number | string; persona: string; pergunta: string; created_at: unknown }[];
}) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary">
              {usuario.nome.slice(0, 2).toUpperCase()}
            </span>
            {usuario.nome}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-6 px-1">
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Tempo" value={fmtDuracao(usuario.tempo_total_ms)} />
            <MiniStat label="Sessões" value={String(usuario.sessoes.length)} />
            <MiniStat label="Processos" value={String(usuario.processos.length)} />
            <MiniStat label="Clientes" value={String(usuario.clientes_tocados)} />
          </div>

          {/* Processos por cliente — início → fim */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" /> Processos por cliente (início → fim)
            </h4>
            <div className="space-y-1">
              {[...usuario.processos].reverse().slice(0, 20).map((p, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                  <span className="w-32 shrink-0 truncate font-medium">{nomeCliente(p.cliente_id)}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtDataHora(p.inicio)} → {fmtHora(p.fim)}</span>
                  <Badge variant="secondary">{fmtDuracao(p.duracao_ms)}</Badge>
                  <span className="ml-auto truncate text-muted-foreground">{p.telas.slice(0, 2).join(" · ")}</span>
                </div>
              ))}
              {usuario.processos.length === 0 && <div className="text-xs text-muted-foreground">Nenhum processo em cliente no período.</div>}
            </div>
          </section>

          {/* Onde passa o tempo */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MonitorSmartphone className="h-3.5 w-3.5" /> Onde passa o tempo
            </h4>
            <div className="space-y-1.5">
              {usuario.tempo_por_tela.map((t) => (
                <div key={t.tela} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 truncate">{t.tela}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${t.pct}%` }} />
                  </div>
                  <span className="w-16 text-right text-muted-foreground">{fmtDuracao(t.ms)} · {t.pct}%</span>
                </div>
              ))}
            </div>
          </section>

          {/* Sessões */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Sessões de trabalho
            </h4>
            <div className="space-y-1">
              {[...usuario.sessoes].reverse().slice(0, 15).map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                  <span className="tabular-nums text-muted-foreground">{fmtDataHora(s.inicio)} → {fmtHora(s.fim)}</span>
                  <Badge variant="secondary">{fmtDuracao(s.duracao_ms)}</Badge>
                  <span className="ml-auto truncate text-muted-foreground">{s.telas.slice(0, 3).join(" · ")}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Ações */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ações no período</h4>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(usuario.acoes).sort((a, b) => b[1] - a[1]).map(([acao, n]) => (
                <Badge key={acao} variant="secondary">{ACAO_LABEL[acao] ?? acao}: {n}</Badge>
              ))}
            </div>
          </section>

          {/* Cérebro */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Brain className="h-3.5 w-3.5" /> O que perguntou ao Cérebro
            </h4>
            <div className="space-y-1.5">
              {cerebroItems.slice(0, 20).map((c) => (
                <div key={c.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <div className="mb-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="capitalize">{c.persona}</span>
                    <span>{c.created_at ? fmtDataHora(String(c.created_at)) : ""}</span>
                  </div>
                  {c.pergunta}
                </div>
              ))}
              {cerebroItems.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma pergunta registrada.</div>}
            </div>
          </section>

          {/* Trilha completa */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trilha recente</h4>
            <div className="space-y-0.5">
              {usuario.logs.slice(0, 60).map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDataHora(l.criado_em)}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", l.acao === "perguntou_cerebro" ? "bg-violet-100 text-violet-700" : "bg-primary/8 text-primary")}>
                    {ACAO_LABEL[l.acao] ?? l.acao}
                  </span>
                  <span className="truncate text-muted-foreground">{telaLabel(l.tela)}{l.cliente_id ? ` · ${nomeCliente(l.cliente_id)}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

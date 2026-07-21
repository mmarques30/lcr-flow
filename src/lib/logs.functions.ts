// Helpers para logs_uso — rastreamento de comportamento (não de mudanças
// de dado; para isso, ver audit_log). Backing da tela /gestao/logs.
import { supabase } from "@/integrations/supabase/client";
import { paginarTodas } from "@/lib/paginar";
import { bancoCodigoDe, buscarApelidosBanco, ehBancoPlaceholder, melhorContaBancaria } from "@/lib/sci-xls";

export type TrackAcao =
  | "login"
  | "logout"
  | "acessou_tela"
  | "viu_cliente"
  | "aprovou_lancamento"
  | "gerou_sci"
  | "perguntou_cerebro"
  | "reportou_oportunidade"
  | "abriu_conciliacao"
  | "analisou_divergencias"
  | "finalizou_conciliacao"
  | "importou_documento"
  | (string & {});

/**
 * Registra um evento de uso. Nunca lança — falhas são silenciosas para
 * não bloquear o fluxo do usuário. `user_id` vem da sessão atual.
 */
export async function trackAction(
  acao: TrackAcao,
  opts: { clienteId?: string | null; tela?: string; detalhes?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    await supabase.from("logs_uso").insert({
      user_id: userId,
      cliente_id: opts.clienteId ?? null,
      acao,
      tela: opts.tela ?? (typeof window !== "undefined" ? window.location.pathname : null),
      detalhes: (opts.detalhes ?? {}) as unknown as Record<string, string | number | boolean | null>,
    });
  } catch {
    // silencioso
  }
}

// ---------- rótulos ---------------------------------------------------------

export const ACAO_LABEL: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  acessou_tela: "Acessou tela",
  viu_cliente: "Abriu cliente",
  aprovou_lancamento: "Aprovou lançamento",
  gerou_sci: "Gerou SCI",
  perguntou_cerebro: "Perguntou ao Cérebro",
  reportou_oportunidade: "Reportou oportunidade",
  abriu_conciliacao: "Abriu conciliação",
  analisou_divergencias: "Analisou divergências",
  finalizou_conciliacao: "Finalizou conciliação",
  importou_documento: "Importou documento",
};

/** Converte pathname em nome amigável de área (agrega rotas com id). */
export function telaLabel(tela: string | null): string {
  if (!tela) return "—";
  const t = tela.toLowerCase();
  if (t === "/app" || t === "/") return "Início";
  if (t.startsWith("/clientes")) return "Carteira";
  if (t.startsWith("/tarefas")) return "Tarefas";
  if (t.startsWith("/documentos")) return "Documentos";
  if (t.startsWith("/lancamentos")) return "Lançamentos";
  if (t.startsWith("/conciliacao")) return "Conciliação";
  if (t.startsWith("/revisar")) return "Revisão de documento";
  if (t.startsWith("/consultive")) return "Consultivo";
  if (t.startsWith("/cx")) return "CX";
  if (t.startsWith("/mestre")) return "Mestre";
  if (t.startsWith("/knowledge")) return "Base de Conhecimento";
  if (t.startsWith("/historico")) return "Histórico Cérebro";
  if (t.startsWith("/gestao/logs")) return "Gestão · Logs";
  if (t.startsWith("/gestao/oport")) return "Gestão · Oportunidades";
  if (t.startsWith("/configuracoes")) return "Configurações";
  if (t.startsWith("/auth")) return "Login";
  return tela;
}

// ---------- consultas -------------------------------------------------------

export type LogRow = {
  id: string;
  user_id: string | null;
  cliente_id: string | null;
  acao: string;
  tela: string | null;
  detalhes: Record<string, unknown>;
  criado_em: string;
};

export async function listarLogsRecentes(params: {
  desde?: string;
  ate?: string;
  userId?: string;
  limit?: number;
} = {}): Promise<LogRow[]> {
  let q = supabase.from("logs_uso").select("*").order("criado_em", { ascending: false }).limit(params.limit ?? 2000);
  if (params.desde) q = q.gte("criado_em", params.desde);
  if (params.ate) q = q.lte("criado_em", params.ate);
  if (params.userId) q = q.eq("user_id", params.userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LogRow[];
}

// ---------- análise por pessoa ----------------------------------------------

/** Gap máximo entre eventos consecutivos pra contar como mesma sessão. */
const SESSAO_GAP_MS = 30 * 60_000;
/** Duração atribuída ao último evento de uma sessão (não há "próximo" pra medir). */
const ULTIMO_EVENTO_MS = 60_000;

export type SessaoUsuario = {
  inicio: string;
  fim: string;
  duracao_ms: number;
  eventos: number;
  telas: string[];
};

export type TempoTela = { tela: string; ms: number; pct: number };

/** Bloco contínuo de trabalho num mesmo cliente — base do tempo por processo. */
export type ProcessoCliente = {
  cliente_id: string;
  inicio: string;
  fim: string;
  duracao_ms: number;
  eventos: number;
  telas: string[];
};

export type AnaliseUsuario = {
  user_id: string;
  nome: string;
  perfil: string | null;
  eventos: number;
  ultimo_acesso: string | null;
  sessoes: SessaoUsuario[];
  tempo_total_ms: number;
  tempo_por_tela: TempoTela[];
  clientes_tocados: number;
  acoes: Record<string, number>;
  cerebro_perguntas: number;
  processos: ProcessoCliente[];
  logs: LogRow[]; // ordenados desc, para timeline individual
};

export type AnaliseGeral = {
  usuarios: AnaliseUsuario[];
  total_eventos: number;
  ativos_hoje: number;
  tempo_total_ms: number;
  perguntas_cerebro: number;
};

/**
 * Constrói a análise completa por usuário nos últimos N dias.
 * Sessões = eventos consecutivos com gap ≤ 30min. Tempo por tela =
 * diferença entre eventos consecutivos (capada no gap), atribuída à tela
 * do evento de origem. Tudo client-side — a equipe é pequena.
 */
export async function analiseUso(diasAtras = 30): Promise<AnaliseGeral> {
  const desde = new Date(Date.now() - diasAtras * 24 * 3600 * 1000).toISOString();
  const [{ data: logs, error: e1 }, { data: perfis, error: e2 }] = await Promise.all([
    supabase.from("logs_uso").select("*").gte("criado_em", desde).order("criado_em", { ascending: true }).limit(20000),
    supabase.from("usuarios_perfil").select("user_id, nome, perfil"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const infoPorUser = new Map((perfis ?? []).map((p) => [p.user_id, { nome: p.nome, perfil: p.perfil as string }]));
  const porUser = new Map<string, LogRow[]>();
  for (const l of (logs ?? []) as LogRow[]) {
    if (!l.user_id) continue;
    const arr = porUser.get(l.user_id) ?? [];
    arr.push(l);
    porUser.set(l.user_id, arr);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const usuarios: AnaliseUsuario[] = [];
  let totalEventos = 0, ativosHoje = 0, tempoTotalGeral = 0, perguntasCerebro = 0;

  for (const [userId, eventos] of porUser) {
    // eventos já estão asc
    const sessoes: SessaoUsuario[] = [];
    const tempoPorTela = new Map<string, number>();
    let sessAtual: { inicio: string; fim: string; eventos: number; telas: Set<string>; dur: number } | null = null;

    for (let i = 0; i < eventos.length; i++) {
      const ev = eventos[i];
      const prox = eventos[i + 1];
      const t0 = new Date(ev.criado_em).getTime();
      const gap = prox ? new Date(prox.criado_em).getTime() - t0 : Infinity;
      const durEvento = gap <= SESSAO_GAP_MS ? gap : ULTIMO_EVENTO_MS;

      const tela = telaLabel(ev.tela);
      tempoPorTela.set(tela, (tempoPorTela.get(tela) ?? 0) + durEvento);

      if (!sessAtual) {
        sessAtual = { inicio: ev.criado_em, fim: ev.criado_em, eventos: 1, telas: new Set([tela]), dur: durEvento };
      } else {
        sessAtual.fim = ev.criado_em;
        sessAtual.eventos++;
        sessAtual.telas.add(tela);
        sessAtual.dur += durEvento;
      }
      if (gap > SESSAO_GAP_MS) {
        sessoes.push({ inicio: sessAtual.inicio, fim: sessAtual.fim, duracao_ms: sessAtual.dur, eventos: sessAtual.eventos, telas: [...sessAtual.telas] });
        sessAtual = null;
      }
    }
    if (sessAtual) {
      sessoes.push({ inicio: sessAtual.inicio, fim: sessAtual.fim, duracao_ms: sessAtual.dur, eventos: sessAtual.eventos, telas: [...sessAtual.telas] });
    }

    const tempoTotal = sessoes.reduce((s, x) => s + x.duracao_ms, 0);
    const acoes: Record<string, number> = {};
    const clientes = new Set<string>();
    let cerebro = 0;
    for (const ev of eventos) {
      acoes[ev.acao] = (acoes[ev.acao] ?? 0) + 1;
      if (ev.cliente_id) clientes.add(ev.cliente_id);
      if (ev.acao === "perguntou_cerebro") cerebro++;
    }

    // Processos: blocos contínuos de eventos no MESMO cliente (gap ≤ sessão).
    // Início = primeiro evento no cliente, fim = último antes de trocar de
    // cliente ou fechar a sessão. É o proxy de "tempo por processo executado".
    const processos: ProcessoCliente[] = [];
    let proc: { cliente_id: string; inicio: string; fim: string; eventos: number; telas: Set<string>; dur: number } | null = null;
    for (let i = 0; i < eventos.length; i++) {
      const ev = eventos[i];
      const prox = eventos[i + 1];
      const gap = prox ? new Date(prox.criado_em).getTime() - new Date(ev.criado_em).getTime() : Infinity;
      const durEvento = gap <= SESSAO_GAP_MS ? gap : ULTIMO_EVENTO_MS;
      const tela = telaLabel(ev.tela);

      if (ev.cliente_id) {
        if (proc && proc.cliente_id === ev.cliente_id) {
          proc.fim = ev.criado_em; proc.eventos++; proc.telas.add(tela); proc.dur += durEvento;
        } else {
          if (proc) processos.push({ cliente_id: proc.cliente_id, inicio: proc.inicio, fim: proc.fim, duracao_ms: proc.dur, eventos: proc.eventos, telas: [...proc.telas] });
          proc = { cliente_id: ev.cliente_id, inicio: ev.criado_em, fim: ev.criado_em, eventos: 1, telas: new Set([tela]), dur: durEvento };
        }
      } else if (proc) {
        // saiu do cliente → fecha o processo
        processos.push({ cliente_id: proc.cliente_id, inicio: proc.inicio, fim: proc.fim, duracao_ms: proc.dur, eventos: proc.eventos, telas: [...proc.telas] });
        proc = null;
      }
      if (gap > SESSAO_GAP_MS && proc) {
        processos.push({ cliente_id: proc.cliente_id, inicio: proc.inicio, fim: proc.fim, duracao_ms: proc.dur, eventos: proc.eventos, telas: [...proc.telas] });
        proc = null;
      }
    }
    if (proc) processos.push({ cliente_id: proc.cliente_id, inicio: proc.inicio, fim: proc.fim, duracao_ms: proc.dur, eventos: proc.eventos, telas: [...proc.telas] });

    const tempoTelas: TempoTela[] = [...tempoPorTela.entries()]
      .map(([tela, ms]) => ({ tela, ms, pct: tempoTotal > 0 ? Math.round((ms / tempoTotal) * 100) : 0 }))
      .sort((a, b) => b.ms - a.ms);

    const info = infoPorUser.get(userId);
    const ultimo = eventos[eventos.length - 1]?.criado_em ?? null;
    if (ultimo && ultimo.slice(0, 10) === hoje) ativosHoje++;
    totalEventos += eventos.length;
    tempoTotalGeral += tempoTotal;
    perguntasCerebro += cerebro;

    usuarios.push({
      user_id: userId,
      nome: info?.nome ?? userId.slice(0, 8),
      perfil: info?.perfil ?? null,
      eventos: eventos.length,
      ultimo_acesso: ultimo,
      sessoes,
      tempo_total_ms: tempoTotal,
      tempo_por_tela: tempoTelas,
      clientes_tocados: clientes.size,
      acoes,
      cerebro_perguntas: cerebro,
      processos,
      logs: [...eventos].reverse(),
    });
  }

  usuarios.sort((a, b) => b.tempo_total_ms - a.tempo_total_ms);
  return { usuarios, total_eventos: totalEventos, ativos_hoje: ativosHoje, tempo_total_ms: tempoTotalGeral, perguntas_cerebro: perguntasCerebro };
}

// ---------- tempo revisão → SCI (#137) --------------------------------------

/** Após 5min sem nenhum dos eventos abaixo, considera o trabalho pausado —
 * o intervalo de inatividade não entra na duração ativa do processo. */
const IDLE_PAUSA_MS = 5 * 60_000;

const ACOES_REVISAO_SCI = new Set<string>([
  "abriu_conciliacao",
  "analisou_divergencias",
  "finalizou_conciliacao",
  "aprovou_lancamento",
  "gerou_sci",
]);

export type ProcessoRevisaoSci = {
  cliente_id: string;
  inicio: string;
  fim: string; // timestamp do gerou_sci que encerra o bloco
  duracao_ativa_ms: number;
};

/**
 * Duração ATIVA entre o início do trabalho de conciliação (abriu/analisou/
 * finalizou/aprovou) e a geração do SCI, por cliente. "Ativa" = soma dos
 * intervalos entre eventos consecutivos relevantes, pausando (não somando)
 * qualquer intervalo > 5min de inatividade — cliques/eventos resetam o
 * contador (escopo original do #137). Espera `logs` ordenados por
 * `criado_em` ASC (mesmo contrato de `analiseUso`); ordena internamente por
 * segurança.
 */
export function calcularTempoRevisaoSci(logs: readonly LogRow[]): ProcessoRevisaoSci[] {
  const porCliente = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!l.cliente_id || !ACOES_REVISAO_SCI.has(l.acao)) continue;
    const arr = porCliente.get(l.cliente_id) ?? [];
    arr.push(l);
    porCliente.set(l.cliente_id, arr);
  }

  const processos: ProcessoRevisaoSci[] = [];
  for (const [clienteId, eventosRaw] of porCliente) {
    const eventos = [...eventosRaw].sort((a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime());
    let inicioBloco: string | null = null;
    let duracaoAtiva = 0;
    for (let i = 0; i < eventos.length; i++) {
      const atual = eventos[i];
      if (inicioBloco === null) inicioBloco = atual.criado_em;
      if (atual.acao === "gerou_sci") {
        processos.push({ cliente_id: clienteId, inicio: inicioBloco, fim: atual.criado_em, duracao_ativa_ms: duracaoAtiva });
        inicioBloco = null;
        duracaoAtiva = 0;
        continue;
      }
      const prox = eventos[i + 1];
      if (!prox) break;
      const gap = new Date(prox.criado_em).getTime() - new Date(atual.criado_em).getTime();
      if (gap <= IDLE_PAUSA_MS) {
        duracaoAtiva += gap;
      } else {
        inicioBloco = null;
        duracaoAtiva = 0;
      }
    }
  }
  return processos;
}

/** Média da duração ativa — ignora processos sem nenhum evento prévio medível. */
export function mediaTempoRevisaoSci(processos: readonly ProcessoRevisaoSci[]): number {
  const comSinal = processos.filter((p) => p.duracao_ativa_ms > 0);
  if (comSinal.length === 0) return 0;
  return comSinal.reduce((s, p) => s + p.duracao_ativa_ms, 0) / comSinal.length;
}

export type AnaliseTempoRevisaoSci = {
  processos: ProcessoRevisaoSci[];
  media_ms: number;
  amostras: number;
};

/** Busca os eventos de revisão/SCI dos últimos N dias e calcula a métrica do #137. */
export async function analiseTempoRevisaoSci(diasAtras = 30): Promise<AnaliseTempoRevisaoSci> {
  const desde = new Date(Date.now() - diasAtras * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("logs_uso")
    .select("*")
    .in("acao", [...ACOES_REVISAO_SCI])
    .gte("criado_em", desde)
    .order("criado_em", { ascending: true })
    .limit(20000);
  if (error) throw error;
  const processos = calcularTempoRevisaoSci((data ?? []) as LogRow[]);
  const comSinal = processos.filter((p) => p.duracao_ativa_ms > 0);
  return { processos, media_ms: mediaTempoRevisaoSci(processos), amostras: comSinal.length };
}

export function fmtDuracao(ms: number): string {
  if (ms <= 0) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

// ---------- bancos não resolvidos (auditoria 21/07) -------------------------
//
// Substitui o audit script manual (scripts/_audit_bancos_todas_empresas.py,
// rodado sob demanda) por um relatório sempre-fresco na tela de gestão: cada
// empresa com conta bancária válida (não placeholder) cujo nome de banco não
// bate com nenhum alias de `bancos_apelidos_lcr` aparece aqui, pra alguém do
// time cadastrar o alias que falta (1 INSERT — sem deploy) ANTES de o cliente
// reclamar que a Planilha SCI saiu sem o código do banco.

export type BancoNaoResolvido = {
  empresa_id: string;
  nome: string;
  banco_texto: string;
};

export async function analiseBancosNaoResolvidos(): Promise<BancoNaoResolvido[]> {
  const [empresas, contas, apelidos] = await Promise.all([
    paginarTodas<{ id: string; razao_social: string | null; nome_fantasia: string | null }>(
      (offset, pageSize) => supabase.from("empresas").select("id,razao_social,nome_fantasia").range(offset, offset + pageSize - 1),
    ),
    paginarTodas<{ id: string; empresa_id: string; banco: string | null; created_at: string | null }>(
      (offset, pageSize) => supabase.from("contas_bancarias").select("id,empresa_id,banco,created_at").range(offset, offset + pageSize - 1),
    ),
    buscarApelidosBanco(),
  ]);

  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome_fantasia || e.razao_social || e.id]));
  const contasPorEmpresa = new Map<string, typeof contas>();
  for (const c of contas) {
    const arr = contasPorEmpresa.get(c.empresa_id) ?? [];
    arr.push(c);
    contasPorEmpresa.set(c.empresa_id, arr);
  }

  const naoResolvidos: BancoNaoResolvido[] = [];
  for (const [empresaId, contasEmpresa] of contasPorEmpresa) {
    if (contasEmpresa.every((c) => ehBancoPlaceholder(c.banco))) continue; // gap de dado (doc ainda não identificou o banco), não de dicionário
    const melhor = melhorContaBancaria(contasEmpresa);
    if (!melhor?.banco) continue;
    if (bancoCodigoDe(melhor.banco, apelidos) !== null) continue;
    naoResolvidos.push({ empresa_id: empresaId, nome: nomeEmpresa.get(empresaId) ?? empresaId, banco_texto: melhor.banco });
  }
  return naoResolvidos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

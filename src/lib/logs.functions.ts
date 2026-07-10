// Helpers para logs_uso — rastreamento de comportamento (não de mudanças
// de dado; para isso, ver audit_log). Backing da tela /gestao/logs.
import { supabase } from "@/integrations/supabase/client";

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

export function fmtDuracao(ms: number): string {
  if (ms <= 0) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

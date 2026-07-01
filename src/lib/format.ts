export function formatCNPJ(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

// Competência contábil "atual" = mês anterior ao calendário. O trabalho
// contábil de julho refere-se aos documentos/movimentações de junho — como
// no Gestta, quando o filtro de data mostra 01/07–31/07, os documentos que
// aparecem têm competência = Jun. Todos os defaults do sistema (dashboard,
// upload, lançamentos, painel do cliente) devem seguir essa convenção.
export function competenciaAtual(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Últimas N competências (mês/ano), da mais recente para a mais antiga.
// Começa na competência atual (mês anterior ao calendário) — mesmo critério
// de competenciaAtual(), então o usuário nunca vê no dropdown uma competência
// "adiantada" (que ainda não fechou no calendário contábil).
export function ultimasCompetencias(n = 12): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

// Converte um "mês do calendário" escolhido pelo usuário (ex: dropdown com
// meses do ano) em COMPETÊNCIA contábil (AAAA-MM), aplicando a regra:
// competência = mês do calendário - 1. Ex: selecionou Julho/2026 → 2026-06.
// Usado por qualquer selector mês/ano que representa o mês do calendário em
// que o trabalho está sendo feito (não a competência direta).
export function calendarioParaCompetencia(ano: number, mes: number): string {
  const d = new Date(ano, mes - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatCompetencia(c: string): string {
  const [y, m] = c.split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(m) - 1]}/${y}`;
}

export const REGIME_LABEL: Record<string, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
  mei: "MEI",
};

export const DOC_TIPO_LABEL: Record<string, string> = {
  extrato: "Extrato bancário",
  nf_entrada: "NF de entrada",
  nf_saida: "NF de saída",
  fatura_cartao: "Fatura de cartão",
  recibo: "Recibo",
  darf: "DARF",
  planilha_financeira: "Planilha financeira",
  movimento_contabil: "Movimento contábil",
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  recebido: "Recebido",
  classificado: "Classificado",
  processado: "Processado",
  conciliado: "Conciliado",
};

export const EMPRESA_STATUS_LABEL: Record<string, string> = {
  em_dia: "Em dia",
  cobranca: "Cobrança",
  lancamento: "Lançamento",
  conciliacao: "Conciliação",
  entregue: "Entregue",
  atrasado: "Atrasado",
};

export const CONCILIACAO_STATUS_LABEL: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  divergencias: "Com divergências",
  concluida: "Concluída",
};

export const LANCAMENTO_STATUS_LABEL: Record<string, string> = {
  gerada: "Planilha gerada",
  upload_leveldrive: "No LevelDrive",
  importada_sci: "Importada no SCI",
};

export const TAREFA_TIPO_LABEL: Record<string, string> = {
  cobranca: "Cobrança de Movimento Mensal",
  lancamentos: "Lançamentos Contábeis",
  conciliacao: "Conciliação e Balancete",
};

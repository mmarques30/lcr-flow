export function formatCNPJ(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function competenciaAtual(): string {
  const d = new Date();
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

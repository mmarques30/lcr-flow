/** Mensagens amigáveis para falhas de processamento de documentos. */

export type ErroDocumentoCode =
  | "PDF_SENHA"
  | "PDF_INVALIDO"
  | "EXCEL_CORROMPIDO"
  | "EXCEL_CRIPTOGRAFADO"
  | "EXCEL_INVALIDO"
  | "HISTORICO_INVALIDO"
  | "CONTA_INVALIDA"
  | "JSON_TRUNCADO"
  | "TIPO_NAO_SUPORTADO"
  | "ARQUIVO_AUSENTE"
  | "IA_FALHA"
  | "DESCONHECIDO";

export type ErroDocumentoInfo = {
  code: ErroDocumentoCode;
  titulo: string;
  detalhe?: string;
  acao: string;
  tecnico?: string;
};

type ClassificacaoErro = {
  error?: string;
  error_code?: string;
  error_acao?: string;
  error_detail?: string;
};

function asErro(ci: unknown): ClassificacaoErro | null {
  if (!ci || typeof ci !== "object") return null;
  const o = ci as ClassificacaoErro;
  if (!o.error && !o.error_code) return null;
  return o;
}

function classificarPorTexto(msg: string): ErroDocumentoCode {
  const m = msg.toLowerCase();
  if (
    m.includes("password protected") ||
    m.includes("protegido por senha") ||
    m.includes("pdf.source.base64") ||
    (m.includes("base64") && m.includes("pdf") && m.includes("invalid_request")) ||
    /\bsenha\b/.test(m) && m.includes(".pdf")
  ) return "PDF_SENHA";
  if (m.includes("base64") && m.includes("pdf")) return "PDF_INVALIDO";
  if (m.includes("workbook is encrypted") || m.includes("criptografad")) return "EXCEL_CRIPTOGRAFADO";
  if (m.includes("can't find workbook") || m.includes("ole2 compound")) return "EXCEL_CORROMPIDO";
  if (m.includes("conversão excel") || m.includes("conversao excel")) return "EXCEL_INVALIDO";
  if (m.includes("hist_sci_codigo_fkey")) return "HISTORICO_INVALIDO";
  if (m.includes("foreign key") || m.includes("violates foreign key")) return "HISTORICO_INVALIDO";
  if (m.includes("json") && (m.includes("válido") || m.includes("valido") || m.includes("trunc"))) return "JSON_TRUNCADO";
  if (m.includes("não suportado") || m.includes("nao suportado")) return "TIPO_NAO_SUPORTADO";
  if (m.includes("sem arquivo") || m.includes("falha ao baixar")) return "ARQUIVO_AUSENTE";
  return "DESCONHECIDO";
}

const CATALOG: Record<ErroDocumentoCode, Omit<ErroDocumentoInfo, "code" | "tecnico">> = {
  PDF_SENHA: {
    titulo: "PDF protegido por senha",
    detalhe: "O sistema não consegue ler este arquivo enquanto estiver bloqueado.",
    acao: "Solicite ao cliente reenviar o PDF sem senha ou exportado como PDF aberto.",
  },
  PDF_INVALIDO: {
    titulo: "PDF ilegível ou corrompido",
    acao: "Peça ao cliente reenviar o arquivo ou exportar novamente (PDF/imagem).",
  },
  EXCEL_CORROMPIDO: {
    titulo: "Planilha corrompida ou incompleta",
    acao: "Peça ao cliente reenviar em CSV ou PDF, ou baixar novamente do banco/sistema.",
  },
  EXCEL_CRIPTOGRAFADO: {
    titulo: "Planilha protegida por senha",
    acao: "Peça ao cliente reenviar sem senha ou em CSV/PDF.",
  },
  EXCEL_INVALIDO: {
    titulo: "Planilha em formato inválido",
    acao: "Peça ao cliente reenviar em CSV ou PDF.",
  },
  HISTORICO_INVALIDO: {
    titulo: "Histórico contábil inválido na classificação",
    acao: "Reprocesse o documento (após correção no plano) ou ajuste manualmente na revisão.",
  },
  CONTA_INVALIDA: {
    titulo: "Conta contábil inválida na classificação",
    acao: "Reprocesse ou corrija a conta na revisão manual.",
  },
  JSON_TRUNCADO: {
    titulo: "Resposta da IA incompleta",
    acao: "Reprocesse o documento — extratos muito grandes podem precisar de nova tentativa.",
  },
  TIPO_NAO_SUPORTADO: {
    titulo: "Tipo de arquivo não suportado",
    acao: "Envie PDF, imagem, CSV ou XML.",
  },
  ARQUIVO_AUSENTE: {
    titulo: "Arquivo não encontrado no storage",
    acao: "Reenvie o documento ou verifique o upload no Gestta.",
  },
  IA_FALHA: {
    titulo: "Falha temporária da IA",
    acao: "Tente reprocessar em alguns minutos.",
  },
  DESCONHECIDO: {
    titulo: "Falha no processamento",
    acao: "Revise o detalhe técnico ou reenvie o arquivo.",
  },
};

export function mensagemErroDocumento(ci: unknown): ErroDocumentoInfo | null {
  const o = asErro(ci);
  if (!o) return null;

  const tecnico = o.error_detail ?? o.error ?? "";
  let code = (o.error_code as ErroDocumentoCode | undefined) ?? classificarPorTexto(tecnico);
  if (code === "DESCONHECIDO" && /claude api|rate_limit|529|overloaded/i.test(tecnico)) {
    code = "IA_FALHA";
  }

  const base = CATALOG[code] ?? CATALOG.DESCONHECIDO;
  return {
    code,
    titulo: base.titulo,
    detalhe: o.error && o.error !== base.titulo ? o.error : undefined,
    acao: o.error_acao ?? base.acao,
    tecnico: tecnico || undefined,
  };
}

export function documentoComErroProcessamento(d: {
  status_processamento?: string | null;
  classificacao_ia?: unknown;
}): boolean {
  return d.status_processamento === "erro" || !!mensagemErroDocumento(d.classificacao_ia);
}

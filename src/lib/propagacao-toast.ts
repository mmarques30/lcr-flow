import { toast } from "sonner";

// #138: resultado da RPC propagar_lancamento_por_descricao, consumido pelos
// dois pontos de edição de lançamento (modal de conciliação e célula inline
// do painel). Centralizado aqui para não duplicar a lógica (e o texto) em
// dois arquivos — já achamos um bug de concordância verbal por duplicação.
export type ResultadoPropagacao = {
  propagados?: number;
  pulados_concluida?: number;
  pulados_confirmados?: number;
} | null | undefined;

function pl(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * Mostra os toasts do resultado da propagação retroativa (#138).
 * `mensagemBase`, se informada, é prefixada ao toast de sucesso (usado no
 * modal de edição, que sempre confirma a gravação; a edição inline do
 * painel não passa mensagem base para não poluir o UX de salvar-no-blur).
 */
export function avisarPropagacao(resultado: ResultadoPropagacao, mensagemBase?: string): void {
  const propagados = resultado?.propagados ?? 0;
  const puladosConcluida = resultado?.pulados_concluida ?? 0;
  const puladosConfirmados = resultado?.pulados_confirmados ?? 0;

  const partes: string[] = [];
  if (mensagemBase) partes.push(mensagemBase);
  if (propagados > 0) {
    partes.push(
      `Propagado para ${propagados} ${pl(propagados, "lançamento", "lançamentos")} em ${pl(propagados, "mês futuro", "meses futuros")}.`,
    );
  }
  if (partes.length > 0) toast.success(partes.join(" "));

  if (puladosConcluida > 0) {
    toast.warning(
      `${puladosConcluida} ${pl(puladosConcluida, "lançamento", "lançamentos")} em ${pl(puladosConcluida, "mês já concluído", "meses já concluídos")} não ${pl(puladosConcluida, "foi alterado", "foram alterados")} — revise manualmente se necessário.`,
    );
  }
  if (puladosConfirmados > 0) {
    toast.info(
      `${puladosConfirmados} ${pl(puladosConfirmados, "lançamento", "lançamentos")} já ${pl(puladosConfirmados, "confirmado manualmente", "confirmados manualmente")} em ${pl(puladosConfirmados, "mês futuro", "meses futuros")} não ${pl(puladosConfirmados, "foi sobrescrito", "foram sobrescritos")}.`,
    );
  }
}

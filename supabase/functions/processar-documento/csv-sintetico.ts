// #mover-geracao-csv-edge: quando o extrato bancário é enviado como PDF/imagem/
// XLSX (não é texto delimitável), processar-documento não sobe o arquivo binário
// como extrato_csv_url — `conciliar` (motor de saldo/faltantes) só sabe ler texto
// delimitado, e antes disso a conciliação ficava sem 2ª fonte independente
// (detectava o binário e caía no fallback lancamentos_ia). Em vez disso, gera um
// CSV sintético a partir dos lançamentos já classificados pela IA (rowsJanela).
//
// Mesmo formato de src/bridge_front.py::montar_csv_extrato ("data;descricao;
// valor;tipo", valor sempre em módulo, sinal só no tipo) — assim
// supabase/functions/conciliar/parse-csv.ts (sinalPorTipo) lê os dois formatos
// da mesma forma.
export type LancamentoParaCsv = {
  data_lancamento: string | null;
  descricao: string;
  valor: number;
  natureza_movimento: string | null;
};

export function montarCsvSintetico(rows: LancamentoParaCsv[]): string {
  const linhas = ["data;descricao;valor;tipo"];
  for (const r of rows) {
    const data = r.data_lancamento ?? "";
    const desc = (r.descricao ?? "").replace(/;/g, ",");
    const valor = Math.abs(r.valor).toFixed(2);
    const tipo = r.natureza_movimento ?? "";
    linhas.push(`${data};${desc};${valor};${tipo}`);
  }
  return linhas.join("\n");
}

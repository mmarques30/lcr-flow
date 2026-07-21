// Geração da planilha de importação SCI (.xls) por lançamento, no layout exato do
// modelo (config/08_-_Modelo_Planilha_Importacao_Lctos_SCI.xls): 11 colunas, uma
// linha por lançamento, códigos reduzidos SCI (plano_de_contas_lcr.apelido).
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

// banco (texto) → código LCR no plano de contas (contrapartida).
// Fallback local (auditoria 21/07) — usado só se a tabela `bancos_apelidos_lcr`
// não carregar. A fonte de verdade é a tabela: dá pra adicionar um banco novo
// com um INSERT, sem precisar de deploy (ver buscarApelidosBanco/ADR no spec).
// "pagseguro"/"pagbank" precisam vir ANTES de "inter": "PagSeguro Internet S/A"
// (nome legal oficial) contém "internet", que colidia com a chave "inter".
const BANCO_PARA_CODIGO_FALLBACK: Record<string, number> = {
  bradesco: 9, brasil: 7, "bb ": 7, caixa: 8, santander: 10, itau: 657,
  pagseguro: 946, pagbank: 946, inter: 658, sicoob: 659, sicredi: 775,
  original: 779, "nu pagamentos": 821, nubank: 821, "xp ": 823, c6: 809,
  stone: 910, btg: 1031, safra: 818, cora: 917, "mercado pago": 960,
  wise: 1292, bs2: 830, afinz: 1197, "208": 1031,
};

/** Busca os aliases de banco cadastrados em `bancos_apelidos_lcr` (fonte de
 *  verdade editável sem deploy — auditoria 21/07). Em caso de erro (rede,
 *  tabela vazia), cai no dicionário fallback embutido no código, então a
 *  resolução de banco nunca fica totalmente sem cobertura. */
export async function buscarApelidosBanco(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("bancos_apelidos_lcr").select("alias,codigo_lcr");
  if (error || !data || data.length === 0) return { ...BANCO_PARA_CODIGO_FALLBACK };
  const out: Record<string, number> = {};
  for (const row of data) {
    if (row.alias && typeof row.codigo_lcr === "number") out[row.alias] = row.codigo_lcr;
  }
  return out;
}
const TIPOS_DEBITO = ["ativo", "despesa", "custo", "deducoes"];
const TIPOS_CREDITO = ["passivo", "receita", "resultado", "patrimonio"];

// Cabeçalho EXATO do modelo SCI (ordem e acentuação importam).
export const COLUNAS = [
  "DATA", "DÉBITO", "CRÉDITO", "PART DÉB", "PART CRED", "VALOR",
  "HISTÓRICO", "COMPLEMENTO", "DOCUMENTO", "CENTRO DE CUSTO DÉB", "CENTRO DE CUSTO CRED",
];

export type SciLanc = {
  data_lancamento: string | null;
  valor: number | null;
  descricao: string | null;
  documento_numero?: string | null;
  part_deb?: string | null;
  part_cred?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; tipo: string | null } | null;
  historico: { codigo: string; pula_complemento?: boolean | null } | null;
};

/** Remove acentos (ex. "Itaú" → "itau") para comparação tolerante a diacríticos. */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Resolve o código LCR do banco a partir do nome da conta bancária.
 *  Bug 21/07: faltava normalizar acento — "Itaú" (cadastro real do cliente)
 *  nunca casava com a chave "itau" do dicionário, deixando o código do banco
 *  em branco na Planilha SCI mesmo com o nome aparecendo corretamente.
 *
 *  Entre vários aliases que casam por substring (ex. "inter" dentro de
 *  "PagSeguro Internet S/A"), escolhe o alias MAIS LONGO — é o critério mais
 *  robusto pra evitar colisão acidental sem depender da ordem de inserção da
 *  tabela/dicionário (achado auditoria 21/07: "pagseguro" tem que vencer
 *  "inter" nesse caso, e "pagseguro" também é o alias mais longo).
 *
 *  `apelidos` é opcional — se não informado, usa só o dicionário fallback
 *  embutido no código. Os call sites (painel.tsx, conciliação) devem buscar
 *  `buscarApelidosBanco()` e passar aqui, pra ler a tabela editável em vez
 *  do fallback estático. */
export function bancoCodigoDe(
  bancoNome: string | null | undefined,
  apelidos: Record<string, number> = BANCO_PARA_CODIGO_FALLBACK,
): number | null {
  const b = semAcento((bancoNome ?? "").toLowerCase());
  let melhorAlias = "";
  let melhorCodigo: number | null = null;
  for (const [nome, cod] of Object.entries(apelidos)) {
    const alias = semAcento(nome.trim());
    if (alias.length > melhorAlias.length && b.includes(alias)) {
      melhorAlias = alias;
      melhorCodigo = cod;
    }
  }
  return melhorCodigo;
}

/** Nome de banco "placeholder" — a IA não conseguiu identificar o banco no
 *  documento original (ex. "Não identificado", "Desconhecido", "N/A").
 *  Ampliado na auditoria de 21/07: "não disponível"/"não explícito" também
 *  são placeholders (ex. "Informação não disponível no documento") — antes
 *  passavam batido e entravam como "conta válida" no melhorContaBancaria,
 *  às vezes vencendo um registro anterior mais específico (regressão real
 *  encontrada no cliente PLENUS). */
export function ehBancoPlaceholder(banco: string | null | undefined): boolean {
  const t = semAcento((banco ?? "").trim().toLowerCase());
  if (!t || t === "n/a") return true;
  return ["identificado", "especificado", "desconhecido", "informado", "disponivel", "explicito"].some((p) =>
    t.includes(p),
  );
}

/** Escolhe a conta bancária "mais confiável" entre as cadastradas da empresa.
 *  Bug 21/07: o código sempre usava contas_bancarias[0] (a mais ANTIGA
 *  cadastrada) — se o primeiro documento processado falhou em identificar o
 *  banco (ex. "Não identificado"), a Planilha SCI ficava com o código do
 *  banco em branco pra sempre, mesmo com documentos posteriores tendo
 *  identificado o banco real corretamente (achado no cliente Cultive:
 *  1º registro "Não identificado", 2º "Banco Inter", mas o export usava o 1º).
 *  Agora prioriza o registro mais recente que NÃO seja placeholder; se todos
 *  forem placeholder, cai no comportamento anterior (mais recente mesmo assim,
 *  o que já é mais seguro do que fixar sempre no primeiro).
 *
 *  Fix (code review 20/07): o tie-break usava `reduce` percorrendo a ordem em
 *  que o array chegou, que não é determinística sem `created_at` (ou com
 *  `created_at` igual) — a ordem de retorno do Postgres sem `ORDER BY`
 *  explícito não é garantida. Agora ordena por (created_at, id) antes de
 *  escolher, então o resultado não depende mais da ordem de chegada. */
export function melhorContaBancaria<T extends { banco: string | null; created_at?: string | null; id?: string | number }>(
  contas: readonly T[],
): T | null {
  if (contas.length === 0) return null;
  const validas = contas.filter((c) => !ehBancoPlaceholder(c.banco));
  const candidatas = validas.length > 0 ? validas : contas;
  const ordenadas = [...candidatas].sort((a, b) => {
    const dA = a.created_at ?? "";
    const dB = b.created_at ?? "";
    if (dA !== dB) return dA < dB ? -1 : 1;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return ordenadas[ordenadas.length - 1] ?? null;
}

export function ladoConta(tipo: string | null): "debito" | "credito" {
  const t = (tipo ?? "").toLowerCase();
  if (TIPOS_DEBITO.some((x) => t.includes(x))) return "debito";
  if (TIPOS_CREDITO.some((x) => t.includes(x))) return "credito";
  return "debito"; // fallback conservador (igual ao Python)
}

// Inversão automática contábil. Decide em qual lado a CONTRAPARTIDA (a conta
// que não é o banco) entra. Ordem de prioridade:
//
//   1. natureza_movimento (vindo da IA na leitura do extrato — fonte de verdade):
//      - 'debito'  = banco debitou → saída do banco  → contrapartida no DÉBITO
//      - 'credito' = banco creditou → entrada no banco → contrapartida no CRÉDITO
//   2. sinal do valor com SIGNED valor (negativo = saída, positivo = entrada).
//   3. ladoConta (natureza por tipo de conta: despesa/ativo → débito,
//      receita/passivo → crédito).
//
// IMPORTANTE: o sistema persiste valor sempre absoluto. Para o passo 2
// disparar, é preciso passar o sinal explicitamente (callers que sabem o
// sinal pré-Math.abs podem fazer isso). Caso contrário, vai direto para
// ladoConta, que é o fallback SEGURO — antes o código retornava "credito"
// quando valor>0 (sempre) e gerava inversão errada em despesas (TRSS,
// ICMS, tarifas).
export function ladoEfetivo(args: { natureza?: string | null; valor?: number; tipoConta: string | null }): "debito" | "credito" {
  const n = (args.natureza ?? "").toLowerCase();
  if (n.startsWith("d")) return "debito";
  if (n.startsWith("c")) return "credito";
  // Só usa sinal do valor se foi passado explicitamente com sinal preservado.
  if (typeof args.valor === "number" && args.valor < 0) return "debito";
  // valor > 0 NÃO usa mais "credito" — quase todos os callers passam
  // Math.abs(valor), então essa heurística enviesava despesas para o crédito.
  return ladoConta(args.tipoConta);
}

// Mantida para compatibilidade (chamadas antigas que não passavam natureza).
export function ladoPorValor(valor: number, tipoConta: string | null): "debito" | "credito" {
  return ladoEfetivo({ valor, tipoConta });
}

/** Formato de data para prévia e export .xls (DD/MM/AAAA), conforme uso da equipe LCR. */
export function fmtDataPreview(d: string | null): string {
  if (!d) return "";
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
}

/** Mapa codigo LCR → código reduzido SCI (plano_de_contas_lcr.apelido, col A PDC). */
export function mapaPdcApelidos(
  rows: readonly { codigo: number; apelido: number | null }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.apelido != null) m.set(String(r.codigo), r.apelido);
  }
  return m;
}

/** Código reduzido SCI da conta: plano_de_contas_lcr.apelido; fallback no código LCR. */
export function codSciReduzido(
  codigoLcr: string | null | undefined,
  apelidos: Map<string, number>,
): number | string {
  const c = String(codigoLcr ?? "").trim();
  if (!c) return "";
  const ap = apelidos.get(c);
  if (ap != null) return ap;
  const n = Number(c);
  return Number.isNaN(n) ? c : n;
}

// ── #136: Contas T (sintética/título) e C (consolidada) não aceitam lançamento
// no SCI — só a analítica (filha) aceita. Ex.: T 29 "ADIANTAMENTO A SÓCIOS" →
// analítica 20 "Adiantamento a Sócios" (classificacao 01.1.2.07 → 01.1.2.07.001).
// Ex. C: 1170 "Aplicação - Banco XP Investimentos" (tipo C, 3 filhas) → ambígua,
// bloqueia export em vez de usar o código da própria conta-guarda-chuva.
const TIPOS_NAO_ANALITICOS = ["T", "C"];
export type PdcTC = { codigo: number; classificacao: string; tipo: string | null };
export type ResolucaoTC =
  | { status: "analitica" } // já é conta que aceita lançamento (tipo não é T nem C)
  | { status: "resolvido"; codigoResolvido: number } // T/C com filha analítica única
  | { status: "ambigua"; candidatos: number[] } // T/C com mais de uma filha analítica
  | { status: "sem_filha" }; // T/C sem nenhuma filha analítica cadastrada

/** Resolve uma conta sintética (T) ou consolidada (C) para sua filha analítica,
 *  via prefixo de `classificacao` (ex. "01.1.2.07" é prefixo de "01.1.2.07.001").
 *  Contas que já não são T/C retornam { status: "analitica" } sem nenhuma mudança. */
export function resolverContaAnalitica(codigo: string | number, pdc: readonly PdcTC[]): ResolucaoTC {
  const cod = Number(codigo);
  const conta = pdc.find((r) => r.codigo === cod);
  if (!conta || !TIPOS_NAO_ANALITICOS.includes(conta.tipo ?? "")) return { status: "analitica" };
  const prefixo = `${conta.classificacao}.`;
  const filhas = pdc.filter((r) => !TIPOS_NAO_ANALITICOS.includes(r.tipo ?? "") && r.classificacao.startsWith(prefixo));
  if (filhas.length === 0) return { status: "sem_filha" };
  if (filhas.length === 1) return { status: "resolvido", codigoResolvido: filhas[0].codigo };
  return { status: "ambigua", candidatos: filhas.map((f) => f.codigo).sort((a, b) => a - b) };
}

/** Compara duas `classificacao` (ex. "01.1.1.02.010" x "01.1.1.02.9") segmento a
 *  segmento, numericamente — ordenação alfabética simples (string) erra porque
 *  "10" < "9" como texto. Usado pra exibir o Plano de Contas na ordem real da
 *  planilha (pedido Mariana 20/07: "se ele fez ordem alfabética, não tá
 *  considerando o que é correto"), não em ordem alfabética/numérica do `codigo`. */
export function compararClassificacao(a: string, b: string): number {
  const partsA = a.split(".").map((s) => parseInt(s, 10));
  const partsB = b.split(".").map((s) => parseInt(s, 10));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = partsA[i] ?? -1;
    const nb = partsB[i] ?? -1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Profundidade hierárquica de uma `classificacao` (nº de segmentos) — usada pra
 *  indentar visualmente pai (T/C) x filha no Plano de Contas e no combobox de
 *  conta contábil (#hierarquia-tc, pedido Mariana 20/07). */
export function profundidadeClassificacao(classificacao: string): number {
  return classificacao.split(".").length;
}

/** Aplica resolverContaAnalitica e devolve o código final a usar no export —
 *  quando não há resolução automática (ambígua ou sem filha), mantém o
 *  código original (o bloqueio de export fica a cargo de validarLancamentosSci). */
export function codigoParaExportSci(codigo: string, pdc: readonly PdcTC[]): string {
  const r = resolverContaAnalitica(codigo, pdc);
  return r.status === "resolvido" ? String(r.codigoResolvido) : codigo;
}

/** Monta as linhas do layout SCI (uma por lançamento com conta).
 *  Débito/crédito usam código reduzido (plano_de_contas_lcr.apelido); banco = CC nº 1. */
export function linhasSci(
  lancs: SciLanc[],
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
  pdcTC: readonly PdcTC[] = [],
) {
  const bancoSci = bancoCodigoLcr != null ? codSciReduzido(String(bancoCodigoLcr), pdcApelidos) : "";
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      // #136: contas sintéticas (T) ou consolidadas (C) resolvem para a filha analítica antes do código reduzido.
      const conta = codSciReduzido(codigoParaExportSci(l.conta!.codigo, pdcTC), pdcApelidos);
      const banco: number | string = bancoSci;
      const valor = Number(l.valor ?? 0);
      // Inversão automática contábil: natureza_movimento (IA) > sinal > tipo.
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      const debito = ld === "debito" ? conta : banco;
      const credito = ld === "debito" ? banco : conta;
      return {
        "DATA": fmtDataPreview(l.data_lancamento),
        "DÉBITO": debito,
        "CRÉDITO": credito,
        "PART DÉB": l.part_deb ?? "",
        "PART CRED": l.part_cred ?? "",
        // SCI espera valor absoluto na coluna VALOR — o sinal já foi
        // refletido no posicionamento débito/crédito acima.
        "VALOR": Math.abs(valor),
        // HISTÓRICO = código oficial (historicos_sci_lcr.codigo). Apelido histórico desconsiderado.
        "HISTÓRICO": histSciCodigo(l.historico?.codigo),
        // Complemento dispensado quando o histórico tem PulaComplemento=Sim.
        "COMPLEMENTO": l.historico?.pula_complemento ? "" : (l.descricao ?? "").slice(0, 80),
        "DOCUMENTO": l.documento_numero ?? "",
        "CENTRO DE CUSTO DÉB": "",
        "CENTRO DE CUSTO CRED": "",
      };
    });
}

/** Gera e dispara o download do .xls de importação SCI (formato BIFF8, igual ao modelo). */
export function baixarPlanilhaSciXls(
  empresaNome: string,
  competencia: string,
  lancs: SciLanc[],
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
  pdcTC: readonly PdcTC[] = [],
): number {
  const rows = linhasSci(lancs, bancoCodigoLcr, pdcApelidos, pdcTC);
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUNAS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planilha de importação");
  const nome = `${empresaNome} - Lancamentos ${competencia}.xls`;
  XLSX.writeFile(wb, nome, { bookType: "biff8" });
  return rows.length;
}

// ── Prévia para a UI (mesmo layout do modelo, com código + nome p/ leitura) ──
export type SciLancRico = {
  id?: string;
  data_lancamento: string | null;
  valor: number | null;
  descricao: string | null;
  documento_numero?: string | null;
  part_deb?: string | null;
  part_cred?: string | null;
  natureza_movimento?: string | null;
  conta: { codigo: string; descricao: string; tipo: string | null } | null;
  historico: { codigo: string; descricao: string; pula_complemento?: boolean | null } | null;
};

// ── Validação pré-envio: bloqueia exportação se algum código de conta usado
// nos lançamentos não existir no Plano de Contas oficial LCR (Anexo 1). O caller
// consulta plano_de_contas_lcr e passa o set de códigos válidos.
export type SciInvalido = { id?: string; codigo: string; descricao: string | null; motivo?: string };
export function validarLancamentosSci(
  lancs: Array<{ id?: string; conta: { codigo: string; descricao?: string | null } | null }>,
  codigosValidos: Set<string>,
  pdcTC: readonly PdcTC[] = [],
): SciInvalido[] {
  const out: SciInvalido[] = [];
  for (const l of lancs) {
    const c = l.conta?.codigo;
    if (!c) continue;
    if (!codigosValidos.has(String(c))) {
      out.push({ id: l.id, codigo: String(c), descricao: l.conta?.descricao ?? null, motivo: "código fora do Plano de Contas oficial LCR" });
      continue;
    }
    // #136: conta sintética (T) ou consolidada (C) sem filha analítica única não pode ser exportada.
    if (pdcTC.length > 0) {
      const r = resolverContaAnalitica(c, pdcTC);
      if (r.status === "ambigua") {
        out.push({ id: l.id, codigo: String(c), descricao: l.conta?.descricao ?? null, motivo: `conta sintética/consolidada (T/C) com ${r.candidatos.length} filhas analíticas — reclassifique manualmente` });
      } else if (r.status === "sem_filha") {
        out.push({ id: l.id, codigo: String(c), descricao: l.conta?.descricao ?? null, motivo: "conta sintética/consolidada (T/C) sem filha analítica cadastrada" });
      }
    }
  }
  return out;
}

export type SciCelula = { codigo: number | string; nome: string };
export type SciPreviewRow = {
  id?: string;
  data: string;
  debito: SciCelula;
  credito: SciCelula;
  valor: number;
  historico: { codigo: string; nome: string };
  complemento: string;
  documento: string;
  part_deb: string;
  part_cred: string;
};

/** Código SCI do histórico: sempre historicos_sci_lcr.codigo (nunca sci_apelido). */
export function histSciCodigo(codigo: string | null | undefined): number | string {
  const c = (codigo ?? "").trim();
  if (!c) return "";
  const n = Number(c);
  return Number.isNaN(n) ? c : n;
}

/** Monta as linhas da prévia (uma por lançamento), reproduzindo o layout do modelo.
 *  Mesmos códigos reduzidos do export .xls (plano_de_contas_lcr.apelido). */
export function linhasSciPreview(
  lancs: SciLancRico[],
  bancoCodigoLcr: number | null | undefined,
  pdcApelidos: Map<string, number>,
  bancoNome: string,
  pdcTC: readonly PdcTC[] = [],
): SciPreviewRow[] {
  const bancoSci = bancoCodigoLcr != null ? codSciReduzido(String(bancoCodigoLcr), pdcApelidos) : "";
  return lancs
    .filter((l) => l.conta?.codigo)
    .map((l) => {
      // #136: mesma resolução T/C → filha analítica usada no export real, para a prévia bater com o .xls.
      const conta: SciCelula = {
        codigo: codSciReduzido(codigoParaExportSci(l.conta!.codigo, pdcTC), pdcApelidos),
        nome: l.conta!.descricao,
      };
      const banco: SciCelula = { codigo: bancoSci, nome: bancoNome || "Banco" };
      const valor = Number(l.valor ?? 0);
      const ld = ladoEfetivo({ natureza: l.natureza_movimento, valor, tipoConta: l.conta!.tipo });
      return {
        id: l.id,
        data: fmtDataPreview(l.data_lancamento),
        debito: ld === "debito" ? conta : banco,
        credito: ld === "debito" ? banco : conta,
        valor: Math.abs(valor),
        historico: {
          codigo: l.historico?.codigo ?? "",
          nome: l.historico?.descricao ?? "",
        },
        complemento: l.historico?.pula_complemento ? "" : (l.descricao ?? "").slice(0, 80),
        documento: (l.documento_numero ?? "").slice(0, 80),
        part_deb: (l.part_deb ?? "").slice(0, 40),
        part_cred: (l.part_cred ?? "").slice(0, 40),
      };
    });
}

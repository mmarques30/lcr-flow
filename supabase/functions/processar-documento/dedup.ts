// Helpers puros do dedup por IDENTIDADE (agência|conta|AAAA-MM), extraídos do index.ts
// para serem testáveis sem subir o Deno.serve. MESMA normalização do motor local
// (src/parsers/extrato_bancario.py). O banco NÃO entra na chave (o nº da conta já o
// identifica dentro do cliente). Ver dedup.test.ts.

export type LancRow = { data_lancamento?: string | null; valor?: number | null };

// Dígitos sem zeros à esquerda; null se vazio → não deduplica.
export function _digitosSemZeros(s: unknown): string | null {
  const d = String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}

// Conta canônica: dígitos, sem zeros à esquerda e SEM dígito verificador (grupo de
// 1-2 dígitos após separador -./espaço no fim). Espelha _norm_conta do Python — sem
// isto '33033-2' (local) vira '330332' e '33033' (IA soltou o DV) não casa.
export function _normConta(raw: unknown): string | null {
  const s = String(raw ?? "");
  const m = s.match(/[-./ ](\d{1,2})\s*$/);
  let dig = s.replace(/\D/g, "");
  if (m && dig.length > m[1].length) dig = dig.slice(0, -m[1].length);
  return dig.replace(/^0+/, "") || null;
}

// Lê agência/conta dos campos estruturados de topo (agencia/conta no schema) com
// fallback ao resumo free-form dados_extraidos (compat com docs antigos).
export function chaveExtrato(classificacao: Record<string, unknown>, competencia: string): string | null {
  const de = classificacao?.dados_extraidos;
  const obj = typeof de === "string"
    ? (() => { try { return JSON.parse(de); } catch { return {}; } })()
    : ((de ?? {}) as Record<string, unknown>);
  const ag = _digitosSemZeros(classificacao?.agencia ?? obj.agencia);
  const ct = _normConta(classificacao?.conta ?? classificacao?.conta_corrente ?? obj.conta ?? obj.conta_corrente);
  const comp = (competencia ?? "").slice(0, 7);
  if (!ag || !ct || comp.length !== 7) return null;
  return `${ag}|${ct}|${comp}`;
}

// #4: investimento fica FORA do dedup por identidade. A chave é agência|conta|mês
// SEM banco, então um CDB (mesmo se a IA o tipar como extrato_bancario) colidiria
// com a CC do mesmo mês; com overlap>=60% seria marcado duplicata e perderia razão.
// Movimento de investimento gera razão própria — não deve ser deduplicado contra a CC.
// Mesma lista de termos que o roteamento usa (detectar_tipo no motor local).
export const INVESTIMENTO_KW = ["posic", "posiç", "investiment", "aplicac", "aplicaç",
                                "renda fixa", "renda-fixa", "cdb"];
export function _ehInvestimentoNome(nome: unknown): boolean {
  const n = String(nome ?? "").toLowerCase();
  return INVESTIMENTO_KW.some((k) => n.includes(k));
}

// Confirma dedup por identidade: a chave (agência|conta|mês) NÃO inclui o banco, então
// dois bancos com mesma ag/conta/mês colidiriam. Antes de marcar duplicata, exigimos
// sobreposição real das transações (mesmo extrato ~100%; colisão de chave ~0%).
export const OVERLAP_MIN_DEDUP = 0.6;

export function _assinLanc(rows: LancRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows ?? []) {
    const v = Number(r?.valor);
    if (!Number.isFinite(v)) continue;
    const d = String(r?.data_lancamento ?? "").slice(0, 10);
    s.add(`${d}|${(Math.round(Math.abs(v) * 100) / 100).toFixed(2)}`);
  }
  return s;
}

export function _sobreposicao(aRows: LancRow[], bRows: LancRow[]): number {
  const a = _assinLanc(aRows), b = _assinLanc(bRows);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

// Decisão de dedup do edge, isolada p/ teste: replica a lógica do index.ts.
// Retorna a chave a usar na busca de original (null = NÃO deduplica). Investimento e
// não-extrato-bancário nunca deduplicam.
export function chaveDedupParaDoc(
  isExtratoBancario: boolean,
  arquivoNome: unknown,
  classificacao: Record<string, unknown>,
  competencia: string,
): string | null {
  if (!isExtratoBancario || _ehInvestimentoNome(arquivoNome)) return null;
  return chaveExtrato(classificacao, competencia);
}

// Marca duplicata? Só quando há chave, existe original E as transações se sobrepõem
// o suficiente (>= OVERLAP_MIN_DEDUP). Espelha o guard do index.ts.
export function deveMarcarDuplicata(
  chaveDedup: string | null,
  temOriginal: boolean,
  origLancs: LancRow[],
  novasLinhas: LancRow[],
): boolean {
  if (!chaveDedup || !temOriginal) return false;
  if ((origLancs?.length ?? 0) === 0) return false;
  return _sobreposicao(novasLinhas, origLancs) >= OVERLAP_MIN_DEDUP;
}

// Dedup tipo A: linhas repetidas no MESMO documento (mesma data+valor).
// Mantém a 1ª ocorrência; descarta as demais antes do insert.
export function chaveIntraDoc(r: LancRow): string | null {
  const v = Number(r?.valor);
  if (!Number.isFinite(v)) return null;
  const d = String(r?.data_lancamento ?? "").slice(0, 10);
  if (!d) return null;
  return `${d}|${(Math.round(Math.abs(v) * 100) / 100).toFixed(2)}`;
}

export function dedupIntraDocumento<T extends LancRow>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items ?? []) {
    const k = chaveIntraDoc(item);
    if (!k) {
      out.push(item);
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

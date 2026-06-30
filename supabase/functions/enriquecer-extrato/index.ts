// Edge Function: enriquecer-extrato
// Para cada lançamento gerado a partir do extrato (fonte_extrato=true) e ainda
// não enriquecido, procura um documento suporte (NF, recibo, planilha,
// comprovante) da mesma empresa+competência cujo valor e data batam, e usa
// os dados extraídos pela IA do doc suporte (participante, nº NF) para
// enriquecer o lançamento. Critérios de match: valor exato (±0.01) + data
// dentro de ±3 dias.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string) => json(200, { ok: false, error });

type DadosExtraidos = Record<string, unknown>;

function pickStr(o: DadosExtraidos | null, chaves: string[]): string | null {
  if (!o || typeof o !== "object") return null;
  for (const k of chaves) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  }
  return null;
}

function pickNum(o: DadosExtraidos | null, chaves: string[]): number | null {
  if (!o || typeof o !== "object") return null;
  for (const k of chaves) {
    const v = o[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickDate(o: DadosExtraidos | null, chaves: string[]): string | null {
  if (!o || typeof o !== "object") return null;
  for (const k of chaves) {
    const v = o[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function diffDias(a: string, b: string): number {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 99999;
  return Math.round(Math.abs(t1 - t2) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: { empresa_id?: string; competencia?: string; force?: boolean };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  if (!body.empresa_id) return fail("empresa_id obrigatório");

  const competencia = body.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const [{ data: lancs }, { data: docs }] = await Promise.all([
    admin.from("lancamentos")
      .select("id, valor, data_lancamento, descricao, enriquecido, fonte_extrato")
      .eq("empresa_id", body.empresa_id)
      .eq("competencia", competencia)
      .eq("fonte_extrato", true),
    admin.from("documentos")
      .select("id, tipo, arquivo_nome, classificacao_ia, dados_extraidos, recebido_em")
      .eq("empresa_id", body.empresa_id)
      .eq("competencia", competencia)
      .neq("tipo", "extrato"),
  ]);

  type Lanc = { id: string; valor: number | null; data_lancamento: string | null; descricao: string | null; enriquecido: boolean };
  type Doc = { id: string; tipo: string; arquivo_nome: string | null; classificacao_ia: Record<string, unknown> | null; dados_extraidos: Record<string, unknown> | null };

  const lancsTyped = (lancs ?? []) as Lanc[];
  const docsTyped = (docs ?? []) as Doc[];

  // Pré-processa cada documento suporte extraindo o que importa
  type DocPronto = { id: string; tipo: string; valor: number | null; data: string | null; participante: string | null; numero: string | null };
  const docsProntos: DocPronto[] = docsTyped.map((d) => {
    const ci = (d.classificacao_ia && typeof d.classificacao_ia === "object" ? (d.classificacao_ia as { dados_extraidos?: unknown }).dados_extraidos : null) as DadosExtraidos | null;
    const dados = (ci ?? d.dados_extraidos ?? null) as DadosExtraidos | null;
    return {
      id: d.id,
      tipo: d.tipo,
      valor: pickNum(dados, ["valor_total", "valor_servico", "valor", "total"]),
      data: pickDate(dados, ["data_emissao", "data", "data_documento", "data_pagamento", "competencia_servico"]) ?? d.recebido_em?.slice(0, 10) ?? null,
      participante: pickStr(dados, ["fornecedor", "emitente", "tomador", "cliente", "prestador", "razao_social", "empresa", "destinatario", "favorecido", "recebedor"]),
      numero: pickStr(dados, ["numero_nf", "numero", "nf", "documento", "invoice_numero", "nfs_e_numero"]),
    };
  });

  // Para cada lançamento sem enriquecimento, busca o melhor match
  let enriquecidos = 0;
  for (const l of lancsTyped) {
    if (!body.force && l.enriquecido) continue;
    if (l.valor == null || !l.data_lancamento) continue;

    let melhor: { doc: DocPronto; score: number } | null = null;
    for (const d of docsProntos) {
      if (d.valor == null || !d.data) continue;
      const valorOk = Math.abs(Math.abs(d.valor) - Math.abs(Number(l.valor))) <= 0.01;
      if (!valorOk) continue;
      const dias = diffDias(d.data, l.data_lancamento);
      if (dias > 3) continue;
      const score = 100 - dias * 10 + (d.participante ? 5 : 0) + (d.numero ? 5 : 0);
      if (!melhor || score > melhor.score) melhor = { doc: d, score };
    }

    if (melhor) {
      const patch: Record<string, unknown> = {
        enriquecido: true,
        documento_suporte_id: melhor.doc.id,
      };
      if (melhor.doc.participante) patch.participante = melhor.doc.participante.slice(0, 200);
      if (melhor.doc.numero) patch.documento_numero = melhor.doc.numero.slice(0, 80);
      const { error } = await admin.from("lancamentos").update(patch).eq("id", l.id);
      if (!error) enriquecidos++;
    }
  }

  const semSuporte = lancsTyped.filter((l) => !l.enriquecido && !lancsTyped.find((x) => x.id === l.id && x.enriquecido)).length;
  return json(200, {
    ok: true,
    competencia,
    total_lancamentos: lancsTyped.length,
    enriquecidos,
    sem_suporte: Math.max(0, lancsTyped.length - enriquecidos),
    docs_suporte_disponiveis: docsProntos.length,
  });
});

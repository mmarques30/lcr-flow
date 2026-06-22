import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { TODAS_CHAVES } from "@/lib/acessos";

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("usuarios_perfil").select("perfil").eq("user_id", userId).maybeSingle();
  if (data?.perfil !== "admin") throw new Error("Apenas administradores.");
}

const competenciaInput = z.object({ competencia: z.string().optional() }).optional();

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const competencia = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    const [empresas, docsAguardando, lancamentosMes, conciliacoesPendentes, fases, atencaoUrgente, docsRows, conciliacoesRows, tarefasRows] = await Promise.all([
      supabase.from("empresas").select("id", { count: "exact", head: true }),
      supabase.from("documentos").select("id", { count: "exact", head: true }).in("status", ["recebido", "classificado"]),
      supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("competencia", competencia),
      supabase.from("conciliacoes").select("id", { count: "exact", head: true }).eq("competencia", competencia).neq("status", "concluida"),
      supabase.from("empresas").select("status"),
      supabase
        .from("empresas")
        .select("id, razao_social, status, tags")
        .in("status", ["atrasado", "cobranca"])
        .limit(8),
      supabase.from("documentos").select("status"),
      supabase.from("conciliacoes").select("status"),
      supabase.from("tarefas").select("status"),
    ]);

    const faseCounts: Record<string, number> = { cobranca: 0, lancamento: 0, conciliacao: 0, entregue: 0 };
    (fases.data ?? []).forEach((row) => {
      if (row.status in faseCounts) faseCounts[row.status]++;
      else if (row.status === "atrasado") faseCounts.cobranca++;
      else if (row.status === "em_dia") faseCounts.entregue++;
    });

    const countBy = (rows: { status: string }[] | null, keys: string[]) => {
      const acc: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
      (rows ?? []).forEach((r) => { if (r.status in acc) acc[r.status]++; });
      return acc;
    };

    const docsByStatus = countBy(docsRows.data, ["recebido", "classificado", "processado", "conciliado", "erro"]);
    const conciliacoesByStatus = countBy(conciliacoesRows.data, ["nao_iniciada", "em_andamento", "divergencias", "concluida"]);
    const totalDocs = (docsRows.data ?? []).length;
    const totalConciliacoes = (conciliacoesRows.data ?? []).length;
    const tarefasAbertas = (tarefasRows.data ?? []).filter((t) => !["done", "concluida"].includes(t.status)).length;

    return {
      competencia,
      clientesAtivos: empresas.count ?? 0,
      docsAguardando: docsAguardando.count ?? 0,
      lancamentosMes: lancamentosMes.count ?? 0,
      conciliacoesPendentes: conciliacoesPendentes.count ?? 0,
      tarefasAbertas,
      totalDocs,
      totalConciliacoes,
      atencaoUrgente: atencaoUrgente.data ?? [],
      fases: [
        { fase: "Cobrança", total: faseCounts.cobranca },
        { fase: "Lançamento", total: faseCounts.lancamento },
        { fase: "Conciliação", total: faseCounts.conciliacao },
        { fase: "Entrega", total: faseCounts.entregue },
      ],
      docsByStatus: [
        { label: "Recebido", key: "recebido", total: docsByStatus.recebido },
        { label: "Classificado", key: "classificado", total: docsByStatus.classificado },
        { label: "Processado", key: "processado", total: docsByStatus.processado },
        { label: "Conciliado", key: "conciliado", total: docsByStatus.conciliado },
        { label: "Erro", key: "erro", total: docsByStatus.erro },
      ],
      conciliacoesByStatus: [
        { label: "Não iniciada", key: "nao_iniciada", total: conciliacoesByStatus.nao_iniciada },
        { label: "Em andamento", key: "em_andamento", total: conciliacoesByStatus.em_andamento },
        { label: "Divergências", key: "divergencias", total: conciliacoesByStatus.divergencias },
        { label: "Concluída", key: "concluida", total: conciliacoesByStatus.concluida },
      ],
    };
  });

export const listEmpresas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, cnpj, regime, segmento, status, tags, consultor_id, usuarios_perfil:consultor_id(nome)")
      .order("razao_social");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getEmpresa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: empresa, error } = await context.supabase
      .from("empresas")
      .select("*, contas_bancarias(*), documentos_esperados(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!empresa) throw new Error("Empresa não encontrada");
    return empresa;
  });

const createEmpresaSchema = z.object({
  razao_social: z.string().min(2).max(200),
  nome_fantasia: z.string().max(200).optional().nullable(),
  cnpj: z.string().min(14).max(20),
  regime: z.enum(["simples", "presumido", "real", "mei"]),
  segmento: z.string().max(100).optional().nullable(),
  consultor_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  contas: z
    .array(z.object({ banco: z.string().min(1).max(80), agencia: z.string().min(1).max(20), conta: z.string().min(1).max(30) }))
    .max(20)
    .default([]),
  documentos_esperados: z.array(z.string()).default([]),
});

export const createEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createEmpresaSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: emp, error } = await supabase
      .from("empresas")
      .insert({
        razao_social: data.razao_social,
        nome_fantasia: data.nome_fantasia ?? null,
        cnpj: data.cnpj,
        regime: data.regime,
        segmento: data.segmento ?? null,
        consultor_id: data.consultor_id ?? null,
        tags: data.tags,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.contas.length) {
      await supabase.from("contas_bancarias").insert(data.contas.map((c) => ({ ...c, empresa_id: emp.id })));
    }
    if (data.documentos_esperados.length) {
      await supabase.from("documentos_esperados").insert(
        data.documentos_esperados.map((tipo) => ({ empresa_id: emp.id, tipo: tipo as never, obrigatorio: true })),
      );
    }
    return emp;
  });

export const updateEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      razao_social: z.string().min(2).max(200),
      nome_fantasia: z.string().max(200).optional().nullable(),
      cnpj: z.string().min(14).max(20),
      regime: z.enum(["simples", "presumido", "real", "mei"]),
      segmento: z.string().max(100).optional().nullable(),
      consultor_id: z.string().uuid().optional().nullable(),
      tags: z.array(z.string().max(50)).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("empresas")
      .update({
        razao_social: patch.razao_social,
        nome_fantasia: patch.nome_fantasia ?? null,
        cnpj: patch.cnpj,
        regime: patch.regime,
        segmento: patch.segmento ?? null,
        consultor_id: patch.consultor_id ?? null,
        tags: patch.tags,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("empresas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDocumentos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("documentos")
      .select("id, tipo, competencia, origem, status, arquivo_nome, arquivo_url, dados_extraidos, recebido_em, empresa:empresa_id(id, razao_social), responsavel:responsavel_id(nome)")
      .order("recebido_em", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createDocSchema = z.object({
  empresa_id: z.string().uuid(),
  tipo: z.enum(["extrato", "nf_entrada", "nf_saida", "fatura_cartao", "recibo", "darf", "planilha_financeira", "movimento_contabil"]),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  competencia_id: z.string().uuid().optional().nullable(),
  arquivo_nome: z.string().max(255).optional().nullable(),
  arquivo_url: z.string().max(1024).optional().nullable(),
  arquivo_tamanho_bytes: z.number().int().nonnegative().optional().nullable(),
});

export const createDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createDocSchema.parse(d))
  .handler(async ({ context, data }) => {
    // resolve o perfil do usuário autenticado para gravar como responsável
    const { data: perfil } = await context.supabase
      .from("usuarios_perfil")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: doc, error } = await context.supabase
      .from("documentos")
      .insert({
        empresa_id: data.empresa_id,
        tipo: data.tipo,
        competencia: data.competencia,
        competencia_id: data.competencia_id ?? null,
        arquivo_nome: data.arquivo_nome ?? null,
        arquivo_url: data.arquivo_url ?? null,
        arquivo_tamanho_bytes: data.arquivo_tamanho_bytes ?? null,
        origem: "upload_manual",
        status: "recebido",
        responsavel_id: perfil?.id ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return doc;
  });

// Garante a competência (empresa_id, primeiro dia do mês 'YYYY-MM') e retorna o id.
export const ensureCompetencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ empresa_id: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const periodo = `${data.competencia}-01`;
    const { data: existing } = await context.supabase
      .from("competencias")
      .select("id")
      .eq("empresa_id", data.empresa_id)
      .eq("periodo", periodo)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: created, error } = await context.supabase
      .from("competencias")
      .insert({ empresa_id: data.empresa_id, periodo, status: "aberta" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const setDocumentoStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "recebido" | "classificado" | "processado" | "conciliado" }) =>
    z.object({ id: z.string().uuid(), status: z.enum(["recebido", "classificado", "processado", "conciliado"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("documentos").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLancamentosAgrupados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const competencia = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const [{ data: empresas }, { data: docs }, { data: lanc }] = await Promise.all([
      context.supabase.from("empresas").select("id, razao_social"),
      context.supabase.from("documentos").select("empresa_id, status").eq("competencia", competencia),
      context.supabase.from("lancamentos").select("id, empresa_id, competencia, status, total_lancamentos, planilha_url, importado_em, created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const docsByEmpresa = new Map<string, number>();
    (docs ?? []).forEach((d) => {
      if (d.status === "processado" || d.status === "classificado") docsByEmpresa.set(d.empresa_id, (docsByEmpresa.get(d.empresa_id) ?? 0) + 1);
    });
    return {
      competencia,
      grupos: (empresas ?? []).map((e) => ({ ...e, prontos: docsByEmpresa.get(e.id) ?? 0 })),
      historico: lanc ?? [],
    };
  });

export type SciLinha = { codigo: string; descricao: string; tipo: string; total: number };

// Gera a planilha SCI agregando os lançamentos reais por conta dentro da
// competência (SUM(valor) GROUP BY conta) — sem dados aleatórios. Os números
// retornados são os mesmos exportados em CSV e exibidos na conciliação.
export const gerarPlanilhaSci = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string; competencia: string }) =>
    z.object({ empresa_id: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    // Agregação por conta via RPC (mesma query da spec).
    const rpc = context.supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: SciLinha[] | null; error: { message: string } | null }>;
    const { data: linhasRaw, error: aggError } = await rpc("sci_planilha", {
      p_empresa_id: data.empresa_id,
      p_competencia: data.competencia,
    });
    if (aggError) throw new Error(aggError.message);
    const linhas: SciLinha[] = (linhasRaw ?? []).map((r) => ({
      codigo: r.codigo,
      descricao: r.descricao,
      tipo: r.tipo,
      total: Number(r.total),
    }));
    const totalValor = linhas.reduce((s, l) => s + l.total, 0);

    // Quantidade de lançamentos reais agregados (linhas individuais com conta).
    const { count: totalLancamentos } = await context.supabase
      .from("lancamentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", data.empresa_id)
      .eq("competencia", data.competencia)
      .not("conta_id", "is", null);

    // Registra a planilha gerada (resumo) no histórico de lançamentos.
    const { data: doc, error } = await context.supabase
      .from("lancamentos")
      .insert({
        empresa_id: data.empresa_id,
        competencia: data.competencia,
        status: "gerada",
        total_lancamentos: totalLancamentos ?? 0,
        linhas_count: linhas.length,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      id: doc.id,
      competencia: data.competencia,
      total_lancamentos: totalLancamentos ?? 0,
      total_valor: totalValor,
      linhas,
    };
  });

// Registra uma planilha SCI enviada manualmente ao Storage como um lançamento.
export const registrarPlanilhaSci = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      empresa_id: z.string().uuid(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/),
      planilha_url: z.string().max(1024),
      linhas_count: z.number().int().nonnegative().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: lanc, error } = await context.supabase
      .from("lancamentos")
      .insert({
        empresa_id: data.empresa_id,
        competencia: data.competencia,
        status: "planilha_gerada",
        planilha_url: data.planilha_url,
        linhas_count: data.linhas_count ?? null,
        total_lancamentos: data.linhas_count ?? 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return lanc;
  });

export const listConciliacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const competencia = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const { data, error } = await context.supabase
      .from("empresas")
      .select("id, razao_social, conciliacoes(id, competencia, status, divergencias_count, concluido_em, razao_csv_url, extrato_csv_url, planilha_conciliacao_url)")
      .order("razao_social");
    if (error) throw new Error(error.message);
    return { competencia, empresas: data ?? [] };
  });

// Garante a conciliação (empresa_id, competencia) e retorna o id.
export const ensureConciliacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ empresa_id: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: existing } = await context.supabase
      .from("conciliacoes")
      .select("id")
      .eq("empresa_id", data.empresa_id)
      .eq("competencia", data.competencia)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: created, error } = await context.supabase
      .from("conciliacoes")
      .insert({ empresa_id: data.empresa_id, competencia: data.competencia, status: "nao_iniciada" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

// Vincula a razão CSV (já enviada ao Storage) a uma conciliação e a marca em andamento.
export const setConciliacaoRazaoCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), razao_csv_url: z.string().max(1024) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("conciliacoes")
      .update({ razao_csv_url: data.razao_csv_url, status: "em_andamento" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Vincula o extrato CSV (já enviado ao Storage) a uma conciliação.
export const setConciliacaoExtratoCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), extrato_csv_url: z.string().max(1024) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("conciliacoes")
      .update({ extrato_csv_url: data.extrato_csv_url, status: "em_andamento" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Detalhe da conciliação de um cliente na competência atual (com resultado do motor).
export const getConciliacaoDetalhe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string }) => z.object({ empresa_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const competencia = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const { data: empresa, error: eErr } = await context.supabase
      .from("empresas")
      .select("id, razao_social")
      .eq("id", data.empresa_id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!empresa) throw new Error("Empresa não encontrada");

    const { data: conc } = await context.supabase
      .from("conciliacoes")
      .select("id, competencia, status, divergencias_count, razao_csv_url, extrato_csv_url, resultado")
      .eq("empresa_id", data.empresa_id)
      .eq("competencia", competencia)
      .maybeSingle();

    return { empresa, competencia, conciliacao: conc ?? null };
  });

export const listTarefas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tarefas")
      .select("id, tipo, status, titulo, prazo, ordem, empresa:empresa_id(id, razao_social), consultor:consultor_id(id, nome)")
      .order("ordem");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const moverTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "now" | "doing" | "next" | "back" | "done" }) =>
    z.object({ id: z.string().uuid(), status: z.enum(["now", "doing", "next", "back", "done"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("tarefas").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listConsultores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("usuarios_perfil").select("id, nome, perfil, ativo, email").order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listIntegracoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("integracoes").select("*").order("tipo");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveIntegracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tipo: string; config: Record<string, unknown>; status?: string }) =>
    z.object({ tipo: z.string().max(50), config: z.record(z.string(), z.unknown()), status: z.string().max(30).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("integracoes")
      .upsert(
        { tipo: data.tipo, config: data.config as never, status: data.status ?? "configurado", atualizado_em: new Date().toISOString() },
        { onConflict: "tipo" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMeuPerfil = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("usuarios_perfil")
      .select("id, nome, email, perfil, permissoes_custom")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return null;

    let acessos: string[];
    if (data.perfil === "admin") {
      acessos = TODAS_CHAVES;
    } else if (data.permissoes_custom) {
      acessos = data.permissoes_custom;
    } else {
      const { data: preset } = await context.supabase
        .from("permissoes_perfil")
        .select("chaves")
        .eq("perfil", data.perfil)
        .maybeSingle();
      acessos = preset?.chaves ?? [];
    }
    return { ...data, acessos };
  });

// ---------------------------------------------------------------------
// Administração de usuários e permissões (somente admin)
// ---------------------------------------------------------------------
export const listUsuarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("usuarios_perfil")
      .select("id, user_id, nome, email, perfil, ativo, permissoes_custom")
      .order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      perfil: z.enum(["admin", "consultor", "assistente"]).optional(),
      permissoes_custom: z.array(z.string().max(60)).nullable().optional(),
      ativo: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const patch: Database["public"]["Tables"]["usuarios_perfil"]["Update"] = {};
    if (data.perfil !== undefined) patch.perfil = data.perfil;
    if (data.permissoes_custom !== undefined) patch.permissoes_custom = data.permissoes_custom;
    if (data.ativo !== undefined) patch.ativo = data.ativo;
    const { error } = await context.supabase.from("usuarios_perfil").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPresetsPermissoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("permissoes_perfil").select("perfil, chaves").order("perfil");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const savePresetPermissoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ perfil: z.enum(["admin", "consultor", "assistente"]), chaves: z.array(z.string().max(60)) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("permissoes_perfil")
      .upsert({ perfil: data.perfil, chaves: data.chaves, atualizado_em: new Date().toISOString() }, { onConflict: "perfil" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

void competenciaInput;

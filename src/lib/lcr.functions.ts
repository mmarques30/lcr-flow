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
  .inputValidator((d: unknown) => z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const competencia = data?.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

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

// Notificações reais para o sino da topbar: docs pendentes, conciliações com
// divergência, tarefas em atraso.
export const getNotificacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const [docs, diverg, tarefas] = await Promise.all([
      context.supabase.from("documentos").select("id", { count: "exact", head: true }).in("status", ["recebido", "classificado"]),
      context.supabase.from("conciliacoes").select("id", { count: "exact", head: true }).eq("status", "divergencias"),
      context.supabase.from("tarefas").select("id", { count: "exact", head: true }).lt("prazo", hoje).not("status", "in", "(done,concluida)"),
    ]);
    const items: { tipo: string; titulo: string; to: string; count: number }[] = [];
    if (docs.count) items.push({ tipo: "documentos", titulo: `${docs.count} documento(s) aguardando classificação`, to: "/documentos", count: docs.count });
    if (diverg.count) items.push({ tipo: "conciliacao", titulo: `${diverg.count} conciliação(ões) com divergências`, to: "/conciliacao", count: diverg.count });
    if (tarefas.count) items.push({ tipo: "tarefas", titulo: `${tarefas.count} tarefa(s) em atraso`, to: "/tarefas", count: tarefas.count });
    return { items, total: items.length };
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
      .select("id, tipo, competencia, origem, status, status_processamento, arquivo_nome, arquivo_url, dados_extraidos, recebido_em, empresa:empresa_id(id, razao_social), responsavel:responsavel_id(nome)")
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
  storage_path: z.string().max(1024).optional().nullable(),
  mime_type: z.string().max(120).optional().nullable(),
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
        storage_path: data.storage_path ?? null,
        mime_type: data.mime_type ?? null,
        status_processamento: "pendente",
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
  .inputValidator((d: unknown) => z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const competencia = data?.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const [{ data: empresas }, { data: itens }, { data: lanc }] = await Promise.all([
      context.supabase.from("empresas").select("id, razao_social"),
      // Lançamentos individuais gerados na competência (valor não-nulo = lançamento real,
      // exclui as linhas-resumo de planilha). Independe do status do documento, então o
      // contador continua certo mesmo depois de "Avançar" o documento.
      context.supabase.from("lancamentos").select("empresa_id").eq("competencia", competencia).not("valor", "is", null),
      context.supabase.from("lancamentos").select("id, empresa_id, competencia, status, total_lancamentos, planilha_url, importado_em, created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const prontosByEmpresa = new Map<string, number>();
    (itens ?? []).forEach((l) => prontosByEmpresa.set(l.empresa_id, (prontosByEmpresa.get(l.empresa_id) ?? 0) + 1));
    return {
      competencia,
      grupos: (empresas ?? []).map((e) => ({ ...e, prontos: prontosByEmpresa.get(e.id) ?? 0 })),
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
    // Chamada direta em context.supabase para preservar o `this` do client
    // (extrair .rpc para uma variável quebra o binding → erro "reading 'rest'").
    const { data: linhasRaw, error: aggError } = await context.supabase.rpc("sci_planilha", {
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
      .select("id, razao_social, conciliacoes(id, competencia, status, divergencias_count, concluido_em, created_at, razao_csv_url, extrato_csv_url, planilha_conciliacao_url)")
      .order("razao_social");
    if (error) throw new Error(error.message);
    return { competencia, empresas: data ?? [] };
  });

// Conciliação sobre lançamentos reais (TO-BE · Tarefa 7) — lista os lançamentos
// individuais da empresa/competência com conta/histórico e flags de revisão.
export const listLancamentosConciliacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ empresa_id: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: empresa } = await context.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("id", data.empresa_id).maybeSingle();
    const { data: rows, error } = await context.supabase
      .from("lancamentos")
      .select("id, data_lancamento, valor, descricao, conciliado, confidence, status, conta:conta_id(codigo, descricao, tipo), historico:historico_id(codigo, descricao)")
      .eq("empresa_id", data.empresa_id)
      .eq("competencia", data.competencia)
      .not("valor", "is", null)
      .order("data_lancamento", { ascending: true, nullsFirst: false })
      .range(0, 4999);
    if (error) throw new Error(error.message);
    return { empresa, lancamentos: rows ?? [] };
  });

export const toggleLancamentoConciliado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), conciliado: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("lancamentos").update({ conciliado: data.conciliado }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Marca/desmarca em lote. Se `apenasAlta` for true, marca só os lançamentos com
// conta sugerida e confiança >= 0.7 (ou confiança nula — vindas do seed/legado).
export const bulkConciliarLancamentos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      empresa_id: z.string().uuid(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/),
      conciliado: z.boolean(),
      apenasAlta: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("lancamentos")
      .update({ conciliado: data.conciliado })
      .eq("empresa_id", data.empresa_id)
      .eq("competencia", data.competencia)
      .not("valor", "is", null);
    if (data.apenasAlta) q = q.not("conta_id", "is", null).or("confidence.is.null,confidence.gte.0.7");
    const { data: rows, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return { ok: true, atualizados: rows?.length ?? 0 };
  });

// Revisão de classificação (TO-BE · Tarefa 5)
export const getDocumentoRevisao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: doc, error } = await context.supabase
      .from("documentos")
      .select("id, empresa_id, tipo, competencia, arquivo_nome, arquivo_url, storage_path, status_processamento, lancamentos_gerados, classificacao_ia, empresa:empresas(razao_social, nome_fantasia, cnpj)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return doc;
  });

export const aprovarDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("documentos").update({ status_processamento: "revisado", status: "conciliado" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Limpa os lançamentos gerados por um documento (antes de reclassificar).
export const limparLancamentosDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ documento_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("lancamentos").delete().eq("documento_id", data.documento_id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .select("id, tipo, status, titulo, prazo, ordem, competencia, empresa:empresa_id(id, razao_social), consultor:consultor_id(id, nome)")
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
      .select("id, nome, email, perfil, permissoes_custom, avatar_url")
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

// Edição do próprio perfil (nome + foto) — via RPC SECURITY DEFINER,
// que só altera nome/avatar do usuário logado (sem escalonar perfil).
export const updateMeuPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      nome: z.string().min(2).max(120),
      avatar_url: z.string().max(1024).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("update_meu_perfil", {
      p_nome: data.nome,
      p_avatar: data.avatar_url ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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

// Plano de contas real (1187 contas) — range alto p/ superar o limite padrão.
export const listPlanoContas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("plano_contas")
      .select("codigo, descricao, tipo, ativo")
      .order("codigo")
      .range(0, 4999);
    if (error) throw new Error(error.message);
    return (data ?? []).slice().sort((a, b) => (parseInt(a.codigo, 10) || 0) - (parseInt(b.codigo, 10) || 0));
  });

// ====================================================================
// Cérebro LCR · leitura dos três pilares
// ====================================================================
export const getKnowledgeHub = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: processos }, { data: artigos }, { data: passosRows }, { data: artProc }] = await Promise.all([
      context.supabase.from("kb_processos").select("id, codigo, nome, area, descricao, link_execucao").eq("ativo", true).order("ordem"),
      context.supabase.from("kb_articles").select("id, titulo, categoria, tags, created_at").eq("ativo", true).order("created_at", { ascending: false }).limit(10),
      context.supabase.from("kb_processo_passos").select("processo_id"),
      context.supabase.from("kb_articles").select("processo_id").eq("ativo", true),
    ]);
    const cont = (rows: { processo_id: number | null }[] | null) => {
      const m = new Map<number, number>();
      (rows ?? []).forEach((r) => { if (r.processo_id != null) m.set(r.processo_id, (m.get(r.processo_id) ?? 0) + 1); });
      return m;
    };
    const passosCount = cont(passosRows);
    const artigosCount = cont(artProc);
    const areas: Record<string, number> = {};
    (processos ?? []).forEach((p) => { areas[p.area] = (areas[p.area] ?? 0) + 1; });
    return {
      processos: (processos ?? []).map((p) => ({ ...p, passos: passosCount.get(p.id) ?? 0, artigos: artigosCount.get(p.id) ?? 0 })),
      artigos: artigos ?? [],
      areas: Object.entries(areas).map(([area, total]) => ({ area, total })),
    };
  });

export const getProcesso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { codigo: string }) => z.object({ codigo: z.string().max(40) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: processo } = await context.supabase.from("kb_processos").select("*").eq("codigo", data.codigo).maybeSingle();
    if (!processo) return { processo: null, passos: [], videos: [], artigos: [] };
    const [{ data: passos }, { data: videos }, { data: artigos }] = await Promise.all([
      context.supabase.from("kb_processo_passos").select("*").eq("processo_id", processo.id).order("ordem"),
      context.supabase.from("kb_videos").select("*").eq("processo_id", processo.id),
      context.supabase.from("kb_articles").select("id, titulo, categoria").eq("processo_id", processo.id).eq("ativo", true),
    ]);
    return { processo, passos: passos ?? [], videos: videos ?? [], artigos: artigos ?? [] };
  });

// Importa conhecimento real: cria um artigo na base (markdown colado ou de arquivo).
export const criarArtigoConhecimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      titulo: z.string().min(2).max(200),
      conteudo_markdown: z.string().min(1).max(200000),
      categoria: z.string().max(40).optional().nullable(),
      tags: z.array(z.string().max(40)).max(20).default([]),
      processo_id: z.number().int().positive().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: art, error } = await context.supabase
      .from("kb_articles")
      .insert({
        titulo: data.titulo,
        conteudo_markdown: data.conteudo_markdown,
        categoria: data.categoria ?? null,
        tags: data.tags,
        processo_id: data.processo_id ?? null,
        autor_id: context.userId,
        ativo: true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return art;
  });

export const getConsultiveCarteira = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const [{ data: empresas }, { data: snaps }, { data: insights }] = await Promise.all([
      context.supabase.from("empresas").select("id, razao_social, nome_fantasia, segmento").eq("ativo", true).order("razao_social"),
      context.supabase.from("consultive_snapshots").select("empresa_id, periodo, margem_bruta, liquidez_corrente, receita_total, variacao_mes_anterior").order("periodo", { ascending: false }),
      context.supabase.from("consultive_insights").select("empresa_id, severidade, status"),
    ]);
    const competencias = [...new Set((snaps ?? []).map((s) => String(s.periodo).slice(0, 7)))].sort().reverse();
    const alvo = data?.competencia ?? null;
    const snapByEmp = new Map<string, NonNullable<typeof snaps>[number]>();
    (snaps ?? []).forEach((s) => {
      if (alvo && String(s.periodo).slice(0, 7) !== alvo) return;
      if (!snapByEmp.has(s.empresa_id)) snapByEmp.set(s.empresa_id, s);
    });
    const abertosByEmp = new Map<string, number>();
    let abertosTotal = 0, criticosTotal = 0;
    (insights ?? []).forEach((i) => {
      if (i.status === "aberto") { abertosByEmp.set(i.empresa_id, (abertosByEmp.get(i.empresa_id) ?? 0) + 1); abertosTotal++; }
      if (i.severidade === "alta" || i.severidade === "critica") criticosTotal++;
    });
    const clientes = (empresas ?? []).map((e) => {
      const s = snapByEmp.get(e.id);
      return {
        id: e.id,
        nome: e.nome_fantasia ?? e.razao_social,
        segmento: e.segmento,
        margem_bruta: s?.margem_bruta ?? null,
        liquidez_corrente: s?.liquidez_corrente ?? null,
        variacao: s?.variacao_mes_anterior ?? null,
        insights_abertos: abertosByEmp.get(e.id) ?? 0,
      };
    });
    return { clientes, competencias, totais: { clientes: clientes.length, insights_abertos: abertosTotal, insights_criticos: criticosTotal } };
  });

export const getConsultiveEmpresa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string }) => z.object({ empresa_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [{ data: empresa }, { data: snaps }, { data: insights }, { data: interacoes }] = await Promise.all([
      context.supabase.from("empresas").select("id, razao_social, nome_fantasia, regime, segmento").eq("id", data.empresa_id).maybeSingle(),
      context.supabase.from("consultive_snapshots").select("*").eq("empresa_id", data.empresa_id).order("periodo", { ascending: false }).limit(12),
      context.supabase.from("consultive_insights").select("*").eq("empresa_id", data.empresa_id).order("created_at", { ascending: false }),
      context.supabase.from("cerebro_interactions").select("id, pergunta, resposta, created_at, usuario_id").eq("empresa_id", data.empresa_id).eq("persona", "consultor").order("created_at", { ascending: false }).limit(20),
    ]);
    // nome do consultor (cerebro_interactions.usuario_id → auth.users; sem FK direta p/ usuarios_perfil)
    const userIds = [...new Set((interacoes ?? []).map((i) => i.usuario_id).filter(Boolean) as string[])];
    const { data: perfis } = userIds.length
      ? await context.supabase.from("usuarios_perfil").select("user_id, nome").in("user_id", userIds)
      : { data: [] as { user_id: string; nome: string }[] };
    const nomePorUser = new Map((perfis ?? []).map((p) => [p.user_id, p.nome]));
    const interacoesComConsultor = (interacoes ?? []).map((i) => ({ ...i, consultor: i.usuario_id ? (nomePorUser.get(i.usuario_id) ?? "—") : "—" }));
    return { empresa, snapshots: snaps ?? [], insights: insights ?? [], interacoes: interacoesComConsultor };
  });

// Histórico global do Cérebro — todas as interações (insights/análises), com
// nome do cliente e do consultor; filtrável por persona e cliente.
export const getHistoricoCerebro = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      persona: z.enum(["mestre", "consultor", "cuidador"]).optional().nullable(),
      empresa_id: z.string().uuid().optional().nullable(),
    }).optional().parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("cerebro_interactions")
      .select("id, persona, pergunta, resposta, created_at, usuario_id, empresa_id, empresas:empresa_id(razao_social, nome_fantasia)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data?.persona) q = q.eq("persona", data.persona);
    if (data?.empresa_id) q = q.eq("empresa_id", data.empresa_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = [...new Set((rows ?? []).map((r) => r.usuario_id).filter(Boolean) as string[])];
    const { data: perfis } = userIds.length
      ? await context.supabase.from("usuarios_perfil").select("user_id, nome").in("user_id", userIds)
      : { data: [] as { user_id: string; nome: string }[] };
    const nomePorUser = new Map((perfis ?? []).map((p) => [p.user_id, p.nome]));

    const items = (rows ?? []).map((r) => {
      const e = r.empresas as { razao_social?: string; nome_fantasia?: string } | null;
      return {
        id: r.id,
        persona: r.persona,
        pergunta: r.pergunta,
        resposta: r.resposta,
        created_at: r.created_at,
        cliente: e?.nome_fantasia ?? e?.razao_social ?? null,
        consultor: r.usuario_id ? (nomePorUser.get(r.usuario_id) ?? "—") : "—",
      };
    });
    // opções de filtro derivadas
    const clientes = Array.from(new Map((rows ?? []).filter((r) => r.empresa_id).map((r) => {
      const e = r.empresas as { razao_social?: string; nome_fantasia?: string } | null;
      return [r.empresa_id as string, e?.nome_fantasia ?? e?.razao_social ?? "—"] as const;
    })).entries()).map(([id, nome]) => ({ id, nome }));
    return { items, clientes };
  });

export const getCxCarteira = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: health }, { data: nps }] = await Promise.all([
      context.supabase.from("cx_health_score").select("empresa_id, score, classificacao, tendencia, empresas(razao_social, nome_fantasia)").order("score", { ascending: true }),
      context.supabase.from("cx_nps_responses").select("score, periodo"),
    ]);
    const dist = { saudavel: 0, atencao: 0, risco: 0 };
    let soma = 0;
    (health ?? []).forEach((h) => {
      if (h.classificacao && h.classificacao in dist) dist[h.classificacao as keyof typeof dist]++;
      soma += h.score ?? 0;
    });
    const mediaHealth = (health ?? []).length ? Math.round(soma / (health ?? []).length) : 0;
    // tendência NPS: média por período (últimos 6)
    const byPeriodo = new Map<string, { soma: number; n: number; promotores: number; detratores: number }>();
    (nps ?? []).forEach((r) => {
      const k = r.periodo;
      const cur = byPeriodo.get(k) ?? { soma: 0, n: 0, promotores: 0, detratores: 0 };
      cur.soma += r.score; cur.n++;
      if (r.score >= 9) cur.promotores++; else if (r.score <= 6) cur.detratores++;
      byPeriodo.set(k, cur);
    });
    const npsTrend = Array.from(byPeriodo.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([periodo, v]) => ({ periodo, media: Math.round((v.soma / v.n) * 10) / 10, nps: Math.round(((v.promotores - v.detratores) / v.n) * 100) }))
      .slice(-6);
    const atencao = (health ?? []).filter((h) => h.classificacao !== "saudavel").slice(0, 8).map((h) => {
      const e = h.empresas as { razao_social?: string; nome_fantasia?: string } | null;
      return { id: h.empresa_id, nome: e?.nome_fantasia ?? e?.razao_social ?? "—", score: h.score, classificacao: h.classificacao, tendencia: h.tendencia };
    });
    // NPS do período mais recente: promotores/neutros/detratores + NPS
    const ultimoPeriodo = Array.from(byPeriodo.keys()).sort().slice(-1)[0];
    let promotores = 0, neutros = 0, detratores = 0;
    (nps ?? []).forEach((r) => {
      if (r.periodo !== ultimoPeriodo) return;
      if (r.score >= 9) promotores++; else if (r.score <= 6) detratores++; else neutros++;
    });
    const totalNps = promotores + neutros + detratores;
    const npsAtual = totalNps ? Math.round(((promotores - detratores) / totalNps) * 100) : 0;
    const npsResumo = { promotores, neutros, detratores, npsAtual, tendencia: (health ?? []).filter((h) => h.tendencia === "subindo").length };
    const subindo = (health ?? []).filter((h) => h.tendencia === "subindo").length;
    const caindo = (health ?? []).filter((h) => h.tendencia === "caindo").length;
    return { mediaHealth, dist, npsTrend, atencao, total: (health ?? []).length, npsResumo, subindo, caindo };
  });

export const getCxEmpresa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string }) => z.object({ empresa_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [{ data: empresa }, { data: health }, { data: tps }, { data: nps }] = await Promise.all([
      context.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("id", data.empresa_id).maybeSingle(),
      context.supabase.from("cx_health_score").select("*").eq("empresa_id", data.empresa_id).maybeSingle(),
      context.supabase.from("cx_touchpoints").select("*").eq("empresa_id", data.empresa_id).order("created_at", { ascending: false }).limit(20),
      context.supabase.from("cx_nps_responses").select("score, periodo, categoria").eq("empresa_id", data.empresa_id).order("periodo", { ascending: false }).limit(12),
    ]);
    return { empresa, health, touchpoints: tps ?? [], nps: nps ?? [] };
  });

export const registrarTouchpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      empresa_id: z.string().uuid(),
      tipo: z.string().max(40),
      canal: z.string().max(60).optional().nullable(),
      descricao: z.string().max(2000).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("cx_touchpoints").insert({
      empresa_id: data.empresa_id, tipo: data.tipo, canal: data.canal ?? null, descricao: data.descricao ?? null, usuario_lcr_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

void competenciaInput;

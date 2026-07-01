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
  .inputValidator((d: unknown) => z.object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    competencias: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(60).optional(),
  }).optional().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const padrao = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    // Lista efetiva de competências (multi-mês × multi-ano). Se nada vier,
    // usa a competência atual.
    const competenciasSel = (data?.competencias && data.competencias.length > 0)
      ? Array.from(new Set(data.competencias)).sort()
      : [data?.competencia ?? padrao];
    // Competência "âncora" = a mais recente — usada para delta vs mês anterior
    // e como fim da janela de 6 meses da série temporal.
    const competencia = competenciasSel[competenciasSel.length - 1];

    // Últimas 6 competências terminando na âncora.
    const seisMeses: string[] = [];
    {
      const [yy, mm] = competencia.split("-").map(Number);
      const d = new Date(yy, mm - 1, 1);
      for (let i = 0; i < 6; i++) {
        seisMeses.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        d.setMonth(d.getMonth() - 1);
      }
    }
    const compAnterior = seisMeses[seisMeses.length - 2];

    const [empresas, docsAguardando, lancamentosMes, conciliacoesPendentes, fases, atencaoUrgente, docsRows, conciliacoesRows, tarefasRows, serieLanc, serieConcil, lancMesAnterior, empresasRegime, topClientesRaw] = await Promise.all([
      supabase.from("empresas").select("id", { count: "exact", head: true }),
      supabase.from("documentos").select("id", { count: "exact", head: true }).in("status", ["recebido", "classificado"]),
      supabase.from("lancamentos").select("id", { count: "exact", head: true }).in("competencia", competenciasSel),
      supabase.from("conciliacoes").select("id", { count: "exact", head: true }).in("competencia", competenciasSel).neq("status", "concluida"),
      supabase.from("empresas").select("status"),
      supabase
        .from("empresas")
        .select("id, razao_social, status, tags")
        .in("status", ["atrasado", "cobranca"])
        .limit(8),
      supabase.from("documentos").select("status"),
      supabase.from("conciliacoes").select("status").in("competencia", competenciasSel),
      supabase.from("tarefas").select("status"),
      supabase.from("lancamentos").select("competencia").in("competencia", seisMeses),
      supabase.from("conciliacoes").select("competencia, status").in("competencia", seisMeses),
      supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("competencia", compAnterior),
      supabase.from("empresas").select("regime"),
      // Top Clientes: só conta lançamentos que vieram de documento processado
      // (documento_id NOT NULL). Isso evita que seeds de demonstração ou
      // lançamentos manuais fictícios inflem o ranking.
      supabase.from("lancamentos").select("empresa_id, empresas(razao_social)").in("competencia", competenciasSel).not("documento_id", "is", null).limit(2000),
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
    // Conciliação por status = foto das competências selecionadas para TODOS os
    // clientes. Quem não iniciou conciliação na competência conta como
    // "não iniciada". Com multi-competência o "total esperado" é empresas × N.
    const totalEmpresas = empresas.count ?? 0;
    const conciliacoesByStatus = countBy(conciliacoesRows.data, ["nao_iniciada", "em_andamento", "divergencias", "concluida"]);
    const iniciadas = (conciliacoesRows.data ?? []).length;
    const totalConciliacoes = totalEmpresas * competenciasSel.length;
    conciliacoesByStatus.nao_iniciada += Math.max(0, totalConciliacoes - iniciadas);
    const totalDocs = (docsRows.data ?? []).length;
    const tarefasAbertas = (tarefasRows.data ?? []).filter((t) => !["done", "concluida"].includes(t.status)).length;

    // Série dos últimos 6 meses: lançamentos + conciliações concluídas por mês.
    const lancPorMes = Object.fromEntries(seisMeses.map((c) => [c, 0])) as Record<string, number>;
    (serieLanc.data ?? []).forEach((r) => { if (r.competencia in lancPorMes) lancPorMes[r.competencia]++; });
    const concilPorMes = Object.fromEntries(seisMeses.map((c) => [c, { concluida: 0, total: 0 }])) as Record<string, { concluida: number; total: number }>;
    (serieConcil.data ?? []).forEach((r) => {
      if (r.competencia in concilPorMes) {
        concilPorMes[r.competencia].total++;
        if (r.status === "concluida") concilPorMes[r.competencia].concluida++;
      }
    });
    const serieMensal = seisMeses.map((c) => ({
      competencia: c,
      lancamentos: lancPorMes[c],
      concluidas: concilPorMes[c].concluida,
      taxa: concilPorMes[c].total > 0 ? Math.round((concilPorMes[c].concluida / concilPorMes[c].total) * 100) : 0,
    }));

    // Delta vs mês anterior (variação % no volume de lançamentos).
    const lancAnt = lancMesAnterior.count ?? 0;
    const lancAtual = lancamentosMes.count ?? 0;
    const deltaLanc = lancAnt > 0 ? Math.round(((lancAtual - lancAnt) / lancAnt) * 100) : (lancAtual > 0 ? 100 : 0);

    // Distribuição por regime tributário (carteira).
    const regimeCounts: Record<string, number> = { simples: 0, presumido: 0, real: 0, mei: 0, outro: 0 };
    (empresasRegime.data ?? []).forEach((r) => {
      const k = r.regime ?? "outro";
      if (k in regimeCounts) regimeCounts[k]++;
      else regimeCounts.outro++;
    });
    const regimes = [
      { label: "Simples Nacional", key: "simples", total: regimeCounts.simples },
      { label: "Lucro Presumido", key: "presumido", total: regimeCounts.presumido },
      { label: "Lucro Real", key: "real", total: regimeCounts.real },
      { label: "MEI", key: "mei", total: regimeCounts.mei },
      { label: "Sem classificação", key: "outro", total: regimeCounts.outro },
    ];

    // Top 5 clientes por volume de lançamentos no mês.
    const porEmpresa: Record<string, { id: string; nome: string; total: number }> = {};
    (topClientesRaw.data ?? []).forEach((r) => {
      const id = r.empresa_id as string;
      const nome = (r.empresas as { razao_social?: string } | null)?.razao_social ?? "—";
      if (!porEmpresa[id]) porEmpresa[id] = { id, nome, total: 0 };
      porEmpresa[id].total++;
    });
    const topClientes = Object.values(porEmpresa).sort((a, b) => b.total - a.total).slice(0, 5);

    // Saúde operacional: % docs já processados/conciliados (proxy de SLA).
    const docsCompletos = docsByStatus.processado + docsByStatus.conciliado;
    const saudeDocs = totalDocs > 0 ? Math.round((docsCompletos / totalDocs) * 100) : 0;
    const taxaConcluidas = totalConciliacoes > 0 ? Math.round((conciliacoesByStatus.concluida / totalConciliacoes) * 100) : 0;
    const taxaDivergencias = totalConciliacoes > 0 ? Math.round((conciliacoesByStatus.divergencias / totalConciliacoes) * 100) : 0;

    return {
      competencia,
      competencias: competenciasSel,
      clientesAtivos: empresas.count ?? 0,
      docsAguardando: docsAguardando.count ?? 0,
      lancamentosMes: lancAtual,
      lancamentosMesAnterior: lancAnt,
      deltaLanc,
      conciliacoesPendentes: Math.max(0, totalConciliacoes - conciliacoesByStatus.concluida),
      tarefasAbertas,
      totalDocs,
      totalConciliacoes,
      saudeDocs,
      taxaConcluidas,
      taxaDivergencias,
      atencaoUrgente: atencaoUrgente.data ?? [],
      serieMensal,
      regimes,
      topClientes,
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

// Paginação + busca server-side da carteira (escala pra 902+ clientes).
export const listEmpresasPaginadas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      q: z.string().max(120).optional(),
      status: z.string().max(20).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(200).default(50),
    }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = context.supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, cnpj, regime, segmento, status, tags, consultor_id, usuarios_perfil:consultor_id(nome)", { count: "exact" })
      .order("razao_social")
      .range(from, to);
    if (data.q && data.q.trim()) {
      const term = `%${data.q.trim()}%`;
      q = q.or(`razao_social.ilike.${term},nome_fantasia.ilike.${term},cnpj.ilike.${term}`);
    }
    if (data.status && data.status !== "all") q = q.eq("status", data.status as never);
    const { data: items, count, error } = await q;
    if (error) throw new Error(error.message);
    return { items: items ?? [], total: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// Resumo agregado da carteira (rápido, independente da página visível).
export const getEmpresasResumo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("empresas").select("status").eq("ativo", true);
    if (error) throw new Error(error.message);
    const total = (data ?? []).length;
    const by = (s: string) => (data ?? []).filter((e) => e.status === s).length;
    return {
      total,
      em_dia: by("em_dia"),
      cobranca: by("cobranca"),
      atrasado: by("atrasado"),
      entregue: by("entregue"),
    };
  });

// Notificações reais para o sino da topbar: docs pendentes, conciliações com
// divergência, tarefas em atraso.
export const getNotificacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    const diaHoje = agora.getDate();
    const [docs, diverg, tarefas, fechando] = await Promise.all([
      context.supabase.from("documentos").select("id", { count: "exact", head: true }).in("status", ["recebido", "classificado"]),
      context.supabase.from("conciliacoes").select("id", { count: "exact", head: true }).eq("status", "divergencias"),
      context.supabase.from("tarefas").select("id", { count: "exact", head: true }).lt("prazo", hoje).not("status", "in", "(done,concluida)"),
      // Fechamento operacional: clientes com dia_fechamento configurado caindo
      // nos próximos 3 dias (hoje incluso).
      context.supabase.from("empresas").select("id, dia_fechamento").eq("ativo", true).not("dia_fechamento", "is", null),
    ]);
    const items: { tipo: string; titulo: string; to: string; count: number }[] = [];
    if (docs.count) items.push({ tipo: "documentos", titulo: `${docs.count} documento(s) aguardando classificação`, to: "/documentos", count: docs.count });
    if (diverg.count) items.push({ tipo: "conciliacao", titulo: `${diverg.count} conciliação(ões) com divergências`, to: "/conciliacao", count: diverg.count });
    if (tarefas.count) items.push({ tipo: "tarefas", titulo: `${tarefas.count} tarefa(s) em atraso`, to: "/tarefas", count: tarefas.count });

    type EmpFech = { id: string; dia_fechamento: number | null };
    const fechamentosProximos = ((fechando.data ?? []) as EmpFech[]).filter((e) => {
      if (e.dia_fechamento == null) return false;
      const diff = e.dia_fechamento - diaHoje;
      return diff >= 0 && diff <= 3;
    }).length;
    if (fechamentosProximos) items.push({ tipo: "fechamento", titulo: `${fechamentosProximos} cliente(s) com fechamento contábil nos próximos 3 dias`, to: "/clientes", count: fechamentosProximos });

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

// Dados agregados para a Visão geral do cliente: série mensal, KPIs, contas
// detectadas dos extratos, documentos esperados com status no mês.
export const getEmpresaPainel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      empresa_id: z.string().uuid(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const compAtual = data.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    const seisMeses: string[] = [];
    {
      const [yy, mm] = compAtual.split("-").map(Number);
      const d2 = new Date(yy, mm - 1, 1);
      for (let i = 0; i < 6; i++) {
        seisMeses.unshift(`${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}`);
        d2.setMonth(d2.getMonth() - 1);
      }
    }

    const [docsAll, lancAll, lancMes, esperados, contasCad] = await Promise.all([
      supabase.from("documentos").select("id, tipo, status, origem, recebido_em, competencia, arquivo_nome, classificacao_ia, dados_extraidos").eq("empresa_id", data.empresa_id).order("recebido_em", { ascending: false }).limit(500),
      supabase.from("lancamentos").select("id, competencia, valor, created_at").eq("empresa_id", data.empresa_id).in("competencia", seisMeses),
      supabase.from("lancamentos").select("id, valor, descricao, data_lancamento").eq("empresa_id", data.empresa_id).eq("competencia", compAtual).order("data_lancamento", { ascending: false }).limit(20),
      supabase.from("documentos_esperados").select("id, tipo").eq("empresa_id", data.empresa_id),
      supabase.from("contas_bancarias").select("id, banco, agencia, conta").eq("empresa_id", data.empresa_id),
    ]);

    const docs = docsAll.data ?? [];
    const lancs = lancAll.data ?? [];

    // Série mensal de lançamentos.
    const porMes = Object.fromEntries(seisMeses.map((c) => [c, { lancamentos: 0, valor: 0 }])) as Record<string, { lancamentos: number; valor: number }>;
    lancs.forEach((l) => {
      if (l.competencia in porMes) {
        porMes[l.competencia].lancamentos++;
        porMes[l.competencia].valor += Number(l.valor ?? 0);
      }
    });
    const serieMensal = seisMeses.map((c) => ({ competencia: c, ...porMes[c] }));

    // Docs do mês selecionado.
    const docsMes = docs.filter((d) => d.competencia === compAtual);

    // Distribuição por tipo (todos os tempos).
    const tipoCount: Record<string, number> = {};
    docs.forEach((d) => { tipoCount[d.tipo] = (tipoCount[d.tipo] ?? 0) + 1; });
    const docsByTipo = Object.entries(tipoCount).map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total);

    // Documentos esperados com status: cruza com docs do mês primeiro, e se
    // não houver no mês, marca como "recebido em outra competência" caso já
    // tenha aparecido alguma vez para o cliente (evita o falso 0% quando o
    // extrato foi enviado mas para outro mês).
    const esperadosMes = (esperados.data ?? []).map((e) => {
      const noMes = docsMes.find((d) => d.tipo === e.tipo);
      if (noMes) {
        return { id: e.id, tipo: e.tipo, recebido: true, no_mes: true, status: noMes.status, recebido_em: noMes.recebido_em, competencia_recebido: noMes.competencia as string | null };
      }
      // Fallback: doc desse tipo já recebido em outra competência.
      const outroMes = docs.find((d) => d.tipo === e.tipo);
      if (outroMes) {
        return { id: e.id, tipo: e.tipo, recebido: true, no_mes: false, status: outroMes.status, recebido_em: outroMes.recebido_em, competencia_recebido: outroMes.competencia as string | null };
      }
      return { id: e.id, tipo: e.tipo, recebido: false, no_mes: false, status: null as string | null, recebido_em: null as string | null, competencia_recebido: null as string | null };
    });

    // Bancos detectados varrendo TODO documento recebido (não só extratos):
    // procura o nome do banco no arquivo_nome e nos dados extraídos pela IA
    // (classificacao_ia.dados_extraidos / dados_extraidos). Ex.: NF pode citar
    // banco do emissor; planilha financeira pode trazer "Banco: Itaú" etc.
    const cadastrados = new Set((contasCad.data ?? []).map((c) => (c.banco ?? "").toLowerCase()));
    const BANCOS = [
      { match: "bradesco", nome: "Bradesco" },
      { match: "santander", nome: "Santander" },
      { match: "banco do brasil", nome: "Banco do Brasil" },
      { match: "caixa", nome: "Caixa" },
      { match: "sicoob", nome: "Sicoob" },
      { match: "sicredi", nome: "Sicredi" },
      { match: "nubank", nome: "Nubank" },
      { match: "safra", nome: "Safra" },
      { match: "bmg", nome: "BMG" },
      { match: "btg", nome: "BTG" },
      { match: "itau", nome: "Itaú" },
      { match: "itaú", nome: "Itaú" },
      { match: "inter", nome: "Inter" },
      { match: "original", nome: "Original" },
      { match: "stone", nome: "Stone" },
      { match: "pagbank", nome: "PagBank" },
      { match: "c6 bank", nome: "C6" },
      { match: "xp ", nome: "XP" },
    ];
    // Detecta SÓ bancos que aparecem em documentos do tipo "extrato" (= conta
    // operacional da empresa). NF/recibo/planilha mencionam bancos de terceiros
    // (fornecedores, clientes) que NÃO são contas da empresa — varrer todos
    // gerava ruído (Itaú + XP + BB + Caixa + Bradesco para uma empresa que só
    // opera no Itaú). Quando há extratos, eles são a fonte de verdade.
    const detectados = new Map<string, { banco: string; ocorrencias: number }>();
    const extratos = docs.filter((d) => d.tipo === "extrato");
    extratos.forEach((d) => {
      const partes = [
        d.arquivo_nome ?? "",
        typeof d.classificacao_ia === "object" && d.classificacao_ia ? JSON.stringify(d.classificacao_ia) : "",
        typeof d.dados_extraidos === "object" && d.dados_extraidos ? JSON.stringify(d.dados_extraidos) : "",
      ].join(" ").toLowerCase();
      BANCOS.forEach((b) => {
        if (partes.includes(b.match) && !cadastrados.has(b.nome.toLowerCase())) {
          const cur = detectados.get(b.nome) ?? { banco: b.nome, ocorrencias: 0 };
          cur.ocorrencias++;
          detectados.set(b.nome, cur);
        }
      });
    });
    const bancosDetectados = Array.from(detectados.values()).sort((a, b) => b.ocorrencias - a.ocorrencias);

    // Compõe um "nome curto" para listagem dos últimos documentos. Tenta primeiro
    // extrair identificadores estruturados (nº NF, fornecedor, valor) de
    // classificacao_ia/dados_extraidos. Se nada vier, usa o arquivo_nome.
    function nomeCurto(d: { tipo: string; arquivo_nome: string | null; classificacao_ia: unknown; dados_extraidos: unknown }): string {
      const dados = (d.classificacao_ia && typeof d.classificacao_ia === "object" ? (d.classificacao_ia as { dados_extraidos?: unknown }).dados_extraidos : null)
        ?? d.dados_extraidos ?? null;
      if (dados && typeof dados === "object") {
        const o = dados as Record<string, unknown>;
        const numero = (o.numero_nf ?? o.numero ?? o.nf ?? o.documento ?? "") as string | number;
        const fornecedor = (o.fornecedor ?? o.emitente ?? o.cliente ?? o.razao_social ?? o.empresa ?? "") as string;
        const valor = (o.valor_total ?? o.valor ?? "") as string | number;
        const partes: string[] = [];
        if (numero) partes.push(`Nº ${String(numero).trim()}`);
        if (fornecedor) partes.push(String(fornecedor).trim().slice(0, 40));
        if (valor !== "" && valor != null) {
          const n = Number(valor);
          if (!Number.isNaN(n)) partes.push(n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
        }
        if (partes.length > 0) return partes.join(" · ");
      }
      // Fallback: limpa o arquivo_nome (remove extensão, separadores)
      if (d.arquivo_nome) {
        return d.arquivo_nome.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").slice(0, 80);
      }
      return "";
    }

    const ultimoDoc = docs[0] ?? null;
    const lancMesData = lancMes.data ?? [];
    const ultimoLanc = lancMesData[0] ?? null;
    const valorMes = lancMesData.reduce((s, l) => s + Number(l.valor ?? 0), 0);

    return {
      competencia: compAtual,
      kpis: {
        totalDocs: docs.length,
        docsMes: docsMes.length,
        lancMes: lancMesData.length,
        valorMes,
        ultimoDoc: ultimoDoc ? { tipo: ultimoDoc.tipo, recebido_em: ultimoDoc.recebido_em } : null,
        ultimoLanc: ultimoLanc ? { descricao: ultimoLanc.descricao, valor: Number(ultimoLanc.valor ?? 0), data_lancamento: ultimoLanc.data_lancamento } : null,
      },
      serieMensal,
      docsByTipo,
      docsEsperadosMes: esperadosMes,
      docsRecentes: docs.slice(0, 8).map((d) => ({ id: d.id, tipo: d.tipo, status: d.status, origem: d.origem, recebido_em: d.recebido_em, competencia: d.competencia, nome_curto: nomeCurto(d), arquivo_nome: d.arquivo_nome })),
      lancRecentes: lancMesData.slice(0, 8).map((l) => ({ id: l.id, descricao: l.descricao, valor: Number(l.valor ?? 0), data_lancamento: l.data_lancamento })),
      bancosDetectados,
    };
  });

export const updateEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      razao_social: z.string().min(2).max(200),
      nome_fantasia: z.string().max(200).optional().nullable(),
      cnpj: z.string().min(11).max(20).optional().nullable(),
      regime: z.enum(["simples", "presumido", "real", "mei"]).optional().nullable(),
      segmento: z.string().max(100).optional().nullable(),
      consultor_id: z.string().uuid().optional().nullable(),
      tags: z.array(z.string().max(50)).max(20).default([]),
      observacoes: z.string().max(2000).optional().nullable(),
      dia_fechamento: z.number().int().min(1).max(31).optional().nullable(),
      status: z.enum(["em_dia", "cobranca", "lancamento", "conciliacao", "entregue", "atrasado"]).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("empresas")
      .update({
        razao_social: patch.razao_social,
        nome_fantasia: patch.nome_fantasia ?? null,
        cnpj: patch.cnpj ?? null,
        regime: patch.regime ?? null,
        segmento: patch.segmento ?? null,
        consultor_id: patch.consultor_id ?? null,
        tags: patch.tags,
        observacoes: patch.observacoes ?? null,
        dia_fechamento: patch.dia_fechamento ?? null,
        ...(patch.status ? { status: patch.status } : {}),
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
  .inputValidator((d?: { empresa_id?: string; competencia?: string }) =>
    z.object({
      empresa_id: z.string().uuid().optional(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("documentos")
      .select("id, tipo, competencia, origem, status, status_processamento, arquivo_nome, arquivo_url, dados_extraidos, classificacao_ia, recebido_em, empresa:empresa_id(id, razao_social), responsavel:responsavel_id(nome)")
      .order("recebido_em", { ascending: false })
      .limit(500);
    // Escopa por empresa quando informado (evita que o limite global de 500
    // esconda os documentos de um cliente quando há muitos no total).
    if (data.empresa_id) q = q.eq("empresa_id", data.empresa_id);
    if (data.competencia) q = q.eq("competencia", data.competencia);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
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
      .select("id, data_lancamento, valor, descricao, documento_numero, part_deb, part_cred, natureza_movimento, conciliado, confidence, status, fonte_extrato, enriquecido, participante, documento_suporte_id, conta:conta_id(codigo, descricao, tipo, sci_apelido, sci_historico_padrao), historico:historico_id(codigo, descricao, sci_apelido)")
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

type ResLinha = { data: string | null; descricao: string; valor: number; id?: string };
type ResConc = {
  conciliados?: { razao: ResLinha; extrato: ResLinha; fonte: string; motivo?: string }[];
  conciliados_count?: number;
  divergencias_razao?: ResLinha[];
  divergencias_extrato?: ResLinha[];
  [k: string]: unknown;
};

// Concilia manualmente um par (divergência da razão + divergência do extrato),
// movendo-os para os conciliados no resultado salvo da conciliação.
export const conciliarParManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conciliacao_id: z.string().uuid(), razao_idx: z.number().int().min(0), extrato_idx: z.number().int().min(0) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: conc, error } = await context.supabase.from("conciliacoes").select("id, resultado").eq("id", data.conciliacao_id).maybeSingle();
    if (error) throw new Error(error.message);
    const r = (conc?.resultado ?? null) as ResConc | null;
    if (!r) throw new Error("Conciliação ainda não foi executada.");
    const razao = r.divergencias_razao?.[data.razao_idx];
    const extrato = r.divergencias_extrato?.[data.extrato_idx];
    if (!razao || !extrato) throw new Error("Item não encontrado.");
    r.conciliados = [...(r.conciliados ?? []), { razao, extrato, fonte: "manual" }];
    r.divergencias_razao = (r.divergencias_razao ?? []).filter((_, i) => i !== data.razao_idx);
    r.divergencias_extrato = (r.divergencias_extrato ?? []).filter((_, i) => i !== data.extrato_idx);
    r.conciliados_count = r.conciliados.length;
    const divergencias_count = (r.divergencias_razao?.length ?? 0) + (r.divergencias_extrato?.length ?? 0);
    const status = divergencias_count === 0 ? "concluida" : "divergencias";
    const { error: upErr } = await context.supabase.from("conciliacoes")
      .update({ resultado: r as never, divergencias_count, status, concluido_em: divergencias_count === 0 ? new Date().toISOString() : null })
      .eq("id", data.conciliacao_id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, divergencias_count };
  });

// Dispara o cruzamento extrato × documentos suporte (NF/recibo/planilha).
// Cada lançamento gerado de uma linha do extrato pode ser enriquecido com
// participante + nº do documento quando um doc suporte da mesma competência
// bate em valor e data.
export const enriquecerExtrato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    empresa_id: z.string().uuid(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
    force: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: res, error } = await context.supabase.functions.invoke("enriquecer-extrato", {
      body: data,
    });
    if (error) throw new Error(error.message);
    if (res && res.ok === false) throw new Error(res.error ?? "Falha ao enriquecer");
    return res as { ok: true; total_lancamentos: number; enriquecidos: number; sem_suporte: number; docs_suporte_disponiveis: number };
  });

// Lista os documentos suporte (não-extrato) de uma competência, com status
// de match (linha do extrato a qual cada um foi associado).
export const listDocsSuporte = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    empresa_id: z.string().uuid(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const [{ data: docs }, { data: lancs }] = await Promise.all([
      context.supabase.from("documentos")
        .select("id, tipo, arquivo_nome, recebido_em, classificacao_ia")
        .eq("empresa_id", data.empresa_id)
        .eq("competencia", data.competencia)
        .neq("tipo", "extrato")
        .order("recebido_em", { ascending: false }),
      context.supabase.from("lancamentos")
        .select("id, documento_suporte_id, descricao, valor, data_lancamento")
        .eq("empresa_id", data.empresa_id)
        .eq("competencia", data.competencia)
        .eq("fonte_extrato", true)
        .eq("enriquecido", true),
    ]);
    const mapaLanc = new Map(((lancs ?? []) as { id: string; documento_suporte_id: string | null; descricao: string | null; valor: number | null; data_lancamento: string | null }[])
      .filter((l) => l.documento_suporte_id)
      .map((l) => [l.documento_suporte_id as string, l]));
    return ((docs ?? []) as { id: string; tipo: string; arquivo_nome: string | null; recebido_em: string }[]).map((d) => ({
      id: d.id,
      tipo: d.tipo,
      arquivo_nome: d.arquivo_nome,
      recebido_em: d.recebido_em,
      lancamento_match: mapaLanc.get(d.id) ?? null,
    }));
  });

// Limpa o resultado de uma conciliação para permitir gerar de novo do zero.
// Mantém o extrato vinculado — só zera resultado, contadores e status.
// Útil quando a primeira rodada gerou muitas divergências erradas e o usuário
// quer reprocessar depois de editar lançamentos.
export const limparConciliacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conciliacao_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: conc } = await context.supabase
      .from("conciliacoes").select("empresa_id, competencia, extrato_csv_url").eq("id", data.conciliacao_id).maybeSingle();
    if (!conc) throw new Error("Conciliação não encontrada.");
    const proximoStatus = conc.extrato_csv_url ? "em_andamento" : "nao_iniciada";
    const { error } = await context.supabase
      .from("conciliacoes")
      .update({ resultado: null, divergencias_count: 0, concluido_em: null, status: proximoStatus })
      .eq("id", data.conciliacao_id);
    if (error) throw new Error(error.message);
    // Volta todos os lançamentos DA EMPRESA/COMPETÊNCIA para "não conciliados"
    // para que rodem de novo na próxima execução do "Conciliar agora".
    await context.supabase
      .from("lancamentos")
      .update({ conciliado: false })
      .eq("empresa_id", conc.empresa_id)
      .eq("competencia", conc.competencia)
      .eq("conciliado", true);
    return { ok: true };
  });

// Edita um lançamento: atribuir/corrigir a conta contábil e ajustar data/valor/
// descrição. Usado na revisão humana (aba Conciliação bancária) e para acertar
// uma divergência antes de reconciliar. Ao definir a conta, marca confiança alta
// (1.0) para o lançamento sair do estado "a revisar".
export const editarLancamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    data_lancamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valor: z.number().optional(),
    descricao: z.string().max(200).optional(),
    conta_codigo: z.string().max(40).optional(),
    documento_numero: z.string().max(80).nullable().optional(),
    part_deb: z.string().max(40).nullable().optional(),
    part_cred: z.string().max(40).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const patch: Record<string, unknown> = {};
    if (data.data_lancamento) patch.data_lancamento = data.data_lancamento;
    if (typeof data.valor === "number") patch.valor = Math.abs(data.valor);
    if (data.descricao != null) patch.descricao = data.descricao;
    if (data.part_deb !== undefined) patch.part_deb = data.part_deb;
    if (data.part_cred !== undefined) patch.part_cred = data.part_cred;
    if (data.documento_numero !== undefined) patch.documento_numero = data.documento_numero;

    // Atribuir/corrigir conta: resolve o código → conta_id no escopo da empresa
    // (conta específica da empresa tem prioridade sobre a global, empresa_id null).
    if (data.conta_codigo) {
      const { data: lanc } = await context.supabase.from("lancamentos").select("empresa_id").eq("id", data.id).maybeSingle();
      const empresaId = (lanc as { empresa_id?: string | null } | null)?.empresa_id ?? null;
      const { data: contas, error: cErr } = await context.supabase
        .from("plano_contas").select("id, empresa_id, codigo").eq("codigo", data.conta_codigo);
      if (cErr) throw new Error(cErr.message);
      const lista = (contas ?? []) as { id: string; empresa_id: string | null; codigo: string }[];
      const conta = lista.find((c) => c.empresa_id === empresaId) ?? lista.find((c) => c.empresa_id === null) ?? lista[0];
      if (!conta) throw new Error(`Conta "${data.conta_codigo}" não encontrada no plano de contas.`);
      patch.conta_id = conta.id;
      patch.confidence = 1; // conta definida por humano → sai de "a revisar"
    }

    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("lancamentos").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Inclusão manual de lançamento na competência (botão "incluir" na conciliação).
export const createLancamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    empresa_id: z.string().uuid(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
    data_lancamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valor: z.number(),
    descricao: z.string().max(200).optional(),
    conta_codigo: z.string().max(40).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    let conta_id: string | null = null;
    if (data.conta_codigo) {
      const { data: contas } = await context.supabase
        .from("plano_contas").select("id, empresa_id, codigo").eq("codigo", data.conta_codigo);
      const lista = (contas ?? []) as { id: string; empresa_id: string | null; codigo: string }[];
      const conta = lista.find((c) => c.empresa_id === data.empresa_id) ?? lista.find((c) => c.empresa_id === null) ?? lista[0];
      if (!conta) throw new Error(`Conta "${data.conta_codigo}" não encontrada no plano de contas.`);
      conta_id = conta.id;
    }
    const { data: comp } = await context.supabase
      .from("competencias").select("id").eq("empresa_id", data.empresa_id).eq("periodo", data.competencia).maybeSingle();
    const insert = {
      empresa_id: data.empresa_id,
      competencia: data.competencia,
      competencia_id: (comp as { id?: string } | null)?.id ?? null,
      data_lancamento: data.data_lancamento ?? null,
      valor: Math.abs(data.valor),
      descricao: data.descricao ?? null,
      conta_id,
      status: "validado" as const,
      confidence: 1,
      total_lancamentos: 1,
    };
    const { data: novo, error } = await context.supabase.from("lancamentos").insert(insert as never).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: (novo as { id?: string } | null)?.id };
  });

export const deleteLancamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("lancamentos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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

// Mudança manual do tipo do documento (quando a IA classifica errado).
// Quando o novo tipo é 'extrato', limpa lançamentos órfãos (que estavam
// pendurados no documento como se fosse NF/planilha) e vincula o arquivo
// como extrato_csv_url na conciliação da competência.
export const mudarTipoDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tipo: z.enum(["extrato", "nf_entrada", "nf_saida", "fatura_cartao", "recibo", "darf", "planilha_financeira", "movimento_contabil", "outros"]),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: doc, error: getErr } = await context.supabase
      .from("documentos")
      .select("id, empresa_id, competencia, tipo, storage_path, arquivo_url, arquivo_nome")
      .eq("id", data.id)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!doc) throw new Error("Documento não encontrado.");
    if (doc.tipo === data.tipo) return { ok: true, mudou: false };

    if (data.tipo === "extrato") {
      const competencia = doc.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      // limpa lançamentos órfãos gerados quando o doc era de outro tipo
      await context.supabase.from("lancamentos").delete().eq("documento_id", data.id);
      // espelha o arquivo no bucket conciliacoes
      const srcBucket = doc.storage_path ? "documentos-clientes" : "documentos";
      const srcPath = doc.storage_path ?? doc.arquivo_url;
      if (srcPath) {
        const { data: file } = await context.supabase.storage.from(srcBucket).download(srcPath);
        if (file) {
          const safeName = (doc.arquivo_nome ?? "extrato").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
          const concPath = `${doc.empresa_id}/${competencia}/extrato-${crypto.randomUUID()}-${safeName}`;
          await context.supabase.storage.from("conciliacoes").upload(concPath, file, { upsert: false, cacheControl: "3600", contentType: file.type || "application/octet-stream" });
          // vincula à conciliação (cria se não existir)
          const { data: existente } = await context.supabase
            .from("conciliacoes").select("id").eq("empresa_id", doc.empresa_id).eq("competencia", competencia).maybeSingle();
          if (existente) {
            await context.supabase.from("conciliacoes").update({ extrato_csv_url: concPath, status: "em_andamento" }).eq("id", existente.id);
          } else {
            await context.supabase.from("conciliacoes")
              .insert({ empresa_id: doc.empresa_id, competencia, extrato_csv_url: concPath, status: "em_andamento" } as never);
          }
        }
      }
      await context.supabase.from("documentos").update({
        tipo: "extrato", lancamentos_gerados: 0,
        status: "processado", status_processamento: "classificado",
      }).eq("id", data.id);
    } else {
      await context.supabase.from("documentos").update({ tipo: data.tipo }).eq("id", data.id);
    }
    return { ok: true, mudou: true };
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

// Detalhe da conciliação de um cliente numa competência (com resultado do motor).
export const getConciliacaoDetalhe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string; competencia?: string }) => z.object({ empresa_id: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const competencia = data.competencia ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const { data: empresa, error: eErr } = await context.supabase
      .from("empresas")
      .select("id, razao_social")
      .eq("id", data.empresa_id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!empresa) throw new Error("Empresa não encontrada");

    const [{ data: conc }, { data: extratoDoc }, lancsRes] = await Promise.all([
      context.supabase
        .from("conciliacoes")
        .select("id, competencia, status, divergencias_count, razao_csv_url, extrato_csv_url, resultado")
        .eq("empresa_id", data.empresa_id)
        .eq("competencia", competencia)
        .maybeSingle(),
      // Documento extrato da competência (pra pegar saldo_inicial/saldo_final
      // que a IA extraiu nos dados_extraidos).
      context.supabase
        .from("documentos")
        .select("id, arquivo_nome, classificacao_ia, dados_extraidos, recebido_em")
        .eq("empresa_id", data.empresa_id)
        .eq("competencia", competencia)
        .eq("tipo", "extrato")
        .order("recebido_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("lancamentos")
        .select("id, documento_id, valor, natureza_movimento", { count: "exact", head: false })
        .eq("empresa_id", data.empresa_id)
        .eq("competencia", competencia),
    ]);

    // Extrai saldos do que a IA já parseou (suporta chaves comuns em PT/EN).
    function pickNumero(obj: Record<string, unknown> | null | undefined, chaves: string[]): number | null {
      if (!obj || typeof obj !== "object") return null;
      for (const k of chaves) {
        const v = (obj as Record<string, unknown>)[k];
        if (v == null || v === "") continue;
        const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
        if (!Number.isNaN(n)) return n;
      }
      return null;
    }
    let saldoInicial: number | null = null;
    let saldoFinal: number | null = null;
    if (extratoDoc) {
      const ci = extratoDoc.classificacao_ia as Record<string, unknown> | null;
      const dados = (ci?.dados_extraidos ?? extratoDoc.dados_extraidos) as Record<string, unknown> | null;
      saldoInicial = pickNumero(dados, ["saldo_inicial", "saldo_inicio", "saldo_anterior", "opening_balance", "balance_start"]);
      saldoFinal = pickNumero(dados, ["saldo_final", "saldo_atual", "saldo_disponivel", "closing_balance", "balance_end"]);
    }

    // Lançamentos por origem + soma considerando débito/crédito (não soma cega).
    const rows = (lancsRes.data ?? []) as { id: string; documento_id: string | null; valor: number | string | null; natureza_movimento: string | null }[];
    const totalLancs = rows.length;
    const somaComDC = (arr: typeof rows) => arr.reduce((acc, l) => {
      const v = Math.abs(Number(l.valor ?? 0));
      if (!Number.isFinite(v) || v === 0) return acc;
      if (l.natureza_movimento === "credito") { acc.credito += v; acc.liquido += v; }
      else if (l.natureza_movimento === "debito") { acc.debito += v; acc.liquido -= v; }
      // Sem natureza_movimento não entra no líquido (evita "soma cega").
      return acc;
    }, { debito: 0, credito: 0, liquido: 0 });

    const extratoLancsRows = rows.filter((l) => l.documento_id === extratoDoc?.id);
    const outrosLancsRows = rows.filter((l) => l.documento_id !== extratoDoc?.id);
    const extratoSums = somaComDC(extratoLancsRows);
    const outrosSums = somaComDC(outrosLancsRows);

    // Fallback saldo final = saldo inicial + líquido do extrato (crédito - débito).
    const saldoFinalCalc = saldoInicial != null ? saldoInicial + extratoSums.liquido : null;

    return {
      empresa,
      competencia,
      conciliacao: conc ?? null,
      extrato: extratoDoc ? {
        id: extratoDoc.id,
        arquivo_nome: extratoDoc.arquivo_nome,
        recebido_em: extratoDoc.recebido_em,
        saldo_inicial: saldoInicial,
        saldo_final: saldoFinal ?? saldoFinalCalc,
        movimentacao_debito: extratoSums.debito,
        movimentacao_credito: extratoSums.credito,
        movimentacao_liquida: extratoSums.liquido,
      } : null,
      outros_lancamentos: outrosLancsRows.length,
      outros_valor_debito: outrosSums.debito,
      outros_valor_credito: outrosSums.credito,
      outros_valor_liquido: outrosSums.liquido,
      total_lancamentos: totalLancs,
    };
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

// Cockpit operacional: status agregado de cada automação para a view executiva.
export const getCockpitIntegracoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agora = new Date();
    const h24 = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const h7d = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      integracoesRes,
      docsGesttaRes,
      docs24hRes,
      lancIaRes,
      lancMesRes,
      planilhasMesRes,
      cerebroChamadasRes,
      ultimoLancRes,
    ] = await Promise.all([
      context.supabase.from("integracoes").select("*"),
      context.supabase.from("documentos").select("id, recebido_em").eq("origem", "gestta").order("recebido_em", { ascending: false }).limit(1),
      context.supabase.from("documentos").select("id", { count: "exact", head: true }).gte("recebido_em", h24),
      context.supabase.from("lancamentos").select("id", { count: "exact", head: true }).gte("created_at", h24).not("confidence", "is", null),
      context.supabase.from("lancamentos").select("id", { count: "exact", head: true }).gte("created_at", h7d).not("valor", "is", null),
      context.supabase.from("lancamentos").select("id", { count: "exact", head: true }).gte("created_at", h7d).eq("status", "gerada").is("valor", null),
      context.supabase.from("cerebro_interactions").select("id, created_at").gte("created_at", h24).order("created_at", { ascending: false }).limit(50),
      context.supabase.from("lancamentos").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const integracoes = integracoesRes.data ?? [];
    const conectadaStatus = new Set(["configurado", "conectado", "ativo"]);
    const find = (tipo: string) => integracoes.find((i) => i.tipo === tipo);

    const gestta = find("gestta");
    const claude = find("claude_api");
    const sci = find("sci");
    const leveldrive = find("leveldrive");
    const sharepoint = find("sharepoint");

    const ultimoDocGestta = docsGesttaRes.data?.[0]?.recebido_em ?? null;
    const ultimoLanc = ultimoLancRes.data?.[0]?.created_at ?? null;
    const ultimoCerebro = cerebroChamadasRes.data?.[0]?.created_at ?? null;

    const automacoes = [
      {
        tipo: "gestta",
        nome: "Gestta",
        categoria: "Documentos",
        conectada: conectadaStatus.has(gestta?.status ?? ""),
        ultimaAt: ultimoDocGestta,
        metrica1: { label: "Docs recebidos 24h", value: docs24hRes.count ?? 0 },
        metrica2: { label: "Última sincronização", value: ultimoDocGestta ? "ok" : "—" },
        descricao: "Pull contínuo de documentos enviados pelos clientes.",
      },
      {
        tipo: "claude_api",
        nome: "Claude (IA)",
        categoria: "Inteligência",
        conectada: conectadaStatus.has(claude?.status ?? ""),
        ultimaAt: ultimoCerebro ?? ultimoLanc,
        metrica1: { label: "Lançamentos com IA 24h", value: lancIaRes.count ?? 0 },
        metrica2: { label: "Chamadas Cérebro 24h", value: cerebroChamadasRes.data?.length ?? 0 },
        descricao: "Classificação, regra IA, conciliação e Cérebro consultivo.",
      },
      {
        tipo: "sci",
        nome: "SCI Único",
        categoria: "Contábil",
        conectada: conectadaStatus.has(sci?.status ?? ""),
        ultimaAt: ultimoLanc,
        metrica1: { label: "Lançamentos 7d", value: lancMesRes.count ?? 0 },
        metrica2: { label: "Planilhas geradas 7d", value: planilhasMesRes.count ?? 0 },
        descricao: "Razão SCI gerado a partir dos lançamentos conciliados.",
      },
      {
        tipo: "leveldrive",
        nome: "LevelDrive",
        categoria: "Armazenamento",
        conectada: conectadaStatus.has(leveldrive?.status ?? ""),
        ultimaAt: leveldrive?.atualizado_em ?? null,
        metrica1: { label: "Pasta", value: ((leveldrive?.config as Record<string, string> | null)?.path) ? "ok" : "—" },
        metrica2: { label: "Sincronização", value: leveldrive?.status === "configurado" ? "ativa" : "pendente" },
        descricao: "Backup automático de documentos e relatórios.",
      },
      {
        tipo: "sharepoint",
        nome: "SharePoint",
        categoria: "Armazenamento",
        conectada: conectadaStatus.has(sharepoint?.status ?? ""),
        ultimaAt: sharepoint?.atualizado_em ?? null,
        metrica1: { label: "URL configurada", value: ((sharepoint?.config as Record<string, string> | null)?.folder_url) ? "ok" : "—" },
        metrica2: { label: "Sincronização", value: sharepoint?.status === "configurado" ? "ativa" : "pendente" },
        descricao: "Repositório corporativo de documentos.",
      },
    ];

    const conectadas = automacoes.filter((a) => a.conectada).length;
    return { gerado_em: agora.toISOString(), total: automacoes.length, conectadas, automacoes };
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
      p_avatar: data.avatar_url ?? "",
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
      .select("codigo, descricao, tipo, ativo, sci_apelido")
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

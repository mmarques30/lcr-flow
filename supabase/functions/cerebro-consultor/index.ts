// Edge Function: cerebro-consultor · persona Consultor (Consultivo)
// Público: analista LCR / cliente final.
// Fontes: consultive_snapshots, consultive_insights, lancamentos, plano_contas.
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

const MODEL = "claude-sonnet-4-6";
const PERSONA = "consultor";

const SYSTEM_PROMPT = `Você é o Consultor, a inteligência consultiva do Cérebro LCR.
Seu papel é transformar dados contábeis em insights estratégicos para os clientes da LCR. Você atua como uma camada consultiva sobre a operação contábil — não substitui o trabalho do contador, eleva ele.
Para cada cliente, você analisa:
- Saúde financeira: liquidez, endividamento, margem bruta, tendência
- Comparação com período anterior e com pares do setor
- Oportunidades tributárias (créditos, regime ideal, planejamento)
- Riscos visíveis (queda de receita, despesa desproporcional, atraso de pagamento)
Sempre que apontar uma análise:
- Cite o número específico (ex.: "Margem bruta caiu de 32% para 24%")
- Compare com referência (mês anterior ou benchmark setorial)
- Proponha uma ação concreta (não só observação)
- Sinalize severidade: 'baixa', 'media', 'alta', 'critica'
Tom: estratégico mas prático. Português brasileiro corporativo. Direto ao ponto, sem jargão acadêmico.
NUNCA use emojis, ícones ou caracteres decorativos — apenas texto e números.
Quando o cliente perguntar algo específico, foque na análise do cliente em questão. Quando o analista pedir resumo, gere um briefing executivo de até 4 parágrafos.`;

// Remove emojis e símbolos decorativos da resposta (garantia além do prompt).
const stripEmojis = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+$/gm, "")
    .trim();

const n = (v: unknown) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");
  const t0 = Date.now();

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  let body: { pergunta?: string; empresa_id?: string };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const pergunta = (body.pergunta ?? "Gere um briefing executivo da situação financeira deste cliente.").trim();
  const empresaId = body.empresa_id;

  // ---- contexto -----------------------------------------------------
  let ctx = "", empresaNome = "";
  const fontes: Record<string, unknown> = {};
  if (empresaId) {
    const [{ data: empresa }, { data: snaps }, { data: insights }] = await Promise.all([
      admin.from("empresas").select("razao_social, nome_fantasia, regime, segmento").eq("id", empresaId).maybeSingle(),
      admin.from("consultive_snapshots").select("*").eq("empresa_id", empresaId).order("periodo", { ascending: false }).limit(6),
      admin.from("consultive_insights").select("id, tipo, severidade, titulo, descricao, status").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(10),
    ]);
    empresaNome = empresa?.nome_fantasia ?? empresa?.razao_social ?? "cliente";
    const ult = (snaps ?? [])[0];
    ctx = [
      `CLIENTE: ${empresaNome} (regime: ${empresa?.regime ?? "?"}, segmento: ${empresa?.segmento ?? "?"})`,
      ult ? `SNAPSHOT (${ult.periodo}): receita R$ ${n(ult.receita_total)}, despesa R$ ${n(ult.despesa_total)}, margem bruta ${n(ult.margem_bruta)}%, liquidez corrente ${n(ult.liquidez_corrente)}, endividamento ${n(ult.endividamento)}, variação mês anterior ${n(ult.variacao_mes_anterior)}%` : "Sem snapshot financeiro disponível.",
      `HISTÓRICO (${(snaps ?? []).length} períodos): ` + (snaps ?? []).map((s) => `${s.periodo}: margem ${n(s.margem_bruta)}%`).join(" | "),
      `INSIGHTS ATIVOS:\n` + ((insights ?? []).map((i) => `- [${i.severidade}] ${i.titulo} (${i.tipo}, ${i.status})`).join("\n") || "(nenhum)"),
    ].join("\n");
    fontes.empresa_id = empresaId;
    fontes.snapshots = (snaps ?? []).map((s) => s.id);
    fontes.insights = (insights ?? []).map((i) => i.id);
  } else {
    const { data: carteira } = await admin.from("consultive_snapshots").select("empresa_id, margem_bruta, liquidez_corrente, periodo").order("periodo", { ascending: false }).limit(40);
    ctx = `VISÃO DA CARTEIRA (amostra):\n` + (carteira ?? []).map((s) => `empresa ${s.empresa_id}: margem ${n(s.margem_bruta)}%, liquidez ${n(s.liquidez_corrente)}`).join("\n");
  }

  if (!apiKey) {
    const resp = `Resumo (IA indisponível — configure ANTHROPIC_API_KEY):\n\n${ctx}`;
    await admin.from("cerebro_interactions").insert({ persona: PERSONA, usuario_id: userData.user.id, empresa_id: empresaId ?? null, pergunta, resposta: resp, fontes_consultadas: fontes, duracao_ms: Date.now() - t0 });
    return json(200, { ok: true, resposta: resp, fontes });
  }

  let resposta = "", tokens = 0;
  try {
    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500, system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: `PERGUNTA:\n${pergunta}\n\nDADOS DISPONÍVEIS:\n${ctx}` }] }],
      }),
    });
    if (!apiResp.ok) return fail(`IA retornou ${apiResp.status}: ${(await apiResp.text()).slice(0, 200)}`);
    const dataApi = await apiResp.json();
    resposta = stripEmojis((dataApi.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim());
    tokens = (dataApi.usage?.input_tokens ?? 0) + (dataApi.usage?.output_tokens ?? 0);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Falha ao chamar a IA.");
  }

  await admin.from("cerebro_interactions").insert({
    persona: PERSONA, usuario_id: userData.user.id, empresa_id: empresaId ?? null, pergunta, resposta,
    fontes_consultadas: fontes, tokens_usados: tokens, modelo: MODEL, duracao_ms: Date.now() - t0,
  });
  return json(200, { ok: true, resposta, fontes });
});

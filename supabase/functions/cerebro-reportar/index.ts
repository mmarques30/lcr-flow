// Edge Function: cerebro-reportar · persona Reportar (coletor conversacional)
// Comportamento: 4 primeiras personas respondem perguntas. Reportar coleta
// informação em turnos e, quando tem tipo+titulo+descricao mínimos, grava em
// public.oportunidades e retorna número OPT-XXXX.
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
const PERSONA = "reportar";

const SYSTEM_PROMPT = `Você é o Reportar, o coletor conversacional de oportunidades do time LCR.
Sua função: capturar bug, melhoria ou dúvida da equipe SEM perder a informação.

REGRA DE OURO
Registre CEDO. É melhor uma oportunidade incompleta salva agora do que uma completa que nunca chega. Se a primeira mensagem já der pra inferir tipo + descrição, chame IMEDIATAMENTE a tool "salvar_oportunidade" e SÓ DEPOIS peça detalhes (impacto, frequência, etc) para enriquecer o registro.

TIPO — inferir agressivamente sem perguntar quando possível:
- Menciona erro, não funciona, quebrou, travou, sumiu, buga → bug
- Menciona seria bom, deveria, faltando, queria, sugestão → melhoria
- Menciona como faço, onde encontro, dúvida sobre → duvida
Só pergunte o tipo se realmente ambíguo.

TÍTULO E DESCRIÇÃO
- titulo: 1 linha imperativa que resume o pedido. Use suas palavras se o usuário foi vago
- descricao: junte tudo que o usuário disse. Vazio nunca — mínimo 1 frase

DEPOIS DE SALVAR (importante!)
- Confirme com "Registrado como OPT-XXXX"
- Nas próximas mensagens do usuário, ENRIQUEÇA o mesmo registro chamando salvar_oportunidade de novo com o mesmo tipo/titulo mas descrição expandida e impacto/frequência preenchidos

REGRAS
- Tom: rápido, cordial, sem burocracia
- Nunca invente dados. Se o usuário não informou, deixe null
- Se for pergunta contábil, redirecione ao Mestre — não salve oportunidade`;

const TOOL_SALVAR = {
  name: "salvar_oportunidade",
  description: "Salva a oportunidade coletada. Chame apenas quando tiver tipo, título e descrição consolidados.",
  input_schema: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: ["bug", "melhoria", "duvida"] },
      titulo: { type: "string", description: "1 linha, imperativa e específica" },
      descricao: { type: "string", description: "3-5 linhas com o cenário completo" },
      impacto: { type: ["string", "null"], enum: ["bloqueia", "atrapalha", "cosmetico", null] },
      frequencia_uso: { type: ["string", "null"] },
      problema_resolve: { type: ["string", "null"] },
      cliente_id: { type: ["string", "null"] },
      tela_origem: { type: ["string", "null"] },
    },
    required: ["tipo", "titulo", "descricao"],
  },
};

type Turno = { role: "user" | "assistant"; content: string };

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

  let body: {
    pergunta?: string;
    conversation_context?: Turno[];
    tela?: string;
    empresa_id?: string;
    oportunidade_id?: string;
  };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const pergunta = (body.pergunta ?? "").trim();
  const historico = body.conversation_context ?? [];
  const tela = body.tela ?? null;
  const empresaId = body.empresa_id ?? null;
  const oportunidadeIdExistente = body.oportunidade_id ?? null;
  if (!pergunta) return fail("Pergunta vazia.");

  if (!apiKey) return fail("Configure ANTHROPIC_API_KEY.");

  const messages = [
    ...historico.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: pergunta },
  ];

  const sysComContexto = `${SYSTEM_PROMPT}\n\nContexto atual: tela=${tela ?? "?"}, empresa=${empresaId ?? "?"}.`;

  let resposta = "";
  let oportunidadeCriada: { numero: string; id: string } | null = null;
  let anti: unknown[] = [];

  try {
    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: sysComContexto,
        tools: [TOOL_SALVAR],
        messages,
      }),
    });
    if (!apiResp.ok) return fail(`IA retornou ${apiResp.status}: ${(await apiResp.text()).slice(0, 200)}`);
    const dataApi = await apiResp.json();
    const blocks = (dataApi.content ?? []) as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    resposta = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    const toolUse = blocks.find((b) => b.type === "tool_use" && b.name === "salvar_oportunidade");
    if (toolUse?.input) {
      const inp = toolUse.input as Record<string, unknown>;
      const tipo = String(inp.tipo ?? "");
      const titulo = String(inp.titulo ?? "").trim();
      const descricao = String(inp.descricao ?? "").trim();
      if (["bug", "melhoria", "duvida"].includes(tipo) && titulo && descricao) {
        if (oportunidadeIdExistente) {
          // Turno subsequente: enriquece a mesma oportunidade
          const { data: atual, error: errUpd } = await admin.from("oportunidades")
            .update({
              tipo, titulo, descricao,
              impacto: (inp.impacto as string) ?? null,
              frequencia_uso: (inp.frequencia_uso as string) ?? null,
              problema_resolve: (inp.problema_resolve as string) ?? null,
            })
            .eq("id", oportunidadeIdExistente)
            .select("id, numero").single();
          if (errUpd) {
            resposta = `${resposta}\n\nErro ao enriquecer: ${errUpd.message}`;
          } else {
            oportunidadeCriada = atual as { numero: string; id: string };
            if (!resposta) resposta = `Atualizei o registro ${atual.numero} com os novos detalhes.`;
          }
        } else {
          const { data: similares } = await admin
            .from("oportunidades")
            .select("id, numero, titulo, status")
            .neq("status", "descartado").neq("status", "entregue")
            .ilike("titulo", `%${titulo.slice(0, 40)}%`).limit(3);
          anti = similares ?? [];

          const { data: nova, error: errNova } = await admin.from("oportunidades").insert({
            autor_id: userData.user.id,
            numero: "",
            tipo,
            titulo,
            descricao,
            tela_origem: (inp.tela_origem as string) ?? tela,
            cliente_id: (inp.cliente_id as string) ?? empresaId,
            impacto: (inp.impacto as string) ?? null,
            frequencia_uso: (inp.frequencia_uso as string) ?? null,
            problema_resolve: (inp.problema_resolve as string) ?? null,
          }).select("id, numero").single();
          if (errNova) {
            resposta = `${resposta}\n\nErro ao salvar: ${errNova.message}`;
          } else {
            oportunidadeCriada = nova as { numero: string; id: string };
            if (!resposta) {
              resposta = `Registrado como ${nova.numero} · ${tipo}. Bruno recebe hoje. Você acompanha em Gestão › Oportunidades.`;
            } else if (!resposta.includes(nova.numero)) {
              resposta = `${resposta}\n\nNúmero: ${nova.numero}.`;
            }
          }
        }
      }
    }

    // Fallback: se após 3+ turnos do usuário ainda não salvou nada, força salvamento
    // com o que tem — evita perder informação quando a IA fica só perguntando.
    const turnosUser = historico.filter((h) => h.role === "user").length + 1;
    if (!oportunidadeCriada && !oportunidadeIdExistente && turnosUser >= 3) {
      const descAcum = [...historico.filter((h) => h.role === "user").map((h) => h.content), pergunta].join("\n---\n");
      const { data: fb } = await admin.from("oportunidades").insert({
        autor_id: userData.user.id,
        numero: "",
        tipo: "duvida",
        titulo: pergunta.slice(0, 80),
        descricao: descAcum,
        tela_origem: tela,
        cliente_id: empresaId,
      }).select("id, numero").single();
      if (fb) {
        oportunidadeCriada = fb as { numero: string; id: string };
        resposta = `${resposta}\n\nRegistrei o que você me contou até aqui como ${fb.numero} para não perdermos. Se for bug ou melhoria em vez de dúvida, me avisa que ajusto.`;
      }
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Falha ao chamar a IA.");
  }

  await admin.from("cerebro_interactions").insert({
    persona: PERSONA, usuario_id: userData.user.id,
    pergunta,
    resposta,
    fontes_consultadas: { oportunidade_id: oportunidadeCriada?.id ?? null, similares: anti, tela, empresa_id: empresaId },
    modelo: MODEL, duracao_ms: Date.now() - t0,
  });

  return json(200, {
    ok: true,
    resposta,
    oportunidade: oportunidadeCriada,
    oportunidade_id: oportunidadeCriada?.id ?? oportunidadeIdExistente ?? null,
    similares: anti,
    conversation_context: [...historico, { role: "user", content: pergunta }, { role: "assistant", content: resposta }],
  });
});

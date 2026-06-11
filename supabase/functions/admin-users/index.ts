// Edge Function: admin-users
// Cria e exclui usuários (auth.users) usando a service-role key.
// Protegida: só perfis 'admin' podem executar. JWT verificado pela plataforma.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Erros de negócio voltam como 200 { ok:false } para o cliente ler a mensagem facilmente.
const fail = (error: string) => json(200, { ok: false, error });

const PERFIS = ["admin", "consultor", "assistente"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // identifica o chamador pelo token e exige perfil admin
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  const { data: perfilRow } = await admin
    .from("usuarios_perfil")
    .select("perfil")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (perfilRow?.perfil !== "admin") return json(403, { error: "Apenas administradores" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const action = body.action;

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const nome = String(body.nome ?? "").trim();
    const perfil = String(body.perfil ?? "assistente");
    const permissoes_custom = Array.isArray(body.permissoes_custom) ? body.permissoes_custom as string[] : null;
    if (!email || !email.includes("@")) return fail("E-mail inválido");
    if (!nome) return fail("Nome obrigatório");
    if (!PERFIS.includes(perfil)) return fail("Perfil inválido");

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (error || !created.user) return fail(error?.message ?? "Falha ao criar usuário");

    // o trigger handle_new_user cria o perfil; garantimos nome/perfil/permissões
    const { error: upErr } = await admin
      .from("usuarios_perfil")
      .upsert({ user_id: created.user.id, nome, email, perfil, permissoes_custom, ativo: true }, { onConflict: "user_id" });
    if (upErr) return fail(upErr.message);

    // dispara e-mail de definição de senha (convite/recuperação)
    await admin.auth.admin.generateLink({ type: "recovery", email }).catch(() => {});
    return json(200, { ok: true, user_id: created.user.id });
  }

  if (action === "delete") {
    const user_id = String(body.user_id ?? "");
    if (!user_id) return fail("user_id obrigatório");
    if (user_id === userData.user.id) return fail("Você não pode excluir a si mesmo.");
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) return fail(error.message);
    return json(200, { ok: true });
  }

  return fail("Ação desconhecida");
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bootstrap-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email, password, nome, token } = await request.json();
        if (token !== "lcr-bootstrap-2026") return new Response("forbidden", { status: 403 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { nome },
        });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return new Response(JSON.stringify({ id: data.user?.id }), { status: 200 });
      },
    },
  },
});

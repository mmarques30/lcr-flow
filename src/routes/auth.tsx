import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LcrLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "LCR Contábil — Entrar" },
      { name: "description", content: "Plataforma interna LCR Contábil — Integração e Conciliação Bancária." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/app", replace: true });
    });
  }, [navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/app", replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <LcrLogo size={72} />
          <div className="mt-8 text-[0.7rem] tracking-[0.22em] uppercase text-muted-foreground">
            Acesso restrito
          </div>
          <h1 className="mt-3 font-display text-3xl text-foreground tracking-tight">
            Bem-vindo
          </h1>
          <p className="mt-2 text-sm text-soft-foreground">
            Entre com sua conta da equipe LCR.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 mt-10">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-full px-5"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-full px-5"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className="w-full mt-2 bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Contas são provisionadas internamente pela administração LCR.
        </p>
      </div>
    </div>
  );
}

// Config própria de vitest, separada de vite.config.ts — aquele arquivo é
// gerenciado pelo wrapper @lovable.dev/vite-tanstack-config (comentário no
// topo dele já avisa pra não adicionar plugins/config manualmente ali).
// Mantendo os dois totalmente separados evitamos qualquer risco de
// interferir no build/dev gerenciado pela Lovable.
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Espelha só o alias "@/*" -> "src/*" do tsconfig — o resto do wrapper de
  // vite (plugins, env injection etc.) não é necessário pra testes unitários.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

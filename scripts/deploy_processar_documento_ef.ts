/**
 * Deploy da Edge Function processar-documento (grammar fix + mapa + dedup).
 * Requer no .env: SUPABASE_ACCESS_TOKEN (PAT em supabase.com/dashboard/account/tokens)
 * Uso: bun run scripts/deploy_processar_documento_ef.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function loadEnv() {
  const path = resolve(import.meta.dir, "../.env");
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_ID ?? "slewrhdxxtqcdsnpxxwo";

if (!token) {
  console.error("[ERRO] Defina SUPABASE_ACCESS_TOKEN no .env");
  console.error("       Gere em: https://supabase.com/dashboard/account/tokens");
  process.exit(1);
}

const r = spawnSync(
  "supabase",
  ["functions", "deploy", "processar-documento", "--project-ref", ref, "--no-verify-jwt"],
  {
    cwd: resolve(import.meta.dir, ".."),
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
  },
);

if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.error) console.error(r.error.message);

process.exit(r.status ?? 1);

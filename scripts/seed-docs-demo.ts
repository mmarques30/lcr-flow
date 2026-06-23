/**
 * Seed dos 5 documentos exemplo para a validação 23/06.
 * NÃO roda automaticamente. Rodar manualmente:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/seed-docs-demo.ts
 *
 * Sobe cada PDF de docs-demo/ para o bucket documentos-clientes, cria o
 * registro em `documentos` (status_processamento = pendente) e dispara a
 * edge function processar-documento (que classifica e cria os lançamentos).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const COMPETENCIA = "2026-06";
const docs: { file: string; apelido: string; tipo: string }[] = [
  { file: "docs-demo/01-extrato-cava-jun2026.pdf", apelido: "CAVA", tipo: "extrato" },
  { file: "docs-demo/02-nfe-a2h.pdf", apelido: "A2H", tipo: "nf_saida" },
  { file: "docs-demo/03-planilha-codegee.pdf", apelido: "CODEGEE", tipo: "planilha_financeira" },
  { file: "docs-demo/04-darf-nutrimap.pdf", apelido: "NUTRIMAP", tipo: "darf" },
  { file: "docs-demo/05-recibo-a1.pdf", apelido: "A1", tipo: "recibo" },
];

for (const d of docs) {
  const { data: empresa } = await supabase.from("empresas").select("id, razao_social").eq("nome_fantasia", d.apelido).maybeSingle();
  if (!empresa) { console.warn(`Empresa ${d.apelido} não encontrada — pulando.`); continue; }

  const fileBuffer = readFileSync(d.file);
  const filename = d.file.split("/").pop()!;
  const path = `${empresa.id}/${COMPETENCIA}/auto/${filename}`;

  const { error: upErr } = await supabase.storage
    .from("documentos-clientes")
    .upload(path, fileBuffer, { contentType: "application/pdf", upsert: true });
  if (upErr) { console.error(`Upload ${filename} falhou: ${upErr.message}`); continue; }

  const { data: doc, error: insErr } = await supabase
    .from("documentos")
    .insert({
      empresa_id: empresa.id,
      tipo: d.tipo,
      competencia: COMPETENCIA,
      storage_path: path,
      arquivo_url: path,
      arquivo_nome: filename,
      mime_type: "application/pdf",
      tamanho_bytes: fileBuffer.byteLength,
      arquivo_tamanho_bytes: fileBuffer.byteLength,
      origem: "upload_manual",
      status: "recebido",
      status_processamento: "pendente",
    })
    .select()
    .single();
  if (insErr || !doc) { console.error(`Insert ${filename} falhou: ${insErr?.message}`); continue; }

  const { data: proc, error: fnErr } = await supabase.functions.invoke("processar-documento", { body: { documento_id: doc.id } });
  if (fnErr) console.error(`Processamento ${filename} falhou: ${fnErr.message}`);
  else console.log(`${filename} → ${d.apelido}: ${(proc as { lancamentos_gerados?: number })?.lancamentos_gerados ?? 0} lançamento(s).`);
}

console.log("Seed concluído.");

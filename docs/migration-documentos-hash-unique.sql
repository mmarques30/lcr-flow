-- Idempotência de upload de documentos por conteúdo (SHA256).
-- Aplicar no Supabase SQL Editor (convenção Lovable). Opcional: copiar p/
-- supabase/migrations/ na branch main como registro.
--
-- Índice UNIQUE PARCIAL: só vale para linhas COM hash preenchido — as linhas
-- antigas (hash_sha256 IS NULL) não conflitam entre si, então é seguro aplicar
-- sem backfill. O agente (src/bridge_front.py) já popula hash_sha256 nos novos
-- documentos e checa duplicata antes de inserir (documento_existente).

CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_empresa_hash
  ON public.documentos (empresa_id, hash_sha256)
  WHERE hash_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_hash
  ON public.documentos (hash_sha256);

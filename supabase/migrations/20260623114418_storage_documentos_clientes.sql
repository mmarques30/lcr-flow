-- Bucket privado para documentos dos clientes (TO-BE 23/06)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos-clientes', 'documentos-clientes', FALSE, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documentos_clientes_read" ON storage.objects;
CREATE POLICY "documentos_clientes_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'documentos-clientes');

DROP POLICY IF EXISTS "documentos_clientes_insert" ON storage.objects;
CREATE POLICY "documentos_clientes_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documentos-clientes');

DROP POLICY IF EXISTS "documentos_clientes_update" ON storage.objects;
CREATE POLICY "documentos_clientes_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'documentos-clientes');

DROP POLICY IF EXISTS "documentos_clientes_delete" ON storage.objects;
CREATE POLICY "documentos_clientes_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'documentos-clientes');

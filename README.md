# LCR Contábil

Sistema interno da LCR para integração de documentos, lançamentos contábeis e
conciliação bancária dos clientes. Frontend em React + TanStack Start + Vite,
backend e banco no **Supabase (PostgreSQL)**.

## Stack

- **Frontend:** React, TanStack Start/Router, Vite, TypeScript, Tailwind
- **Banco/Auth/Storage:** Supabase (PostgreSQL + RLS)
- **Gerenciador:** Bun

## Desenvolvimento

```bash
bun install
bun run dev
```

Variáveis de ambiente em `.env` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, etc.).

## Banco de dados (Supabase)

Toda a estrutura do banco é versionada em migrações SQL em
[`supabase/migrations/`](./supabase/migrations) e aplicada pelo Supabase CLI.

### Aplicar localmente

```bash
supabase start        # sobe Postgres + Studio locais (requer Docker)
supabase db reset     # recria o banco e aplica todas as migrações + seeds
```

### Aplicar em produção

```bash
supabase link --project-ref slewrhdxxtqcdsnpxxwo
supabase db push      # envia as migrações pendentes ao projeto remoto
```

### Gerar tipos TypeScript

```bash
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

O modelo de dados, as decisões de design e os desvios conscientes em relação à
especificação estão documentados em
[`supabase/README.md`](./supabase/README.md).

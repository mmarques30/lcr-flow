# Banco de Dados — LCR Contábil (Supabase / PostgreSQL)

Estrutura do banco versionada em migrações SQL. Cada arquivo em
[`migrations/`](./migrations) tem um timestamp no nome e é aplicado em ordem
cronológica pelo Supabase CLI.

## Migrações

| Arquivo | Descrição |
|---|---|
| `20260605115428_*.sql` | Schema base gerado inicialmente (enums, tabelas, RLS, seeds demo). |
| `20260605120000_lcr_schema_spec_alignment.sql` | **Alinhamento com a especificação** — adiciona valores de enum, colunas (`gestta_ref`, `processado_em`, `documento_id`, `linhas_count`, `razao_csv_url`, `competencia` em tarefas, `tipo` em contas, `ultima_sync`, `ativo`…), índices compostos, a tabela `audit_log`, triggers de auditoria e `updated_at`, função `is_admin()` e reforço de RLS. |
| `20260605120100_lcr_seeds_spec.sql` | Seeds complementares — 1 admin + 2 consultores, distribuição de `consultor_id`, 2 contas bancárias por empresa, 3 tarefas da competência atual, integração `claude_api`. |

## Modelo de dados

Tabelas em `public`: `empresas`, `contas_bancarias`, `documentos_esperados`,
`documentos`, `lancamentos`, `conciliacoes`, `tarefas`, `usuarios_perfil`,
`integracoes`, `audit_log`.

- **RLS** habilitado em todas. Política padrão: usuários `authenticated`
  podem `SELECT/INSERT/UPDATE/DELETE` (uso interno LCR).
- **`audit_log`**: escrita apenas por trigger (`SECURITY DEFINER`); leitura
  restrita a perfil `admin` (via função `is_admin()`).
- **Triggers de auditoria** em `UPDATE`/`DELETE` de `empresas`, `documentos`,
  `lancamentos`, `conciliacoes`, `tarefas`.
- **`updated_at`** mantido automaticamente em todas as tabelas que o possuem.

## Como aplicar

### Pré-requisitos
- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado (`npm i -g supabase` ou `brew install supabase/tap/supabase`)
- Docker (para o stack local)

### Local (desenvolvimento)

```bash
# na raiz do repositório
supabase start                # sobe Postgres + Studio locais
supabase db reset             # recria o banco e aplica TODAS as migrações + seeds
```

`supabase db reset` apaga e recria o banco local aplicando as migrações em
ordem — ideal para validar o conjunto completo.

Para aplicar apenas migrações novas sem resetar:

```bash
supabase migration up
```

### Produção (projeto remoto)

```bash
# vincula o repo ao projeto remoto (uma vez)
supabase link --project-ref slewrhdxxtqcdsnpxxwo

# envia as migrações pendentes para o banco remoto
supabase db push
```

> O `project_id` já está configurado em [`config.toml`](./config.toml).

### Gerar/atualizar os tipos TypeScript

```bash
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

## Criando novas migrações

```bash
supabase migration new nome_descritivo
# edite o arquivo gerado em supabase/migrations/ e rode:
supabase db reset   # local, para validar
```

## Desvios conscientes em relação à spec

A estratégia adotada foi **"spec por cima, adaptando"**: evoluir o schema
existente (já usado pelo frontend) sem quebrá-lo. Por isso:

1. **`competencia` permanece `TEXT` (`'YYYY-MM'`)** em vez de `DATE`. O
   frontend (`src/lib/lcr.functions.ts`, rotas) filtra por string `YYYY-MM`.
   Migrar para `DATE` exigiria refatorar o app — fica registrado como
   evolução futura.
2. **Status/origem/tipo usam ENUMs** (não `CHECK`). Em vez de trocar o tipo,
   os valores da spec foram **adicionados** aos enums existentes (operação
   não-destrutiva). Valores antigos do app continuam válidos.
3. **`integracoes.status`** mantém o domínio textual existente
   (`desconectado`/…); a spec sugeria `ativa/inativa/erro`. Não foi imposto
   `CHECK` para não invalidar dados/seeds atuais.
4. Colunas equivalentes preexistentes foram mantidas (ex.: `created_at`
   coexiste com a semântica de `criado_em`; `total_lancamentos` coexiste com
   `linhas_count`).

Esses pontos podem ser endurecidos numa migração futura quando o frontend
for ajustado em conjunto.

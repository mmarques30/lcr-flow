-- #138: propagação de correções (conta contábil / participante) por descrição
-- normalizada para lançamentos de meses futuros já processados.
--
-- Regras de negócio (confirmadas com o cliente):
--   * Só propaga para competencia > origem AND >= '2026-01'.
--   * NÃO altera nem reabre meses cuja conciliação já está 'concluida' —
--     evita dessincronia silenciosa com o que já foi exportado pro SCI.
--     (reabertura automática fica para uma fase futura, issue #143)
--   * NÃO sobrescreve lançamentos já confirmados manualmente por um humano
--     (confidence = 1) em meses futuros — só propaga onde a IA ainda decide.
--   * Retorna quantos foram atualizados vs. pulados por cada motivo, para a
--     UI avisar o usuário.
--
-- Segurança: propagar_lancamento_por_descricao() é SECURITY DEFINER e
-- concedida a `authenticated` sem checar se quem chama tem relação com a
-- empresa do lançamento de origem — consistente com a policy hoje vigente
-- em lancamentos ("equipe LCR acessa lancamentos" = USING (true), modelo
-- "equipe = confiança total"). Se algum dia existir login de cliente/portal
-- externo autenticado, esta RPC precisa ganhar uma checagem explícita de
-- propriedade antes de ser exposta a esse papel (hoje só times internos
-- autenticam, então não há escalada de privilégio nova).
--
-- Aplicar via: python scripts/apply_migration_via_api.py <arquivo.sql>
-- (Management API do Supabase com SUPABASE_ACCESS_TOKEN — não depende da
-- senha do Postgres, que não está disponível nos .env deste repo) ou, se
-- SUPABASE_DB_PASSWORD existir, `supabase db push` / conexão direta.

create extension if not exists unaccent;

-- Espelha normalizarDescricao() de src/lib/lcr.functions.ts e
-- supabase/functions/enriquecer-extrato/index.ts: maiúsculas, remove acento,
-- remove dígitos, remove tudo que não for A-Z/espaço, colapsa espaços.
--
-- language plpgsql (não sql): uma função `language sql` aqui é "inlinada"
-- pelo planner e, ao ser usada dentro de um CREATE INDEX, o inlining perde a
-- resolução de nome de unaccent() (ERROR 42883 "function unaccent(text)
-- does not exist" — reproduzido testando a criação do índice abaixo).
-- plpgsql não é inlinado, então evita o problema; search_path fixo também
-- blinda a função contra hijacking via search_path da sessão chamadora.
create or replace function public.normalizar_descricao(p_texto text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  return trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(unaccent(coalesce(p_texto, ''))), '[0-9]+', ' ', 'g'),
        '[^A-Z ]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
end;
$$;

comment on function public.normalizar_descricao(text) is
  'Espelha normalizarDescricao() (TS) — chave de agrupamento para aprendizado/propagação por descrição de lançamento.';

-- Colunas de igualdade primeiro (empresa_id, descrição normalizada), range
-- (competencia) por último — ordem que o planejador consegue usar melhor
-- num btree composto. Sem isso, a busca por "mesma descrição, competências
-- futuras" faz function scan calculando normalizar_descricao() linha a
-- linha sobre todo o histórico da empresa a cada propagação.
create index if not exists idx_lancamentos_empresa_descnorm_competencia
  on public.lancamentos (empresa_id, normalizar_descricao(descricao), competencia);

create or replace function public.propagar_lancamento_por_descricao(p_lancamento_id uuid)
returns table(atualizados int, pulados_concluida int, pulados_confirmados int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row lancamentos%rowtype;
  v_padrao text;
  v_atualizados int := 0;
  v_pulados_concluida int := 0;
  v_pulados_confirmados int := 0;
begin
  select * into v_row from lancamentos where id = p_lancamento_id;

  if v_row.id is null or v_row.descricao is null or v_row.competencia is null
     or v_row.competencia < '2026-01' then
    return query select 0, 0, 0;
    return;
  end if;

  v_padrao := normalizar_descricao(v_row.descricao);
  if v_padrao = '' then
    return query select 0, 0, 0;
    return;
  end if;

  -- Um único statement WITH: o CTE "alvo" só existe dentro do statement em
  -- que é declarado, então o UPDATE precisa estar na MESMA cadeia de CTEs
  -- (não pode ser um statement seguinte reaproveitando "alvo").
  with alvo as (
    select
      l.id,
      l.confidence,
      exists (
        select 1 from conciliacoes c
        where c.empresa_id = l.empresa_id
          and c.competencia = l.competencia
          and c.status = 'concluida'
      ) as mes_concluido
    from lancamentos l
    where l.empresa_id = v_row.empresa_id
      and l.id <> v_row.id
      and l.competencia > v_row.competencia
      and l.competencia >= '2026-01'
      and normalizar_descricao(l.descricao) = v_padrao
  ),
  atualizados_upd as (
    update lancamentos l set
      conta_id = v_row.conta_id,
      part_deb = coalesce(v_row.part_deb, l.part_deb),
      part_cred = coalesce(v_row.part_cred, l.part_cred),
      confidence = 1,
      part_aprendido = true,
      updated_at = now()
    from alvo a
    where l.id = a.id and not a.mes_concluido and a.confidence is distinct from 1
    returning l.id
  )
  select
    (select count(*) from atualizados_upd),
    (select count(*) from alvo where mes_concluido),
    (select count(*) from alvo where not mes_concluido and confidence = 1)
  into v_atualizados, v_pulados_concluida, v_pulados_confirmados;

  return query select v_atualizados, v_pulados_concluida, v_pulados_confirmados;
end;
$$;

comment on function public.propagar_lancamento_por_descricao(uuid) is
  'Issue #138: propaga conta_id/part_deb/part_cred do lançamento p_lancamento_id para lançamentos com a mesma descrição normalizada, mesma empresa, em competências futuras (>= 2026-01) já processadas — pulando meses concluídos e lançamentos já confirmados manualmente.';

grant execute on function public.normalizar_descricao(text) to authenticated, service_role;
grant execute on function public.propagar_lancamento_por_descricao(uuid) to authenticated, service_role;

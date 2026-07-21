-- #138 fix (code review 20/07): o guard anterior de propagar_lancamento_por_descricao
-- usava `confidence = 1` como proxy de "confirmado por um humano" — mas a própria
-- RPC seta confidence=1 no alvo que acabou de atualizar. Resultado: uma 2ª correção
-- da mesma descrição normalizada NUNCA re-propagava para lançamentos futuros que já
-- tinham recebido a 1ª propagação, mesmo que nenhum humano tivesse tocado neles.
--
-- Ex.: Jan corrigido de conta A → conta B, propaga p/ Fev (Fev fica confidence=1,
-- part_aprendido=true). Depois percebe que B também estava errado, corrige Jan p/
-- conta C, propaga de novo → Fev é pulado como "já confirmado manualmente" (toast
-- em src/lib/propagacao-toast.ts), o que é falso — Fev nunca foi editado por humano.
--
-- Distinção correta: part_aprendido=true só é setado por automação — esta própria
-- RPC e o aprendizado do enriquecer-extrato (que não seta confidence junto). Uma
-- edição humana direta (editarLancamento em src/lib/lcr.functions.ts) nunca escreve
-- part_aprendido. Logo `confidence = 1 AND part_aprendido = true` identifica com
-- segurança "propagado/aprendido por automação, não confirmado por humano" — esses
-- ficam elegíveis para receber uma nova propagação; só `confidence = 1 AND NOT
-- part_aprendido` (humano editou aquele lançamento específico, ou IA já veio com
-- confidence máxima) continua protegido.
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

  with alvo as (
    select
      l.id,
      l.confidence,
      l.part_aprendido,
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
    where l.id = a.id
      and not a.mes_concluido
      and (a.confidence is distinct from 1 or a.part_aprendido)
    returning l.id
  )
  select
    (select count(*) from atualizados_upd),
    (select count(*) from alvo where mes_concluido),
    (select count(*) from alvo where not mes_concluido and confidence = 1 and not part_aprendido)
  into v_atualizados, v_pulados_concluida, v_pulados_confirmados;

  return query select v_atualizados, v_pulados_concluida, v_pulados_confirmados;
end;
$$;

comment on function public.propagar_lancamento_por_descricao(uuid) is
  'Issue #138: propaga conta_id/part_deb/part_cred do lançamento p_lancamento_id para lançamentos com a mesma descrição normalizada, mesma empresa, em competências futuras (>= 2026-01) já processadas — pulando meses concluídos e lançamentos genuinamente confirmados por humano (confidence=1 sem ter sido setado por automação/propagação anterior).';

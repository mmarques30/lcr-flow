-- RPC · agregação da planilha SCI a partir dos lançamentos reais
-- Substitui a geração com total aleatório: soma os lançamentos por conta
-- dentro da competência. SECURITY INVOKER → respeita a RLS do usuário logado.

CREATE OR REPLACE FUNCTION public.sci_planilha(p_empresa_id uuid, p_competencia text)
RETURNS TABLE(codigo text, descricao text, tipo text, total numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT pc.codigo, pc.descricao, pc.tipo, SUM(l.valor) AS total
  FROM public.lancamentos l
  JOIN public.plano_contas pc ON pc.id = l.conta_id
  WHERE l.empresa_id = p_empresa_id AND l.competencia = p_competencia
  GROUP BY pc.codigo, pc.descricao, pc.tipo
  ORDER BY pc.codigo;
$$;

GRANT EXECUTE ON FUNCTION public.sci_planilha(uuid, text) TO authenticated, anon, service_role;

-- Correção dos lançamentos demo: o seed anterior usou ORDER BY random() em
-- subquery não-correlacionada, então as 203 linhas receberam a MESMA conta e
-- o MESMO histórico (planilha SCI ficava com 1 linha por empresa). Aqui
-- redistribuímos por conta/histórico de forma determinística e correlacionada
-- por linha (md5 do par id), dando ~180 contas distintas — só afeta dados demo.
UPDATE public.lancamentos l SET
  conta_id = (
    SELECT pc.id FROM public.plano_contas pc
    WHERE pc.ativo AND l.id IS NOT NULL
    ORDER BY md5(pc.id::text || l.id::text) LIMIT 1
  ),
  historico_id = (
    SELECT h.id FROM public.historicos_contabeis h
    WHERE l.id IS NOT NULL
    ORDER BY md5(h.id::text || l.id::text) LIMIT 1
  )
WHERE l.descricao LIKE 'Lancamento demo · pre-validacao 23/06%';

"""Teste de regressão da issue #140 (editar histórico contábil do lançamento).

Não há framework de teste para lcr.functions.ts (server functions do TanStack
Start), então este script valida a PARTE DE DADOS da lógica nova de
`editarLancamento` — o find-or-create em `historicos_contabeis` por empresa e
a sincronização com `hist_sci_codigo` — reproduzindo em SQL exatamente o que o
handler faz, e conferindo que o caminho de leitura existente (join
historico_id → historicos_contabeis.codigo, usado por sci-xls.ts e pelo
painel do cliente) reflete o novo código corretamente.

Usa o cliente sandbox "ZZZ SANDBOX QA - NAO E CLIENTE REAL" (nunca dados
reais). Cria 1 lançamento de teste, "edita" o histórico duas vezes (códigos
diferentes) e confere: (1) hist_sci_codigo e historico_id ficam em sincronia,
(2) não duplica linha em historicos_contabeis ao reusar o mesmo código,
(3) o join legado (o que o export/preview realmente leem) mostra o código novo.
Limpa os dados de teste ao final (sucesso ou falha).

Uso: python scripts/qa_editar_historico.py
Requer SUPABASE_ACCESS_TOKEN em algum dos .env (LCR ou LCR-front).
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_LCR = Path(r"D:\IAPLICADA\LCR")
REPO_FRONT = Path(__file__).resolve().parent.parent
EMPRESA_ID = "46375151-b3da-4a34-af87-8a1f34075f34"  # ZZZ SANDBOX QA
CONTA_INICIAL = "08232675-4d92-4aa7-bd47-9456fd7f4cbb"  # plano_contas global, codigo "10"
DESCRICAO = "TESTE 140 EDITAR HISTORICO"


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def run(sql: str, token: str, project_ref: str):
    url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
    req = urllib.request.Request(
        url,
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; lcr-qa-script/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[ERRO] status={e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
        raise


def simular_editar_historico(codigo: int, token: str, project_ref: str, lancamento_id: str):
    """Reproduz em SQL a lógica nova de editarLancamento (find-or-create +
    sincroniza hist_sci_codigo/historico_id) — mesmo comportamento do handler TS."""
    hist = run(f"select codigo, nome from historicos_sci_lcr where codigo = {codigo};", token, project_ref)
    if not hist:
        raise RuntimeError(f"código {codigo} não existe em historicos_sci_lcr — ajuste o script")
    nome = hist[0]["nome"].replace("'", "''")
    run(f"""
        insert into historicos_contabeis (empresa_id, codigo, descricao)
        select '{EMPRESA_ID}', '{codigo}', '{nome}'
        where not exists (
          select 1 from historicos_contabeis where empresa_id = '{EMPRESA_ID}' and codigo = '{codigo}'
        );
        update lancamentos set
          hist_sci_codigo = {codigo},
          historico_id = (select id from historicos_contabeis where empresa_id = '{EMPRESA_ID}' and codigo = '{codigo}')
        where id = '{lancamento_id}';
    """, token, project_ref)


def main() -> int:
    env = {**load_env(REPO_LCR / ".env"), **load_env(REPO_FRONT / ".env")}
    token = env.get("SUPABASE_ACCESS_TOKEN")
    project_ref = env.get("SUPABASE_PROJECT_ID") or "slewrhdxxtqcdsnpxxwo"
    if not token:
        print("[ERRO] SUPABASE_ACCESS_TOKEN não encontrado em nenhum .env.", file=sys.stderr)
        return 1

    def cleanup():
        run(f"delete from lancamentos where empresa_id = '{EMPRESA_ID}' and descricao = '{DESCRICAO}';", token, project_ref)

    try:
        print("== setup ==")
        cleanup()
        codigos_disponiveis = run("select codigo from historicos_sci_lcr order by codigo limit 2;", token, project_ref)
        if len(codigos_disponiveis) < 2:
            print("[ERRO] precisa de pelo menos 2 códigos em historicos_sci_lcr para o teste.", file=sys.stderr)
            return 1
        cod_a, cod_b = codigos_disponiveis[0]["codigo"], codigos_disponiveis[1]["codigo"]
        print(f"códigos de teste: {cod_a} e {cod_b}")

        run(f"""
            insert into lancamentos (empresa_id, competencia, status, descricao, valor, data_lancamento, conta_id, confidence)
            values ('{EMPRESA_ID}', '2026-01', 'gerada', '{DESCRICAO}', 99.90, '2026-01-15', '{CONTA_INICIAL}', 1);
        """, token, project_ref)
        origem = run(f"select id from lancamentos where empresa_id = '{EMPRESA_ID}' and descricao = '{DESCRICAO}';", token, project_ref)
        lancamento_id = origem[0]["id"]
        print(f"lançamento de teste: {lancamento_id}")

        print(f"\n== 1ª edição: histórico -> {cod_a} ==")
        simular_editar_historico(cod_a, token, project_ref, lancamento_id)
        estado1 = run(f"""
            select l.hist_sci_codigo, h.codigo as historico_codigo, h.descricao
            from lancamentos l join historicos_contabeis h on h.id = l.historico_id
            where l.id = '{lancamento_id}';
        """, token, project_ref)
        print(json.dumps(estado1, ensure_ascii=False))
        ok1 = estado1 and estado1[0]["hist_sci_codigo"] == cod_a and int(estado1[0]["historico_codigo"]) == cod_a

        print(f"\n== 2ª edição: histórico -> {cod_b} (troca) ==")
        simular_editar_historico(cod_b, token, project_ref, lancamento_id)
        estado2 = run(f"""
            select l.hist_sci_codigo, h.codigo as historico_codigo
            from lancamentos l join historicos_contabeis h on h.id = l.historico_id
            where l.id = '{lancamento_id}';
        """, token, project_ref)
        ok2 = estado2 and estado2[0]["hist_sci_codigo"] == cod_b and int(estado2[0]["historico_codigo"]) == cod_b

        print(f"\n== 3ª edição: histórico -> {cod_a} de novo (reusa a linha já criada, não duplica) ==")
        simular_editar_historico(cod_a, token, project_ref, lancamento_id)
        contagem = run(f"""
            select count(*) as n from historicos_contabeis
            where empresa_id = '{EMPRESA_ID}' and codigo = '{cod_a}';
        """, token, project_ref)
        ok3 = int(contagem[0]["n"]) == 1

        print(f"\n1ª edição aplicou {cod_a} corretamente?  {ok1}")
        print(f"2ª edição trocou para {cod_b} corretamente?  {ok2}")
        print(f"3ª edição não duplicou a linha de histórico (find-or-create)?  {ok3}")

        if ok1 and ok2 and ok3:
            print("\n[PASS] QA #140 OK — find-or-create e sincronia hist_sci_codigo/historico_id conforme esperado.")
            return 0
        print("\n[FAIL] QA #140 divergiu do esperado — investigar.")
        return 1
    finally:
        print("\n== cleanup ==")
        cleanup()
        print("sandbox limpo.")


if __name__ == "__main__":
    sys.exit(main())

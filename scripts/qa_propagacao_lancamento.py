"""Teste de regressão da issue #138 (propagação retroativa por descrição).

Não há framework de teste SQL neste repo (sem pgTAP) nem testes de unidade
para lcr.functions.ts, então este script fica versionado como a forma de
re-validar a RPC `propagar_lancamento_por_descricao` sempre que ela for
tocada — já achamos um bug real (CTE `alvo` referenciado num UPDATE em
statement separado, que não existe no Postgres) que só apareceu ao rodar
isto manualmente contra o banco.

Usa o cliente sandbox "ZZZ SANDBOX QA - NAO E CLIENTE REAL" (nunca dados
reais). Cria 4 lançamentos de teste (Jan-Abr/2026) com a mesma descrição,
marca Mar/2026 como `concluida` e Fev/2026 como `confidence=1` (simulando
revisão humana prévia), chama a RPC editando o de Jan e confere os 3 casos:
pulado por concluída, pulado por confirmado, atualizado normalmente. Limpa
os dados de teste ao final (sucesso ou falha).

Uso: python scripts/qa_propagacao_lancamento.py
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
CONTA_ORIGEM = "2654011b-376c-4cc3-a69a-fb334d362165"   # plano_contas global, codigo "1" — vai ser propagada
CONTA_INICIAL = "08232675-4d92-4aa7-bd47-9456fd7f4cbb"  # plano_contas global, codigo "10" — valor inicial dos futuros
DESCRICAO = "TESTE 138 PIX CAROLINA PROPAGACAO"


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
            # Sem User-Agent de navegador, o edge do Supabase responde 403 (Cloudflare 1010).
            "User-Agent": "Mozilla/5.0 (compatible; lcr-qa-script/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[ERRO] status={e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
        raise


def main() -> int:
    env = {**load_env(REPO_LCR / ".env"), **load_env(REPO_FRONT / ".env")}
    token = env.get("SUPABASE_ACCESS_TOKEN")
    project_ref = env.get("SUPABASE_PROJECT_ID") or "slewrhdxxtqcdsnpxxwo"
    if not token:
        print("[ERRO] SUPABASE_ACCESS_TOKEN não encontrado em nenhum .env.", file=sys.stderr)
        return 1

    def cleanup():
        run(f"""
            delete from lancamentos where empresa_id = '{EMPRESA_ID}' and descricao = '{DESCRICAO}';
            delete from conciliacoes where empresa_id = '{EMPRESA_ID}' and competencia = '2026-03';
        """, token, project_ref)

    try:
        print("== setup ==")
        cleanup()  # idempotente — garante estado limpo antes de rodar
        run(f"""
            insert into lancamentos (empresa_id, competencia, status, descricao, valor, data_lancamento, conta_id, confidence)
            values
              ('{EMPRESA_ID}', '2026-01', 'gerada', '{DESCRICAO}', 150.00, '2026-01-10', '{CONTA_ORIGEM}', 1),
              ('{EMPRESA_ID}', '2026-02', 'gerada', '{DESCRICAO}', 150.00, '2026-02-10', '{CONTA_INICIAL}', 1),
              ('{EMPRESA_ID}', '2026-03', 'gerada', '{DESCRICAO}', 150.00, '2026-03-10', '{CONTA_INICIAL}', 0.5),
              ('{EMPRESA_ID}', '2026-04', 'gerada', '{DESCRICAO}', 150.00, '2026-04-10', '{CONTA_INICIAL}', 0.5);

            insert into conciliacoes (empresa_id, competencia, status)
            values ('{EMPRESA_ID}', '2026-03', 'concluida');
        """, token, project_ref)

        origem = run(f"""
            select id from lancamentos where empresa_id = '{EMPRESA_ID}'
            and competencia = '2026-01' and descricao = '{DESCRICAO}';
        """, token, project_ref)
        origem_id = origem[0]["id"]
        print(f"lancamento de origem (Jan/2026): {origem_id}")

        print("== chamando propagar_lancamento_por_descricao ==")
        resultado = run(f"select * from propagar_lancamento_por_descricao('{origem_id}');", token, project_ref)
        print(json.dumps(resultado, indent=2, ensure_ascii=False))

        print("== estado final dos lancamentos ==")
        finais = run(f"""
            select competencia, conta_id, confidence from lancamentos
            where empresa_id = '{EMPRESA_ID}' and descricao = '{DESCRICAO}' order by competencia;
        """, token, project_ref)
        print(json.dumps(finais, indent=2, ensure_ascii=False))

        esperado = {"atualizados": 1, "pulados_concluida": 1, "pulados_confirmados": 1}
        ok = all(resultado[0][k] == v for k, v in esperado.items())
        mapa = {r["competencia"]: r for r in finais}
        fev_intacto = mapa["2026-02"]["conta_id"] == CONTA_INICIAL
        mar_intacto = mapa["2026-03"]["conta_id"] == CONTA_INICIAL
        abr_atualizado = mapa["2026-04"]["conta_id"] == CONTA_ORIGEM and float(mapa["2026-04"]["confidence"]) == 1.0

        print(f"\nContagens corretas (1/1/1)?  {ok}")
        print(f"Fev intacto (confidence=1 humano)?  {fev_intacto}")
        print(f"Mar intacto (mes concluido)?  {mar_intacto}")
        print(f"Abr atualizado (conta + confidence=1)?  {abr_atualizado}")

        if ok and fev_intacto and mar_intacto and abr_atualizado:
            print("\n[PASS] QA #138 OK — comportamento conforme especificado.")
            return 0
        print("\n[FAIL] QA #138 divergiu do esperado — investigar.")
        return 1
    finally:
        print("\n== cleanup ==")
        cleanup()
        print("sandbox limpo.")


if __name__ == "__main__":
    sys.exit(main())

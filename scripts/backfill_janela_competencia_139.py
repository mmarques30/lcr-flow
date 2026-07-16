"""
scripts/backfill_janela_competencia_139.py

Issue #139 — remove lançamentos com fonte_extrato=true cuja data_lancamento
cai em mês POSTERIOR à competência (ex.: "próximos lançamentos" do extrato
Bradesco extraído no início do mês seguinte, indevidamente gravados na
competência anterior). Mês ANTERIOR (-1) continua permitido — não é o bug.

Uso:
  python scripts/backfill_janela_competencia_139.py            # dry-run (lista só)
  python scripts/backfill_janela_competencia_139.py --apagar    # apaga de fato

Requer no .env: SUPABASE_URL (ou VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.

ATENÇÃO (decisão 2026-07-16): dry-run em produção encontrou 921 candidatos
(89.476 lançamentos fonte_extrato analisados), sendo só 230 com a assinatura
clássica "dia 01 do mês seguinte" — os outros 691 caem em dias variados do mês
seguinte e muitos parecem lançamentos LEGÍTIMOS (juros/rendimento pago no dia 1,
parcelas, etc.) que a tolerância antiga de ±1 mês vinha aceitando de propósito,
espalhados por 60+ empresas. Decisão: NÃO rodar --apagar em massa — o risco de
apagar dado real é alto. Ficou só a correção pra frente (índice ..0 em vez de
..1 em ambos os parsers). Backfill real, se algum dia for necessário, precisa de
revisão caso a caso (por empresa/documento), não deste script cru.
"""
import os
import argparse
import requests
from dotenv import load_dotenv

load_dotenv(".env")

URL = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
SR = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
HEADERS = {"apikey": SR, "Authorization": f"Bearer {SR}"}


def _mes_idx(ym: str) -> int:
    y, m = ym[:7].split("-")
    return int(y) * 12 + int(m)


def buscar_todos_fonte_extrato() -> list:
    todos = []
    offset = 0
    passo = 1000
    while True:
        r = requests.get(
            f"{URL}/rest/v1/lancamentos",
            headers=HEADERS,
            params={
                "select": "id,empresa_id,competencia,data_lancamento,fonte_extrato,valor,descricao,documento_id",
                "fonte_extrato": "eq.true",
                "limit": str(passo),
                "offset": str(offset),
                "order": "id",
            },
            timeout=30,
        )
        r.raise_for_status()
        pagina = r.json()
        todos.extend(pagina)
        if len(pagina) < passo:
            break
        offset += passo
    return todos


def encontrar_contaminados(rows: list) -> list:
    """Só o lado do bug (#139): data_lancamento em mês POSTERIOR à competência."""
    contaminados = []
    for x in rows:
        comp = (x.get("competencia") or "")[:7]
        dl = (x.get("data_lancamento") or "")[:7]
        if len(comp) != 7 or len(dl) != 7:
            continue
        if _mes_idx(dl) > _mes_idx(comp):
            contaminados.append(x)
    return contaminados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apagar", action="store_true", help="Apaga de fato (default: dry-run)")
    args = ap.parse_args()

    if not URL or not SR:
        raise SystemExit("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env")

    rows = buscar_todos_fonte_extrato()
    print(f"Total lançamentos fonte_extrato=true: {len(rows)}")

    contaminados = encontrar_contaminados(rows)
    print(f"Contaminados (data no mês SEGUINTE à competência — bug #139): {len(contaminados)}")
    for c in contaminados:
        print(f"  empresa={c['empresa_id']} comp={c['competencia']} data={c['data_lancamento']} "
              f"valor={c['valor']} desc={(c.get('descricao') or '')[:50]!r} id={c['id']}")

    if not contaminados:
        print("Nada a fazer.")
        return

    if not args.apagar:
        print("\nDry-run — nenhum registro apagado. Rode com --apagar para remover de fato.")
        return

    ids = [c["id"] for c in contaminados]
    r = requests.delete(
        f"{URL}/rest/v1/lancamentos",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={"id": f"in.({','.join(ids)})"},
        timeout=30,
    )
    r.raise_for_status()
    apagados = r.json()
    print(f"\nApagados: {len(apagados)} lançamento(s).")
    print("Lembre de reprocessar/enriquecer as competências afetadas se necessário.")


if __name__ == "__main__":
    main()

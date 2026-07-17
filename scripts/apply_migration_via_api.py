"""Aplica uma migration SQL via Supabase Management API (database/query),
usando SUPABASE_ACCESS_TOKEN — sem precisar da senha do Postgres.

Uso: python scripts/apply_migration_via_api.py <arquivo_ou_nome_da_migration>
Ex.: python scripts/apply_migration_via_api.py 20260717160000_propagar_lancamento_por_descricao.sql
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_LCR = Path(r"D:\IAPLICADA\LCR")
REPO_FRONT = Path(__file__).resolve().parent.parent


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


def main() -> int:
    if len(sys.argv) != 2:
        print("Uso: python scripts/apply_migration_via_api.py <arquivo.sql>", file=sys.stderr)
        return 1

    arg = sys.argv[1]
    migration_path = Path(arg)
    if not migration_path.is_absolute():
        candidate = REPO_FRONT / "supabase" / "migrations" / arg
        migration_path = candidate if candidate.exists() else Path(arg)
    if not migration_path.exists():
        print(f"[ERRO] Migration não encontrada: {migration_path}", file=sys.stderr)
        return 1

    env = {**load_env(REPO_LCR / ".env"), **load_env(REPO_FRONT / ".env")}
    token = env.get("SUPABASE_ACCESS_TOKEN")
    project_ref = env.get("SUPABASE_PROJECT_ID") or "slewrhdxxtqcdsnpxxwo"
    if not token:
        print("[ERRO] SUPABASE_ACCESS_TOKEN não encontrado em nenhum .env.", file=sys.stderr)
        return 1

    sql = migration_path.read_text(encoding="utf-8")
    url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
    req = urllib.request.Request(
        url,
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # Sem User-Agent de navegador, o edge do Supabase responde 403 (Cloudflare 1010).
            "User-Agent": "Mozilla/5.0 (compatible; lcr-migration-script/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"[OK] {migration_path.name} aplicada — status={resp.status}")
            print(resp.read().decode("utf-8"))
            return 0
    except urllib.error.HTTPError as e:
        print(f"[ERRO] status={e.code}")
        print(e.read().decode("utf-8"))
        return 1


if __name__ == "__main__":
    sys.exit(main())

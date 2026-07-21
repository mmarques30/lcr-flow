"""Atualiza ANTHROPIC_API_KEY no Supabase edge a partir do LCR/.env e valida."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
PROJECT_REF = "slewrhdxxtqcdsnpxxwo"


def load_env() -> None:
    if not ENV.exists():
        print("ERRO: .env não encontrado em", ENV)
        sys.exit(1)
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"'))


def test_key(key: str) -> tuple[bool, str]:
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "ok"}],
        },
        timeout=60,
    )
    if r.ok:
        return True, "API OK"
    try:
        err = r.json().get("error", {})
        return False, f"HTTP {r.status_code}: {err.get('message', r.text[:200])}"
    except json.JSONDecodeError:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"


def main() -> None:
    load_env()
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key.startswith("sk-ant-"):
        print("ERRO: ANTHROPIC_API_KEY ausente ou inválida no .env")
        sys.exit(1)

    print("chave_suffix:", "..." + key[-8:])
    print("chave_sha256:", hashlib.sha256(key.encode()).hexdigest())

    ok, msg = test_key(key)
    print("teste_direto:", msg)
    if not ok:
        print("Abortando: corrija o .env com a chave nova antes de publicar no edge.")
        sys.exit(1)

    print("publicando secret no Supabase...")
    proc = subprocess.run(
        ["supabase", "secrets", "set", f"ANTHROPIC_API_KEY={key}", "--project-ref", PROJECT_REF],
        cwd=ROOT.parent / "LCR-front",
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print("ERRO supabase:", proc.stderr or proc.stdout)
        sys.exit(proc.returncode)

    print("secret atualizado. Aguarde ~30s e teste a edge com:")
    print("  python scripts/_check_anthropic_credit.py")


if __name__ == "__main__":
    main()

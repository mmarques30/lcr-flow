"""Smoke: processar-documento para NF, DARF e extrato (edge).
Uso: python scripts/smoke_processar_documento_3tipos.py [--doc-id UUID]
Lê credenciais de LCR/.env (SUPABASE_URL, SUPABASE_KEY, SVC email/password).
"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"'))

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_KEY"]
SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
EMAIL = os.environ["SUPABASE_SVC_EMAIL"]
PWD = os.environ["SUPABASE_SVC_PASSWORD"]

TIPOS = {
    "NF": ["nf_entrada", "nf_saida"],
    "DARF": ["darf"],
    "EXTRATO": ["extrato"],
}


def jwt():
    r = requests.post(
        f"{URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON, "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PWD},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def pick_doc(h, label, tipos):
    for t in tipos:
        for st in ("pendente", "erro", "classificado"):
            r = requests.get(
                f"{URL}/rest/v1/documentos",
                headers=h,
                params={
                    "select": "id,tipo,status_processamento,arquivo_nome,storage_path,arquivo_url",
                    "tipo": f"eq.{t}",
                    "status_processamento": f"eq.{st}",
                    "limit": "1",
                    "order": "created_at.desc",
                },
                timeout=30,
            )
            if r.ok and r.json():
                row = r.json()[0]
                if row.get("storage_path") or row.get("arquivo_url"):
                    return row
    return None


def invoke(token, doc_id):
    r = requests.post(
        f"{URL}/functions/v1/processar-documento",
        headers={"apikey": ANON, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"documento_id": doc_id},
        timeout=180,
    )
    body = r.text
    try:
        data = r.json()
    except json.JSONDecodeError:
        data = {"raw": body[:500]}
    return r.status_code, data, body


def main():
    h = {"apikey": ANON, "Authorization": f"Bearer {SR}"}
    token = jwt()
    print("JWT: OK")

    overrides = {}
    if len(sys.argv) > 1 and sys.argv[1] == "--doc-id" and len(sys.argv) > 3:
        overrides[sys.argv[2].upper()] = sys.argv[3]

    results = []
    for label, tipos in TIPOS.items():
        if label in overrides:
            doc_id = overrides[label]
            r = requests.get(
                f"{URL}/rest/v1/documentos",
                headers=h,
                params={"select": "id,tipo,status_processamento,arquivo_nome", "id": f"eq.{doc_id}"},
                timeout=30,
            )
            doc = r.json()[0] if r.ok and r.json() else {"id": doc_id, "tipo": "?", "arquivo_nome": "?"}
        else:
            doc = pick_doc(h, label, tipos)
        if not doc:
            print(f"\n[{label}] SKIP — nenhum doc com arquivo ({tipos})")
            results.append((label, "SKIP", None))
            continue

        did = doc["id"]
        nome = (doc.get("arquivo_nome") or "")[:55]
        print(f"\n[{label}] {did} tipo={doc.get('tipo')} status={doc.get('status_processamento')} {nome}")
        http, data, raw = invoke(token, did)
        ok = data.get("ok") if isinstance(data, dict) else None
        err = data.get("error") if isinstance(data, dict) else None
        grammar = "grammar" in raw.lower() or "schema is too complex" in raw.lower()
        jwt_err = "UNAUTHORIZED_ASYMMETRIC_JWT" in raw
        lanc = data.get("lancamentos_gerados") if isinstance(data, dict) else None
        print(f"  HTTP {http} ok={ok} lancamentos={lanc}")
        if err:
            print(f"  error: {str(err)[:200]}")
        if grammar:
            print("  >>> GRAMMAR-400 (fix NAO deployado)")
        if jwt_err:
            print("  >>> JWT 401 (gateway)")
        results.append((label, "OK" if ok else "FAIL", data))

    print("\n=== RESUMO ===")
    for label, status, data in results:
        extra = ""
        if isinstance(data, dict) and data.get("error"):
            extra = f" — {str(data['error'])[:80]}"
        print(f"  {label}: {status}{extra}")

    fails = sum(1 for _, s, _ in results if s == "FAIL")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

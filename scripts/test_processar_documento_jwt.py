"""Smoke test: processar-documento with password-grant JWT (bridge_front flow)."""
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

r = requests.post(
    f"{URL}/auth/v1/token?grant_type=password",
    headers={"apikey": ANON, "Content-Type": "application/json"},
    json={"email": EMAIL, "password": PWD},
    timeout=30,
)
print("JWT status:", r.status_code)
if not r.ok:
    print(r.text[:300])
    sys.exit(1)
jwt = r.json()["access_token"]

h = {"apikey": ANON, "Authorization": f"Bearer {SR}"}
docs = requests.get(
    f"{URL}/rest/v1/documentos",
    headers=h,
    params={
        "select": "id,status_processamento,arquivo_nome",
        "status_processamento": "eq.pendente",
        "limit": "1",
        "order": "created_at.desc",
    },
    timeout=30,
)
if not docs.ok:
    print("Query docs failed:", docs.status_code, docs.text[:300])
    sys.exit(1)
rows = docs.json()
if not rows:
    docs = requests.get(
        f"{URL}/rest/v1/documentos",
        headers=h,
        params={"select": "id,status_processamento,arquivo_nome", "limit": "1", "order": "created_at.desc"},
        timeout=30,
    )
    rows = docs.json()
doc = rows[0]
doc_id = doc["id"]
print("Test doc:", doc_id, doc.get("status_processamento"), (doc.get("arquivo_nome") or "")[:60])

inv = requests.post(
    f"{URL}/functions/v1/processar-documento",
    headers={"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
    json={"documento_id": doc_id},
    timeout=120,
)
print("processar-documento HTTP:", inv.status_code)
body = inv.text[:500]
print("Body snippet:", body)
if "UNAUTHORIZED_ASYMMETRIC_JWT" in body:
    sys.exit(2)

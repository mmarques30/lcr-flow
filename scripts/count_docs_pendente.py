import os, requests
from pathlib import Path

for line in Path(__file__).resolve().parents[1].joinpath(".env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"'))

URL = os.environ["SUPABASE_URL"].rstrip("/")
SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON = os.environ["SUPABASE_KEY"]
h = {"apikey": ANON, "Authorization": f"Bearer {SR}", "Prefer": "count=exact"}

for status in ("pendente", "erro"):
    r = requests.get(
        f"{URL}/rest/v1/documentos",
        headers=h,
        params={"select": "id", "status_processamento": f"eq.{status}"},
        timeout=30,
    )
    print(f"{status}:", r.headers.get("content-range", "?"))

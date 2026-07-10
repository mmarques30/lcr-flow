"""Extrai .zip/.rar já gravados no Supabase e processa os arquivos internos.

Uso:
  python scripts/extrair_zip_backlog.py --competencia 2026-02 --dry-run
  python scripts/extrair_zip_backlog.py --competencia 2026-02 --apply --limit 5
  python scripts/extrair_zip_backlog.py --competencia 2026-02 --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "orquestracao"
sys.path.insert(0, str(ROOT / "src"))

import bridge_front as bf  # noqa: E402
from arquivos_compactados import expandir_arquivos_compactados  # noqa: E402
from orquestrar import resolver_banco  # noqa: E402

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
JWT_REFRESH_SEC = 45 * 60

H_SR = {"apikey": ANON, "Authorization": f"Bearer {SR}"}
ARCHIVE_EXT = {".zip", ".rar", ".7z"}
BANCO_PADRAO = 657


class JwtHolder:
    def __init__(self) -> None:
        self.refresh()

    def refresh(self) -> None:
        r = requests.post(
            f"{URL}/auth/v1/token?grant_type=password",
            headers={"apikey": ANON, "Content-Type": "application/json"},
            json={"email": EMAIL, "password": PWD},
            timeout=30,
        )
        r.raise_for_status()
        self.token = r.json()["access_token"]
        self.obtained_at = time.time()
        print("  JWT obtido/renovado")

    def get(self) -> str:
        if time.time() - self.obtained_at >= JWT_REFRESH_SEC:
            self.refresh()
        return self.token


def parse_ci(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def ja_extraido(doc: dict) -> bool:
    ci = parse_ci(doc.get("classificacao_ia"))
    if not ci.get("compactado_extraido"):
        return False
    # Reprocessa se a extracao anterior falhou ou nao gerou filhos.
    if ci.get("compactado_filhos", 0) == 0 or ci.get("compactado_erro"):
        return False
    return True


def fetch_zip_docs(competencia: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        r = requests.get(
            f"{URL}/rest/v1/documentos",
            headers=H_SR,
            params={
                "select": "id,empresa_id,competencia,tipo,status_processamento,arquivo_nome,storage_path,arquivo_url,classificacao_ia,origem",
                "competencia": f"eq.{competencia}",
                "order": "created_at.asc",
                "limit": "500",
                "offset": str(offset),
            },
            timeout=60,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        for d in batch:
            nome = (d.get("arquivo_nome") or d.get("storage_path") or "").lower()
            if Path(nome).suffix in ARCHIVE_EXT:
                rows.append(d)
        if len(batch) < 500:
            break
        offset += 500
    return rows


def safe_print(s: str) -> None:
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def marcar_extraido(doc_id: str, ci: dict, filhos: int, avisos: list[str], erro: str | None = None):
    novo = dict(ci)
    novo["compactado_extraido"] = True
    novo["compactado_filhos"] = filhos
    novo["compactado_extraido_em"] = datetime.now(timezone.utc).isoformat()
    if avisos:
        novo["compactado_avisos"] = avisos[:10]
    if erro:
        novo["compactado_erro"] = erro[:300]
    patch = {
        "classificacao_ia": novo,
        "status_processamento": "processado" if filhos > 0 and not erro else "erro",
    }
    if filhos > 0 and not erro:
        patch["status"] = "recebido"
    bf.sb_update("documentos", {"id": doc_id}, patch)


def processar_zip(doc: dict, jwt: str, work_dir: Path, dry_run: bool) -> dict:
    doc_id = doc["id"]
    nome = doc.get("arquivo_nome") or "compactado.zip"
    empresa_id = doc["empresa_id"]
    competencia = doc["competencia"]
    sp = doc.get("storage_path") or doc.get("arquivo_url")
    ci = parse_ci(doc.get("classificacao_ia"))

    if not sp:
        return {"id": doc_id, "arquivo": nome, "status": "skip", "motivo": "sem storage_path"}

    if dry_run:
        return {"id": doc_id, "arquivo": nome, "status": "dry_run", "storage": sp}

    pasta = work_dir / doc_id
    pasta.mkdir(parents=True, exist_ok=True)
    arquivo_local = pasta / Path(nome).name

    try:
        conteudo = bf.baixar_storage(bf.BUCKET_DOCS, sp)
        arquivo_local.write_bytes(conteudo)

        expandidos, avisos = expandir_arquivos_compactados([str(arquivo_local)])
        if not expandidos:
            marcar_extraido(doc_id, ci, 0, avisos, erro="compactado vazio ou sem arquivos processaveis")
            return {"id": doc_id, "arquivo": nome, "status": "vazio", "avisos": avisos}

        banco = resolver_banco(empresa_id) or BANCO_PADRAO
        resumo = bf.processar_arquivos(
            empresa_id, competencia, expandidos, banco, jwt, extrato_fallback_edge=True,
        )
        filhos = len(resumo.get("extratos", [])) + len(resumo.get("outros", []))
        marcar_extraido(doc_id, ci, filhos, avisos + resumo.get("avisos_compactados", []))
        return {
            "id": doc_id,
            "arquivo": nome,
            "status": "ok",
            "filhos": filhos,
            "expandidos": len(expandidos),
            "avisos": avisos,
        }
    except Exception as e:
        marcar_extraido(doc_id, ci, 0, [], erro=str(e)[:300])
        return {"id": doc_id, "arquivo": nome, "status": "erro", "motivo": str(e)[:200]}


def main():
    ap = argparse.ArgumentParser(description="Extrai zip/rar do Supabase e processa conteudo")
    ap.add_argument("--competencia", default="2026-02")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true", help="reprocessa mesmo com compactado_extraido")
    args = ap.parse_args()

    if not args.dry_run and not args.apply:
        ap.error("use --dry-run ou --apply")

    docs = fetch_zip_docs(args.competencia)
    pendentes = [d for d in docs if args.force or not ja_extraido(d)]
    if args.limit:
        pendentes = pendentes[: args.limit]

    print(f"competencia={args.competencia} zip/rar total={len(docs)} a_processar={len(pendentes)}")
    for d in docs:
        st = d.get("status_processamento") or "?"
        ext = "extraido" if ja_extraido(d) else "pendente_extracao"
        safe_print(f"  [{ext}] {st:12} {(d.get('arquivo_nome') or '?')[:60]}")

    if args.dry_run:
        print(f"\nDRY-RUN: {len(pendentes)} compactado(s) seriam extraidos")
        return

    jwt_h = JwtHolder()
    work_dir = OUT / f"zip-backfill-{args.competencia}"
    work_dir.mkdir(parents=True, exist_ok=True)
    log_path = OUT / f"zip-backfill-{args.competencia}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    resultados = []
    ok = err = vazio = 0

    for i, doc in enumerate(pendentes, 1):
        safe_print(f"\n[{i}/{len(pendentes)}] {doc.get('arquivo_nome')}")
        r = processar_zip(doc, jwt_h.get(), work_dir, dry_run=False)
        resultados.append(r)
        if r["status"] == "ok":
            ok += 1
            print(f"  OK: {r.get('expandidos')} arquivo(s) -> {r.get('filhos')} processado(s)")
        elif r["status"] == "vazio":
            vazio += 1
            print(f"  VAZIO: {r.get('avisos')}")
        else:
            err += 1
            print(f"  ERRO: {r.get('motivo', r.get('status'))}")

    log_path.write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResumo: ok={ok} vazio={vazio} erro={err} | log={log_path}")


if __name__ == "__main__":
    main()

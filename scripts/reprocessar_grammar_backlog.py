"""Reprocessa documentos com falha grammar-400 / pendente via edge processar-documento.

Uso:
  python scripts/reprocessar_grammar_backlog.py --dry-run          # conta candidatos
  python scripts/reprocessar_grammar_backlog.py --apply --limit 20 # lote piloto
  python scripts/reprocessar_grammar_backlog.py --apply            # backlog inteiro
  python scripts/reprocessar_grammar_backlog.py --apply --ids-file outputs/.../fail-ids.txt
  python scripts/reprocessar_grammar_backlog.py --apply --from-log outputs/.../reprocess-grammar-*.json

Filtros:
  - status_processamento in (pendente, erro)
  - tem storage_path ou arquivo_url
  - erro: grammar/schema OU pendente (nunca classificado com sucesso)
  - pula duplicata, tipos não suportados (.zip, .docx, .msg)
  - .xls/.xlsx: converte p/ CSV no storage antes da edge (mesmo fluxo do bridge_front)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "orquestracao"
UNSUPPORTED_EXT = {".zip", ".docx", ".msg", ".doc", ".rar", ".7z"}
EXCEL_EXT = {".xls", ".xlsx"}
JWT_REFRESH_SEC = 45 * 60

sys.path.insert(0, str(ROOT / "src"))
import bridge_front as bf  # noqa: E402

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

H_SR = {"apikey": ANON, "Authorization": f"Bearer {SR}"}


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


def is_grammar_error(ci: dict) -> bool:
    err = str(ci.get("error", "")).lower()
    return any(k in err for k in ("schema is too complex", "grammar compilation", "grammar"))


def has_file(doc: dict) -> bool:
    return bool(doc.get("storage_path") or doc.get("arquivo_url"))


def ext_of(doc: dict) -> str:
    nome = doc.get("arquivo_nome") or doc.get("storage_path") or doc.get("arquivo_url") or ""
    m = re.search(r"(\.[A-Za-z0-9]+)$", nome)
    return (m.group(1).lower() if m else "")


def safe_print(s: str) -> None:
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def is_token_invalid(http: int, err: str, raw: str) -> bool:
    blob = (err + raw).lower()
    return http in (401, 403) or "token inv" in blob or "jwt expired" in blob or "invalid jwt" in blob


def converter_excel_no_storage(doc: dict) -> tuple[dict, str | None]:
    """Converte .xls/.xlsx armazenados para CSV (edge não lê Excel binário)."""
    ext = ext_of(doc)
    if ext not in EXCEL_EXT:
        return doc, None

    sp = doc.get("storage_path") or doc.get("arquivo_url")
    if not sp:
        return doc, "sem_storage_path"

    import pandas as pd

    conteudo = bf.baixar_storage(bf.BUCKET_DOCS, sp)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
        tf.write(conteudo)
        caminho = tf.name

    df = None
    try:
        cabecalho = conteudo[:64].lstrip().lower()
        if cabecalho.startswith(b"<"):
            tabelas = pd.read_html(caminho)
            df = max(tabelas, key=len).astype(str)
        else:
            try:
                df = pd.read_excel(caminho, sheet_name=0, dtype=str, engine="openpyxl")
            except Exception:
                df = pd.read_excel(caminho, sheet_name=0, dtype=str, engine="xlrd")
    except Exception as e:
        return doc, f"conversão Excel: {e}"
    finally:
        try:
            os.unlink(caminho)
        except OSError:
            pass

    if df is None:
        return doc, "conversão Excel: dataframe vazio"

    csv_bytes = df.fillna("").to_csv(index=False, sep=";").encode("utf-8")
    nome_base = Path(doc.get("arquivo_nome") or sp).stem
    novo_nome = f"{nome_base}.csv"
    novo_path = str(Path(sp).with_suffix(".csv"))

    bf.sb_upload(bf.BUCKET_DOCS, novo_path, csv_bytes, "text/csv")
    bf.sb_update(
        "documentos",
        {"id": doc["id"]},
        {"arquivo_nome": novo_nome, "storage_path": novo_path, "arquivo_url": novo_path},
    )
    print(f"    Excel → CSV ({len(df)} linhas) → {novo_path}")
    return {**doc, "arquivo_nome": novo_nome, "storage_path": novo_path, "arquivo_url": novo_path}, None


def fetch_candidates(statuses: list[str]) -> list[dict]:
    out: list[dict] = []
    for st in statuses:
        offset = 0
        page = 500
        while True:
            r = requests.get(
                f"{URL}/rest/v1/documentos",
                headers=H_SR,
                params={
                    "select": "id,tipo,status_processamento,arquivo_nome,storage_path,arquivo_url,classificacao_ia,duplicata_de",
                    "status_processamento": f"eq.{st}",
                    "order": "created_at.asc",
                    "limit": str(page),
                    "offset": str(offset),
                },
                timeout=60,
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            out.extend(batch)
            if len(batch) < page:
                break
            offset += page
    return out


def fetch_by_ids(ids: list[str]) -> list[dict]:
    docs: list[dict] = []
    chunk = 80
    fields = "id,tipo,status_processamento,arquivo_nome,storage_path,arquivo_url,classificacao_ia,duplicata_de"
    for i in range(0, len(ids), chunk):
        batch_ids = ids[i : i + chunk]
        r = requests.get(
            f"{URL}/rest/v1/documentos",
            headers=H_SR,
            params={
                "select": fields,
                "id": f"in.({','.join(batch_ids)})",
            },
            timeout=60,
        )
        r.raise_for_status()
        docs.extend(r.json())
    by_id = {d["id"]: d for d in docs}
    return [by_id[i] for i in ids if i in by_id]


def load_ids_file(path: Path) -> list[str]:
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def failed_ids_from_log(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [r["documento_id"] for r in data.get("results", []) if not r.get("ok")]


def filter_candidates(rows: list[dict], *, grammar_only: bool) -> list[dict]:
    seen = set()
    ok = []
    for doc in rows:
        did = doc["id"]
        if did in seen:
            continue
        seen.add(did)
        if doc.get("duplicata_de"):
            continue
        if not has_file(doc):
            continue
        ext = ext_of(doc)
        if ext in UNSUPPORTED_EXT:
            continue
        st = doc.get("status_processamento")
        ci = parse_ci(doc.get("classificacao_ia"))
        if st == "pendente":
            ok.append(doc)
            continue
        if st == "erro":
            if grammar_only and not is_grammar_error(ci):
                continue
            if not grammar_only or is_grammar_error(ci):
                ok.append(doc)
    return ok


def invoke_edge(jwt: str, doc_id: str) -> tuple[int, dict, str]:
    r = requests.post(
        f"{URL}/functions/v1/processar-documento",
        headers={"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json={"documento_id": doc_id},
        timeout=180,
    )
    raw = r.text
    try:
        data = r.json()
    except json.JSONDecodeError:
        data = {"ok": False, "error": raw[:300]}
    return r.status_code, data, raw


def retry_edge(jwt_holder: JwtHolder, doc_id: str) -> tuple[dict, int]:
    jwt = jwt_holder.get()
    http, data, raw = invoke_edge(jwt, doc_id)
    tentativas = 0
    while not data.get("ok") and tentativas < 5:
        err = str(data.get("error", "")) + raw
        if is_token_invalid(http, err, raw):
            tentativas += 1
            print(f"    token inválido — renovando JWT ({tentativas}/5)...")
            jwt_holder.refresh()
            jwt = jwt_holder.get()
            http, data, raw = invoke_edge(jwt, doc_id)
            continue
        is_rate = any(k in err for k in ("429", "rate_limit", "rate limit"))
        is_overload = any(k in err for k in ("529", "overloaded", "overload"))
        is_timeout = http == 504 or "timeout" in err.lower()
        if not (is_rate or is_overload or is_timeout):
            break
        tentativas += 1
        espera = 65 if is_rate else (30 if is_timeout else 15 * tentativas)
        print(f"    retry {tentativas}/5 em {espera}s ({'429' if is_rate else '529/504'})...")
        time.sleep(espera)
        http, data, raw = invoke_edge(jwt_holder.get(), doc_id)
    return data, http


def main():
    ap = argparse.ArgumentParser(description="Reprocessa backlog grammar-400 / pendente")
    ap.add_argument("--dry-run", action="store_true", help="Só conta e lista amostra")
    ap.add_argument("--apply", action="store_true", help="Executa reprocesso")
    ap.add_argument("--limit", type=int, default=0, help="Máximo de docs (0 = todos)")
    ap.add_argument("--grammar-only", action="store_true", default=True,
                    help="Só erro com grammar/schema (default). Use --all-erro p/ todo erro")
    ap.add_argument("--all-erro", action="store_true", help="Inclui todo status=erro com arquivo")
    ap.add_argument("--pause", type=float, default=2.0, help="Segundos entre chamadas")
    ap.add_argument("--ids-file", type=Path, help="Arquivo com um documento_id por linha")
    ap.add_argument("--from-log", type=Path, help="JSON de run anterior — só os que falharam")
    args = ap.parse_args()

    if not args.dry_run and not args.apply:
        ap.error("Use --dry-run ou --apply")

    grammar_only = not args.all_erro

    if args.from_log:
        ids = failed_ids_from_log(args.from_log)
        print(f"IDs do log {args.from_log.name}: {len(ids)} falha(s)")
        candidates = fetch_by_ids(ids)
        print(f"Encontrados no banco: {len(candidates)}")
    elif args.ids_file:
        ids = load_ids_file(args.ids_file)
        print(f"IDs em {args.ids_file}: {len(ids)}")
        candidates = fetch_by_ids(ids)
        print(f"Encontrados no banco: {len(candidates)}")
    else:
        print("Carregando candidatos (pendente + erro)...")
        rows = fetch_candidates(["pendente", "erro"])
        candidates = filter_candidates(rows, grammar_only=grammar_only)
        print(f"Total bruto pendente+erro: {len(rows)}")
        print(f"Candidatos após filtro: {len(candidates)} (grammar_only={grammar_only})")

    by_st: dict[str, int] = {}
    by_tipo: dict[str, int] = {}
    excel_n = 0
    for c in candidates:
        by_st[c.get("status_processamento", "?")] = by_st.get(c.get("status_processamento", "?"), 0) + 1
        by_tipo[c.get("tipo", "?")] = by_tipo.get(c.get("tipo", "?"), 0) + 1
        if ext_of(c) in EXCEL_EXT:
            excel_n += 1
    print("Por status:", by_st)
    print("Por tipo (top):", dict(sorted(by_tipo.items(), key=lambda x: -x[1])[:8]))
    if excel_n:
        print(f"Excel (.xls/.xlsx) a converter antes da edge: {excel_n}")

    if args.limit:
        candidates = candidates[: args.limit]

    if args.dry_run:
        for c in candidates[:15]:
            safe_print(f"  {c['id'][:8]}… {c.get('status_processamento')} {c.get('tipo')} {(c.get('arquivo_nome') or '')[:50]}")
        if len(candidates) > 15:
            print(f"  … +{len(candidates) - 15} mais")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = OUT / f"reprocess-grammar-{ts}.json"
    jwt_holder = JwtHolder()
    print(f"Processando {len(candidates)} doc(s)...")

    results = []
    ok_n = fail_n = 0
    for i, doc in enumerate(candidates, 1):
        did = doc["id"]
        nome = (doc.get("arquivo_nome") or "")[:55]
        print(f"\n[{i}/{len(candidates)}] {did} {doc.get('tipo')} {nome}")

        doc, conv_err = converter_excel_no_storage(doc)
        if conv_err:
            fail_n += 1
            entry = {
                "documento_id": did,
                "tipo": doc.get("tipo"),
                "arquivo_nome": doc.get("arquivo_nome"),
                "http": 0,
                "ok": False,
                "lancamentos_gerados": None,
                "error": conv_err,
            }
            results.append(entry)
            print(f"  FAIL: {conv_err}")
            if i < len(candidates):
                time.sleep(args.pause)
            continue

        data, http = retry_edge(jwt_holder, did)
        success = bool(data.get("ok"))
        entry = {
            "documento_id": did,
            "tipo": doc.get("tipo"),
            "arquivo_nome": doc.get("arquivo_nome"),
            "http": http,
            "ok": success,
            "lancamentos_gerados": data.get("lancamentos_gerados"),
            "error": data.get("error"),
        }
        results.append(entry)
        if success:
            ok_n += 1
            print(f"  OK lancamentos={data.get('lancamentos_gerados')}")
        else:
            fail_n += 1
            print(f"  FAIL: {str(data.get('error', ''))[:120]}")
        if i < len(candidates):
            time.sleep(args.pause)

    summary = {
        "ts": ts,
        "total": len(candidates),
        "ok": ok_n,
        "fail": fail_n,
        "grammar_only": grammar_only,
        "source": str(args.ids_file or args.from_log or "candidates"),
        "results": results,
    }
    log_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=== FIM ok={ok_n} fail={fail_n} ===")
    print(f"Log: {log_path}")
    sys.exit(1 if fail_n else 0)


if __name__ == "__main__":
    main()

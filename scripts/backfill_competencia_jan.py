#!/usr/bin/env python3
"""
Backfill: documentos/lançamentos da cobrança 2026-01 gravados em 2025-12
(lag competence_date do Gestta) → competência contábil 2026-01 (filtro Fev no front).

Uso:
  python scripts/backfill_competencia_jan.py --dry-run
  python scripts/backfill_competencia_jan.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"'))

import bridge_front as bf  # noqa: E402
from orquestrar import LEDGER, _carregar_ledger, listar_cobrancas_api, resolver_empresa  # noqa: E402

DE = "2025-12"
PARA = "2026-01"


def log(msg: str) -> None:
    print(msg, flush=True)


def empresas_jan() -> set[str]:
    tarefas = listar_cobrancas_api(PARA, ["DONE"])
    ids: set[str] = set()
    for t in tarefas:
        emp = resolver_empresa(t.get("clienteCodigo") or "", t.get("clienteNome") or "")
        if emp:
            ids.add(emp["id"])
    return ids


def ensure_comp_map(empresa_ids: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for eid in empresa_ids:
        out[eid] = bf.ensure_competencia(eid, PARA)
    return out


def _count_rows(table: str, eid: str) -> int:
    import requests
    URL = os.environ["SUPABASE_URL"].rstrip("/")
    SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Prefer": "count=exact"}
    r = requests.get(
        f"{URL}/rest/v1/{table}",
        headers=H,
        params={"select": "id", "empresa_id": f"eq.{eid}", "competencia": f"eq.{DE}", "limit": "1"},
        timeout=30,
    )
    r.raise_for_status()
    return int((r.headers.get("content-range") or "*/0").split("/")[-1])


def patch_table(table: str, empresa_ids: set[str], *, dry_run: bool) -> int:
    total = 0
    for i, eid in enumerate(empresa_ids, 1):
        n = _count_rows(table, eid)
        if not n:
            continue
        total += n
        if dry_run:
            if i % 100 == 0:
                log(f"    ... {table} {i}/{len(empresa_ids)} empresas")
            continue
        comp_id = bf.ensure_competencia(eid, PARA) if table == "documentos" else None
        patch = {"competencia": PARA}
        if table == "documentos":
            patch["competencia_id"] = comp_id
        bf.sb_update(table, {"empresa_id": eid, "competencia": DE}, patch)
        if i % 50 == 0:
            log(f"    ... {table} {i}/{len(empresa_ids)} empresas")
    return total


def patch_conciliacoes(empresa_ids: set[str], *, dry_run: bool) -> int:
    total = 0
    for i, eid in enumerate(empresa_ids, 1):
        n_de = _count_rows("conciliacoes", eid)
        if not n_de:
            continue
        total += n_de
        if dry_run:
            continue
        exist_para = bf.sb_get("conciliacoes", {
            "select": "id",
            "empresa_id": f"eq.{eid}",
            "competencia": f"eq.{PARA}",
            "limit": "1",
        })
        if exist_para:
            bf.sb_delete("conciliacoes", {"empresa_id": eid, "competencia": DE})
        else:
            bf.sb_update("conciliacoes", {"empresa_id": eid, "competencia": DE}, {"competencia": PARA})
        if i % 50 == 0:
            log(f"    ... conciliacoes {i}/{len(empresa_ids)} empresas")
    return total


def migrate_ledger(empresa_ids: set[str], *, dry_run: bool) -> int:
    led = _carregar_ledger()
    n = 0
    for eid in empresa_ids:
        old = f"{eid}:{DE}"
        new = f"{eid}:{PARA}"
        if old in led and new not in led:
            n += 1
            if not dry_run:
                led[new] = led.pop(old)
        elif old in led and new in led and not dry_run:
            led.pop(old, None)
            n += 1
    if not dry_run and n:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        LEDGER.write_text(json.dumps(led, ensure_ascii=False, indent=2), encoding="utf-8")
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        ap.error("Use --dry-run ou --apply")

    log(f"Listando empresas cobrança {PARA}...")
    emp_ids = empresas_jan()
    log(f"  {len(emp_ids)} empresa(s)")

    dry = not args.apply
    for tbl in ("documentos", "lancamentos"):
        n = patch_table(tbl, emp_ids, dry_run=dry)
        log(f"  {tbl}: {n} registro(s) {DE} → {PARA}" + (" (simulado)" if dry else ""))

    n = patch_conciliacoes(emp_ids, dry_run=dry)
    log(f"  conciliacoes: {n} registro(s) {DE} → {PARA}" + (" (simulado)" if dry else ""))

    ln = migrate_ledger(emp_ids, dry_run=dry)
    log(f"  ledger: {ln} chave(s)" + (" (simulado)" if dry else ""))

    if dry:
        log("DRY-RUN — rode com --apply para gravar")
    else:
        log("OK — backfill aplicado")


if __name__ == "__main__":
    main()

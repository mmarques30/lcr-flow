#!/usr/bin/env python3
"""
scripts/seed_usuarios.py — cria usuários em lote no Supabase Auth + usuarios_perfil.

Uso:
  python scripts/seed_usuarios.py config/usuarios_exemplo.csv
  python scripts/seed_usuarios.py config/usuarios_exemplo.csv --dry-run

CSV (cabeçalho): email,nome,perfil
  perfil: admin | consultor | assistente (default: assistente)

Requer no .env:
  SUPABASE_URL (ou VITE_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY
  DEFAULT_USER_PASSWORD
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

URL = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
SR = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
DEFAULT_PWD = os.getenv("DEFAULT_USER_PASSWORD") or ""

PERFIS = {"admin", "consultor", "assistente"}
AUTH_HEADERS = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json"}
REST_HEADERS = {
    **AUTH_HEADERS,
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def _login_ok(email: str, senha: str) -> bool:
    anon = os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY") or ""
    if not anon:
        return True
    r = requests.post(
        f"{URL}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Content-Type": "application/json"},
        json={"email": email, "password": senha},
        timeout=60,
    )
    return r.ok


def achar_user_id(email: str) -> str | None:
    r = requests.get(
        f"{URL}/rest/v1/usuarios_perfil",
        headers={**AUTH_HEADERS, "Accept": "application/json"},
        params={"email": f"eq.{email}", "select": "user_id"},
        timeout=60,
    )
    if r.ok and r.json():
        return r.json()[0]["user_id"]

    page = 1
    while page <= 20:
        r = requests.get(
            f"{URL}/auth/v1/admin/users",
            headers=AUTH_HEADERS,
            params={"page": page, "per_page": 50},
            timeout=60,
        )
        if not r.ok:
            return None
        batch = r.json().get("users") or []
        for u in batch:
            if (u.get("email") or "").lower() == email:
                return u["id"]
        if len(batch) < 50:
            return None
        page += 1
    return None


def upsert_perfil(user_id: str, email: str, nome: str, perfil: str, dry_run: bool) -> None:
    payload = {
        "user_id": user_id,
        "nome": nome,
        "email": email,
        "perfil": perfil,
        "ativo": True,
        "must_change_password": True,
    }
    if dry_run:
        return
    r = requests.post(
        f"{URL}/rest/v1/usuarios_perfil?on_conflict=user_id",
        headers=REST_HEADERS,
        json=payload,
        timeout=60,
    )
    if r.ok:
        return
    # coluna ainda não migrada — tenta sem a flag
    if r.status_code in (400, 404) and "must_change_password" in r.text:
        payload.pop("must_change_password", None)
        r2 = requests.post(
            f"{URL}/rest/v1/usuarios_perfil?on_conflict=user_id",
            headers=REST_HEADERS,
            json=payload,
            timeout=60,
        )
        r2.raise_for_status()
        return
    r.raise_for_status()


def criar_usuario(email: str, nome: str, perfil: str, senha: str, dry_run: bool) -> None:
    if dry_run:
        log(f"  [dry-run] {email} ({perfil})")
        return

    r = requests.post(
        f"{URL}/auth/v1/admin/users",
        headers=AUTH_HEADERS,
        json={"email": email, "password": senha, "email_confirm": True, "user_metadata": {"nome": nome}},
        timeout=60,
    )

    if r.ok:
        uid = r.json().get("id")
    elif r.status_code == 422:
        uid = achar_user_id(email)
        if not uid:
            raise RuntimeError(f"E-mail já cadastrado mas não encontrado: {email}")
        ur = requests.put(
            f"{URL}/auth/v1/admin/users/{uid}",
            headers=AUTH_HEADERS,
            json={"password": senha, "email_confirm": True},
            timeout=60,
        )
        ur.raise_for_status()
        if not _login_ok(email, senha):
            raise RuntimeError(f"Senha não aplicada para {email}")
        log(f"  >> {email} atualizado (senha provisoria)")
    else:
        raise RuntimeError(f"Auth: {r.status_code} {r.text[:300]}")

    if not uid:
        raise RuntimeError(f"Sem user_id para {email}")

    upsert_perfil(uid, email, nome, perfil, dry_run=False)
    if r.ok:
        log(f"  OK {email} ({perfil})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not URL or not SR:
        log("[ERRO] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios")
        sys.exit(1)
    if not DEFAULT_PWD and not args.dry_run:
        log("[ERRO] DEFAULT_USER_PASSWORD é obrigatório")
        sys.exit(1)
    if not args.csv.exists():
        log(f"[ERRO] CSV não encontrado: {args.csv}")
        sys.exit(1)

    rows: list[dict[str, str]] = []
    with args.csv.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            email = (row.get("email") or "").strip().lower()
            nome = (row.get("nome") or "").strip()
            perfil = (row.get("perfil") or "assistente").strip().lower()
            if not email or not nome:
                continue
            if perfil not in PERFIS:
                perfil = "assistente"
            rows.append({"email": email, "nome": nome, "perfil": perfil})

    if not rows:
        log("[ERRO] CSV vazio")
        sys.exit(1)

    log(f"=== Seed {len(rows)} usuário(s) ===")
    erros = 0
    for row in rows:
        try:
            criar_usuario(row["email"], row["nome"], row["perfil"], DEFAULT_PWD, args.dry_run)
        except Exception as e:
            erros += 1
            log(f"  ERRO {row['email']}: {e}")

    log(f"\nConcluído: {len(rows) - erros} ok, {erros} erro(s)")
    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()

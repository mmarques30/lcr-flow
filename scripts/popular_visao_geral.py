#!/usr/bin/env python3
"""Popula (rápido, p/ demo) os blocos da Visão Geral a partir do que já temos:
  documentos_esperados ← tipos distintos da tabela documentos (por empresa)
  contas_bancarias     ← banco inferido do nome do arquivo de extrato (quem não tem conta)
Idempotente: pula pares já existentes."""
import os
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SR = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
H = {"apikey": SR, "Authorization": f"Bearer {SR}"}
S = requests.Session()

BANCOS = {"bradesco": "Bradesco", "itau": "Itaú", "itaú": "Itaú", "santander": "Santander",
          "caixa": "Caixa", "banco do brasil": "Banco do Brasil", "inter": "Inter",
          "sicoob": "Sicoob", "sicredi": "Sicredi", "nubank": "Nubank", "c6": "C6 Bank",
          "btg": "BTG", "xp": "XP", "stone": "Stone", "pagbank": "PagBank", "original": "Original"}


def get_all(t, params):
    out, off = [], 0
    while True:
        r = S.get(f"{URL}/rest/v1/{t}", headers=H, params={**params, "limit": "1000", "offset": str(off)}, timeout=60)
        r.raise_for_status()
        b = r.json()
        out += b
        if len(b) < 1000:
            return out
        off += 1000


def insert(t, rows):
    n = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        r = S.post(f"{URL}/rest/v1/{t}", headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"}, json=chunk, timeout=120)
        if not r.ok:
            raise RuntimeError(f"{t}: {r.status_code} {r.text[:200]}")
        n += len(chunk)
    return n


# 1) documentos_esperados ← documentos.tipo
docs = get_all("documentos", {"select": "empresa_id,tipo"})
have = {(e["empresa_id"], e["tipo"]) for e in get_all("documentos_esperados", {"select": "empresa_id,tipo"})}
pares = {(d["empresa_id"], d["tipo"]) for d in docs if d.get("empresa_id") and d.get("tipo")}
novos_de = [{"empresa_id": e, "tipo": t} for (e, t) in pares if (e, t) not in have]
print(f"documentos: {len(docs)} | pares distintos: {len(pares)} | já tinham: {len(have)}")
print(f"documentos_esperados novos: {len(novos_de)} -> inseridos {insert('documentos_esperados', novos_de) if novos_de else 0}")

# 2) contas_bancarias ← banco do nome do extrato (quem não tem conta)
tem_conta = {c["empresa_id"] for c in get_all("contas_bancarias", {"select": "empresa_id"})}
extratos = get_all("documentos", {"select": "empresa_id,arquivo_nome", "tipo": "eq.extrato"})
banco_emp = {}
for e in extratos:
    emp = e["empresa_id"]
    if emp in tem_conta or emp in banco_emp:
        continue
    nome = (e.get("arquivo_nome") or "").lower()
    for k, v in BANCOS.items():
        if k in nome:
            banco_emp[emp] = v
            break
novas_cb = [{"empresa_id": emp, "banco": b, "agencia": "—", "conta": "—"} for emp, b in banco_emp.items()]
print(f"empresas já com conta: {len(tem_conta)} | bancos inferidos de extrato: {len(novas_cb)}")
print(f"contas_bancarias novas: {len(novas_cb)} -> inseridas {insert('contas_bancarias', novas_cb) if novas_cb else 0}")

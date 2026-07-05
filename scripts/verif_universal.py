#!/usr/bin/env python3
"""Verificação READ-ONLY do parser universal: baixa extratos reais do Storage e
roda parsear_extrato (entrypoint, aplica filtro de competência). Confere schema,
contagem, meses e distribuição débito/crédito. Não escreve nada."""
import sys, os, tempfile, requests
sys.path.insert(0, "src")
import bridge_front as bf
from parsers import extrato_bancario as eb
from collections import Counter

def baixar(storage_path):
    r = requests.get(f"{bf.URL}/storage/v1/object/documentos-clientes/{storage_path}",
                     headers=bf.SR_HEADERS, timeout=120)
    r.raise_for_status()
    return r.content

def testar(nome_sub, comp="2026-05"):
    docs = bf.sb_get("documentos", {
        "select": "arquivo_nome,storage_path,competencia",
        "arquivo_nome": f"ilike.*{nome_sub}*", "limit": "10"})
    docs = [d for d in docs if (d.get("arquivo_nome") or "").lower().endswith((".xls", ".xlsx"))]
    if not docs:
        print(f"  [{nome_sub}] não achado"); return
    d = docs[0]
    try:
        conteudo = baixar(d["storage_path"])
    except Exception as e:
        print(f"  [{nome_sub}] download falhou: {e}"); return
    suf = os.path.splitext(d["arquivo_nome"])[1] or ".xlsx"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suf); tmp.write(conteudo); tmp.close()
    try:
        tr = eb.parsear_extrato(tmp.name, banco="itau", competencia=d.get("competencia") or comp)
    except Exception as e:
        print(f"  [{nome_sub}] {d['arquivo_nome'][:40]} -> ERRO: {str(e)[:80]}"); return
    meses = dict(sorted(Counter(x["data"][:7] for x in tr).items()))
    tipos = dict(Counter(x["tipo"] for x in tr))
    print(f"  [{nome_sub}] {d['arquivo_nome'][:42]} (comp {d.get('competencia')})")
    print(f"       total={len(tr)} meses={meses} tipos={tipos}")

print("== (a) Itaú signed ==");        testar("Extrato_Conta Corrente Mai-26")   # BRAVE
print("== (b) BB cred/deb ==");        testar("Extrato Banco do Brasil Maio 2026")  # TANNU
print("== multi-aba ==");              testar("Extrato_maio")                     # ERICA
print("== multi-ano (filtro) ==");     testar("Extrato_Comentado")
print("== consolidado Itaú ==");       testar("Consolidado")

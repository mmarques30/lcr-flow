#!/usr/bin/env python3
"""Dedup de extratos por IDENTIDADE (agência+conta+competência). Diferente do
dedup por sobreposição de transações: aqui é a REGRA acordada — mesmo banco/
agência/conta/período = mesmo extrato → marca a duplicata (não apaga o doc),
vincula ao original (duplicata_de) e REMOVE a razão dela. Escopado por empresa.

Keeper (original que fica): mais lançamentos → xlsx/csv (comentada, mais rica)
sobre pdf → menor id. Grava extrato_chave em todos (backfill). DRY por padrão.

Uso: dedup_identidade.py [--cliente <substr no nome>] [--competencia AAAA-MM ...] [--apply]
"""
import sys, os, tempfile
sys.path.insert(0, "src")
import bridge_front as bf
from parsers.extrato_bancario import extrair_identidade, chave_extrato, detectar_banco
from collections import defaultdict

APPLY = "--apply" in sys.argv
COMPS = [a for a in sys.argv[1:] if a.startswith("20") and len(a) == 7]
CLIENTE = sys.argv[sys.argv.index("--cliente") + 1] if "--cliente" in sys.argv else None

def eh_extrato(d):
    n = (d.get("arquivo_nome") or "").lower()
    return (d.get("tipo") == "extrato" or "extrato" in n) and n.endswith((".xlsx", ".xls", ".pdf", ".csv"))

def keeper_score(d):
    n = (d.get("arquivo_nome") or "").lower()
    return (d.get("lancamentos_gerados") or 0, 1 if n.endswith((".xlsx", ".xls", ".csv")) else 0)

# 1. carrega docs de extrato
params = {"select": "id,empresa_id,arquivo_nome,competencia,tipo,lancamentos_gerados,storage_path,arquivo_url,duplicata_de"}
if CLIENTE:
    params["arquivo_nome"] = f"ilike.*{CLIENTE}*"
docs = [d for d in bf.get_all("documentos", params) if eh_extrato(d)]
if COMPS:
    docs = [d for d in docs if d.get("competencia") in COMPS]

# 2. computa chave por doc (download + parse cabeçalho)
grupos = defaultdict(list)  # (empresa_id, chave) -> [docs]
chave_por_doc = {}
for d in docs:
    sp = d.get("storage_path") or d.get("arquivo_url")
    if not sp:
        continue
    try:
        b = bf.baixar_storage(bf.BUCKET_DOCS, sp)
        e = os.path.splitext(d["arquivo_nome"])[1] or ".pdf"
        with tempfile.NamedTemporaryFile(suffix=e, delete=False) as tf:
            tf.write(b); c = tf.name
        try:
            idt = extrair_identidade(c, banco=detectar_banco(d["arquivo_nome"]))
        finally:
            os.unlink(c)
        ch = chave_extrato(idt, d["competencia"])
    except Exception as ex:
        ch = None
    chave_por_doc[d["id"]] = ch
    if ch:
        grupos[(d["empresa_id"], ch)].append(d)

# 3. resolve duplicatas
plano = []  # (keeper, [duplicatas])
for (eid, ch), ds in grupos.items():
    ativos = [d for d in ds if not d.get("duplicata_de")]  # ignora já-marcados
    if len(ativos) < 2:
        continue
    ordenado = sorted(ativos, key=keeper_score, reverse=True)
    keeper, dups = ordenado[0], ordenado[1:]
    plano.append((keeper, dups, ch))

tot_dup = sum(len(dups) for _, dups, _ in plano)
tot_raz = 0
print(f"{'APPLY' if APPLY else 'DRY'} · {len(docs)} extratos varridos · {len(plano)} grupo(s) com duplicata · {tot_dup} duplicata(s) a marcar\n")
for keeper, dups, ch in sorted(plano, key=lambda x: x[0].get("competencia") or ""):
    print(f"[{keeper['competencia']}] chave={ch}")
    print(f"    KEEPER  ger={keeper.get('lancamentos_gerados'):>3}  {keeper['arquivo_nome'][:50]}")
    for dp in dups:
        nraz = len(bf.get_all("lancamentos", {"select": "id", "documento_id": f"eq.{dp['id']}", "fonte_extrato": "eq.true"}))
        tot_raz += nraz
        print(f"    dup     ger={dp.get('lancamentos_gerados'):>3}  ({nraz} razão a remover)  {dp['arquivo_nome'][:50]}")
        if APPLY:
            if nraz:
                bf.sb_delete("lancamentos", {"documento_id": dp["id"]})
            bf.sb_update("documentos", {"id": dp["id"]},
                         {"duplicata_de": keeper["id"], "status_processamento": "duplicata",
                          "extrato_chave": ch, "lancamentos_gerados": 0})
    if APPLY:
        bf.sb_update("documentos", {"id": keeper["id"]}, {"extrato_chave": ch})

print(f"\nTOTAL: {tot_dup} duplicata(s), {tot_raz} lançamentos de razão " + ("REMOVIDOS." if APPLY else "a remover. [DRY] --apply p/ executar."))

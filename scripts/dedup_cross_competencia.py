#!/usr/bin/env python3
"""Dedup CROSS-competência: o MESMO extrato de maio caiu no drain (comp 2026-05,
movimento) E no tick de junho (comp 2026-06, decisão B — a cobrança de junho
carrega os docs de maio). Decisão da chefe: o statement fica em 2026-06 (tarefa).
Então, por empresa, cada doc de 2026-05 cujo conjunto (data,valor) está >= LIMIAR
contido num doc de 2026-06 é o DUPLICADO → apaga do lado 2026-05 só os lançamentos
cuja chave também existe no doc de 2026-06 (preserva cauda única). DRY por padrão.

Uso: dedup_cross_competencia.py [--apply]  (mantém 2026-06, apaga 2026-05)
"""
import sys, json
sys.path.insert(0, "src")
import bridge_front as bf
from collections import defaultdict
import requests

APPLY = "--apply" in sys.argv
def _arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default
MANTEM = _arg("--manter", "2026-06")     # competência que FICA com o statement
DESCARTA = _arg("--descartar", "2026-05")  # competência de onde a cópia é removida
LIMIAR = 0.8

def chave(l):
    return ((l.get("data_lancamento") or "")[:10], round(abs(float(l.get("valor") or 0)), 2))

def carrega(comp):
    L = bf.get_all("lancamentos", {"select": "id,empresa_id,documento_id,data_lancamento,valor",
                                   "competencia": f"eq.{comp}", "fonte_extrato": "eq.true", "order": "id"})
    # empresa -> doc -> {chave: [ids]}
    m = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for l in L:
        if l.get("documento_id"):
            m[l["empresa_id"]][l["documento_id"]][chave(l)].append(l["id"])
    return m

def nomes(comp):
    return {d["id"]: d.get("arquivo_nome") for d in
            bf.get_all("documentos", {"select": "id,arquivo_nome", "competencia": f"eq.{comp}"})}

m5 = carrega(DESCARTA); m6 = carrega(MANTEM)
n5 = nomes(DESCARTA); n6 = nomes(MANTEM)

def del_ids(ids):
    for k in range(0, len(ids), 100):
        chunk = ids[k:k + 100]
        r = requests.delete(f"{bf.URL}/rest/v1/lancamentos",
                            headers={**bf.SR_HEADERS, "Prefer": "return=minimal"},
                            params={"id": f"in.({','.join(chunk)})"}, timeout=60)
        if not r.ok:
            raise RuntimeError(f"DELETE falhou: {r.status_code} {r.text[:200]}")

plano = []
for eid in set(m5) & set(m6):
    docs5 = m5[eid]; docs6 = m6[eid]
    sets6 = {d: set(docs6[d].keys()) for d in docs6}
    for d5, ch5 in docs5.items():
        s5 = set(ch5.keys())
        if not s5:
            continue
        # acha o doc de junho mais sobreposto
        melhor, best = None, 0.0
        for d6, s6 in sets6.items():
            inter = len(s5 & s6)
            frac = inter / min(len(s5), len(s6)) if s6 else 0
            if frac > best:
                best, melhor = frac, d6
        if melhor and best >= LIMIAR:
            dup_chaves = s5 & sets6[melhor]
            ids = [i for c in dup_chaves for i in ch5[c]]
            unico = len(s5 - sets6[melhor])
            plano.append({"empresa": eid, "doc5": d5, "arq5": n5.get(d5), "arq6": n6.get(melhor),
                          "del_ids": ids, "n_del": len(ids), "unico_kept": unico, "overlap": round(best, 2)})

nd = sum(p["n_del"] for p in plano); nk = sum(p["unico_kept"] for p in plano)
print(f"Cross-comp {DESCARTA}→{MANTEM}: {len(plano)} doc(s) de {DESCARTA} duplicados de {MANTEM}")
print(f"  apaga {nd} lançamentos de {DESCARTA} · mantém {nk} únicos em {DESCARTA} · {len(set(p['empresa'] for p in plano))} empresas")
for p in sorted(plano, key=lambda x: -x["n_del"])[:15]:
    flag = f" (mantém {p['unico_kept']} únicos)" if p["unico_kept"] else ""
    print(f"    apaga {p['n_del']:>3} [{p['overlap']:.0%}]  {(p['arq5'] or '?')[:40]}  ~=  {(p['arq6'] or '?')[:40]}{flag}")
json.dump(plano, open("outputs/orquestracao/dedup-cross-comp.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
if not APPLY:
    print("\n[DRY] nada removido. --apply p/ executar.")
else:
    for p in plano:
        if p["del_ids"]:
            del_ids(p["del_ids"])
    print(f"\n[APPLY] {nd} lançamentos de {DESCARTA} removidos ({MANTEM} preservado).")

#!/usr/bin/env python3
"""Diagnóstico cross-competência dos bugs do pipeline (pré-fix). READ-ONLY.
Por competência mede:
  razao        = lançamentos fonte_extrato
  fora-ano     = razão com ano da data != ano da competência (contaminação multi-ano)
  dup-exced    = excedente de pares (empresa,data,valor) repetidos (suspeita de duplicação)
  pos->razao   = docs tipo=extrato cujo NOME é posição/investimento (razão espúria)
  cartao s/raz = docs cartão/fatura com 0 lançamentos (razão faltando; alguns são PDF c/ senha)
  extr s/lanc  = docs com 'extrato' no nome e 0 lançamentos (extrato pulado/falho?)
"""
import sys, json
sys.path.insert(0, "src")
import bridge_front as bf
from collections import defaultdict, Counter

POS = ["posic", "posiç", "consolidad", "renda-fixa", "renda fixa", "aplicac", "aplicaç", "cdb", "investiment", "fundo"]
CARD = ["fatura", "cartao", "cartão"]

def has(nome, kws):
    n = (nome or "").lower()
    return any(k in n for k in kws)

docs = bf.get_all("documentos", {"select": "id,competencia,tipo,arquivo_nome,lancamentos_gerados", "order": "id"})
lancs = bf.get_all("lancamentos", {"select": "competencia,data_lancamento,valor,empresa_id", "fonte_extrato": "eq.true", "order": "id"})

lanc_by = defaultdict(list); doc_by = defaultdict(list)
for l in lancs: lanc_by[l.get("competencia")].append(l)
for d in docs: doc_by[d.get("competencia")].append(d)

comps = sorted(c for c in set(list(lanc_by) + list(doc_by)) if c and len(str(c)) == 7)

print(f"{'COMP':9}{'razao':>7}{'foraAno':>8}{'dupExced':>9}{'posRazao':>9}{'cartSRaz':>9}{'extrSLan':>9}  {'docs':>5}")
linhas = []
for c in comps:
    ano = c[:4]
    L = lanc_by[c]; D = doc_by[c]
    fora = sum(1 for l in L if (l.get("data_lancamento") or "")[:4] != ano)
    pares = Counter((l.get("empresa_id"), (l.get("data_lancamento") or "")[:10], round(abs(float(l.get("valor") or 0)), 2)) for l in L)
    dup = sum(v - 1 for v in pares.values() if v > 1)
    pos = sum(1 for d in D if d.get("tipo") == "extrato" and has(d.get("arquivo_nome"), POS))
    cart = sum(1 for d in D if (d.get("tipo") == "fatura_cartao" or has(d.get("arquivo_nome"), CARD)) and not (d.get("lancamentos_gerados") or 0))
    extr = sum(1 for d in D if "extrato" in (d.get("arquivo_nome") or "").lower() and not (d.get("lancamentos_gerados") or 0))
    print(f"{c:9}{len(L):>7}{fora:>8}{dup:>9}{pos:>9}{cart:>9}{extr:>9}  {len(D):>5}")
    linhas.append({"comp": c, "razao": len(L), "fora_ano": fora, "dup_exced": dup,
                   "pos_razao": pos, "cartao_sem_razao": cart, "extrato_sem_lanc": extr, "docs": len(D)})

json.dump(linhas, open("outputs/orquestracao/diag-competencias.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"\nTOTais docs={len(docs)} razao={len(lancs)} · salvo em outputs/orquestracao/diag-competencias.json")

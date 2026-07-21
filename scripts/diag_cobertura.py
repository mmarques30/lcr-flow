#!/usr/bin/env python3
"""Cobertura PROC-001: Gestta DONE vs ledger/Supabase por competência."""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from orquestrar import (  # noqa: E402
    _carregar_ledger,
    ja_processada,
    listar_cobrancas_api,
    resolver_empresa,
    selecionar_pendentes,
)

import bridge_front as bf  # noqa: E402


def analisar(comp: str, statuses: list[str]) -> dict:
    tarefas = listar_cobrancas_api(comp, statuses)
    ledger = _carregar_ledger()
    ledger_comp = [k for k in ledger if k.endswith(f":{comp}")]

    sem_empresa = []
    nao_proc = []
    proc_ledger = []
    proc_supabase = []

    for t in tarefas:
        cod = t.get("clienteCodigo") or ""
        nome = t.get("clienteNome") or ""
        try:
            emp = resolver_empresa(cod, nome)
        except Exception:
            emp = None
        if not emp:
            sem_empresa.append({"codigo": cod, "nome": nome, "taskId": t.get("taskId")})
            continue
        eid = emp["id"]
        if ja_processada(eid, comp):
            proc_supabase.append(eid)
        elif f"{eid}:{comp}" in ledger:
            proc_ledger.append(eid)
        else:
            nao_proc.append({
                "codigo": cod,
                "nome": nome,
                "empresa_id": eid,
                "taskId": t.get("taskId"),
                "competence_gestta": t.get("competence"),
            })

    pend_sel = selecionar_pendentes(tarefas, comp, 9999)

    # docs no Supabase para a competência
    docs = bf.get_all("documentos", {
        "select": "id,empresa_id",
        "competencia": f"eq.{comp}",
        "origem": "eq.gestta",
    })
    emp_com_doc = len({d["empresa_id"] for d in docs if d.get("empresa_id")})

    return {
        "competencia": comp,
        "statuses": statuses,
        "gestta_total": len(tarefas),
        "ledger_keys": len(ledger_comp),
        "processadas_supabase": len(proc_supabase),
        "processadas_so_ledger": len(proc_ledger),
        "nao_processadas": len(nao_proc),
        "sem_empresa": len(sem_empresa),
        "selecionar_pendentes_9999": len(pend_sel),
        "empresas_com_documento": emp_com_doc,
        "documentos_total": len(docs),
        "amostra_pendentes": nao_proc[:12],
        "amostra_sem_empresa": sem_empresa[:5],
        "competence_date_gestta": dict(Counter(t.get("competence") or comp for t in tarefas).most_common(6)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--competencia", action="append", required=True)
    ap.add_argument("--status", default="OPEN,DONE")
    args = ap.parse_args()
    statuses = [s.strip().upper() for s in args.status.split(",") if s.strip()]
    for comp in args.competencia:
        r = analisar(comp, statuses)
        print(json.dumps(r, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

"""Reprocessa os 4 clientes mar/2026 que falharam por .rar no download."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import bridge_front as bf  # noqa: E402
import orquestrar  # noqa: E402
from orquestrar import (  # noqa: E402
    _gestta_jwt,
    listar_cobrancas_api,
    processar_tarefa_api,
    resolver_empresa,
    marcar_processada,
)

# Forca reprocesso mesmo com docs gestta ja gravados (extracao .rar falhou antes).
orquestrar.ja_processada = lambda _e, _c: False

CLIENTES = [
    "SUD America",
    "F2AB",
    "Penteado",
    "APM Mafan",
]
COMP = "2026-03"


def main():
    jwt = bf.obter_jwt()
    jwt_g = _gestta_jwt()
    comp_g = bf.comp_to_gestta(COMP)
    tarefas = listar_cobrancas_api(COMP, ["OPEN", "DONE"])
    alvo = []
    for c in CLIENTES:
        c_l = c.lower()
        for t in tarefas:
            if c_l in (t.get("clienteCodigo") or "").lower() or c_l in (t.get("clienteNome") or "").lower():
                alvo.append(t)
                break
        else:
            print(f"NAO_ENCONTRADO: {c}")

    print(f"Reprocessando {len(alvo)} tarefa(s)...")
    for i, t in enumerate(alvo, 1):
        emp = resolver_empresa(t.get("clienteCodigo") or "", t.get("clienteNome") or "")
        t["_empresa"] = emp
        print(f"\n[{i}/{len(alvo)}] {t.get('clienteNome')}")
        # Forca reprocesso (ledger limpo manualmente p/ estes clientes).
        r = processar_tarefa_api(t, COMP, comp_g, jwt, jwt_g, ignorar_suficiencia=True)
        print(f"  -> {r.get('status')}: {(r.get('motivo') or '')[:120]}")
        if r.get("status") in ("processada", "sem_documentos", "incompleta"):
            marcar_processada(r.get("empresa_id"), r.get("competencia_movimento") or COMP)


if __name__ == "__main__":
    main()

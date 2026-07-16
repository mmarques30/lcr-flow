#!/usr/bin/env python3
"""
scripts/backfill_conciliacao.py — backfill A1 da conciliação.

Para os clientes JÁ processados (antes do deploy que passou a persistir o extrato),
re-parseia os arquivos de extrato que estão no Storage (bucket documentos-clientes),
junta as transações de todas as contas do mês, e cria a linha `conciliacoes` com
extrato_csv_url — habilitando o botão "Conciliar agora" sem reprocessar nada.

LEVE: não baixa do Gestta, não chama Claude. Só Storage + parser + insert.
IDEMPOTENTE: pula empresa/competência que já tem extrato_csv_url.

Uso (na VPS, da raiz /opt/lcr):
  PYTHONUTF8=1 venv/bin/python3 scripts/backfill_conciliacao.py [--competencia 2026-06]
"""
import argparse
import os
import sys
import tempfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "parsers"))

import bridge_front as bf                       # noqa: E402
from extrato_bancario import parsear_extrato     # noqa: E402


def baixar_storage(bucket: str, path: str) -> bytes:
    r = requests.get(f"{bf.URL}/storage/v1/object/{bucket}/{path}", headers=bf.SR_HEADERS, timeout=120)
    if not r.ok:
        raise RuntimeError(f"download {path}: {r.status_code} {r.text[:120]}")
    return r.content


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--competencia", default=None, help="limita a uma competência YYYY-MM (default: todas)")
    args = ap.parse_args()

    filtro = {"select": "empresa_id,competencia,competencia_id,storage_path,arquivo_nome",
              "tipo": "eq.extrato", "origem": "eq.gestta"}
    if args.competencia:
        filtro["competencia"] = f"eq.{args.competencia}"
    docs = bf.sb_get("documentos", filtro)

    grupos = {}
    for d in docs:
        if not d.get("storage_path"):
            continue
        k = (d["empresa_id"], d["competencia"])
        grupos.setdefault(k, {"competencia_id": d.get("competencia_id"), "docs": []})
        grupos[k]["docs"].append(d)
    print(f"{len(grupos)} empresa/competência com extrato salvo no storage", flush=True)

    feitos = pulados = sem_tx = 0
    for (empresa_id, competencia), g in grupos.items():
        existe = bf.sb_get("conciliacoes", {
            "empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{competencia}",
            "select": "id,extrato_csv_url", "limit": "1",
        })
        if existe and existe[0].get("extrato_csv_url"):
            pulados += 1
            continue

        transacoes = []
        for d in g["docs"]:
            try:
                conteudo = baixar_storage(bf.BUCKET_DOCS, d["storage_path"])
                suf = Path(d.get("arquivo_nome") or d["storage_path"]).suffix or ".pdf"
                with tempfile.NamedTemporaryFile(suffix=suf, delete=False) as tf:
                    tf.write(conteudo)
                    tmp = tf.name
                try:
                    # banco=None → autodetecção (nome do arquivo original preservado
                    # via suffix, e detectar_banco também lê o conteúdo do PDF quando
                    # o nome não ajuda). Antes hardcoded "itau", forçava o parser
                    # errado em extratos de outros bancos.
                    transacoes.extend(parsear_extrato(tmp))
                finally:
                    os.unlink(tmp)
            except Exception as e:
                print(f"  [skip arquivo] {d.get('arquivo_nome')}: {str(e)[:100]}", flush=True)

        if not transacoes:
            sem_tx += 1
            print(f"  [sem transações] {empresa_id} {competencia}", flush=True)
            continue

        comp_id = g["competencia_id"] or bf.ensure_competencia(empresa_id, competencia)
        try:
            cid = bf.ensure_conciliacao_extrato(empresa_id, competencia, comp_id, transacoes)
            feitos += 1
            print(f"  [ok] {empresa_id} {competencia}: {len(transacoes)} transação(ões) → conc={cid}", flush=True)
        except Exception as e:
            print(f"  [ERRO insert] {empresa_id} {competencia}: {str(e)[:120]}", flush=True)

    print(f"RESUMO: feitos={feitos} · pulados (já tinham extrato)={pulados} · sem_transações={sem_tx}", flush=True)


if __name__ == "__main__":
    main()

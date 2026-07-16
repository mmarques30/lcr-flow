#!/usr/bin/env python3
"""
Corrige lançamentos de extratos afetados pelo bug de desalinhamento de coluna
do parser Itaú Excel (valor lido da coluna "Documento" → valores absurdos,
ex.: R$ 7 bi no Alexandre Bamberg). Ver commit db95e3e (fix do parser).

Fluxo por documento:
  baixa o arquivo do Storage → reparseia (parser corrigido) → reclassifica (motor IA)
  → mapeia conta_id/historico_id → [dry-run: mostra e salva preview] / [--apply: deleta
  os lançamentos antigos do doc e insere os corretos, mantendo o MESMO documento_id].

Uso (na VPS):
  venv/bin/python3 scripts/corrigir_extratos.py            # dry-run (não escreve)
  venv/bin/python3 scripts/corrigir_extratos.py --apply    # aplica (lê o preview do dry-run)
  venv/bin/python3 scripts/corrigir_extratos.py <doc_id> [<doc_id> ...]   # docs específicos
"""
import os, sys, json, tempfile, requests
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ("src", "src/parsers", "src/ai", "src/sci"):
    sys.path.insert(0, str(ROOT / sub))

import bridge_front as bf                       # noqa: E402
from motor_classificacao import classificar_extrato   # noqa: E402
import extrato_bancario as EB                   # noqa: E402
from gerar_planilha_supabase import BANCO_PARA_CODIGO  # noqa: E402

BANCO_PADRAO = 657  # Itaú (mesmo fallback do orquestrar.py)
PREVIEW_DIR = ROOT / "outputs" / "reproc"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

# documentos afetados confirmados no dry-run de escopo (2026-07-01)
DOCS_PADRAO = [
    "7dabb78b-5a5a-4f5f-8da2-ff8a689cce4f",  # Alexandre Bamberg Consultoria — 2026-05
    "91c43c7d-e15c-4905-8ac7-7e3bc71988fd",  # RW Lamonica Ltda — 2026-06
]


def resolver_banco(empresa_id):
    contas = bf.sb_get("contas_bancarias", {"select": "banco", "empresa_id": f"eq.{empresa_id}", "limit": "1"})
    if not contas:
        return None
    banco = (contas[0].get("banco") or "").lower()
    for nome, cod in BANCO_PARA_CODIGO.items():
        if nome.strip() in banco:
            return cod
    return None


def baixar_storage(path: str) -> bytes:
    r = requests.get(f"{bf.URL}/storage/v1/object/{bf.BUCKET_DOCS}/{path}",
                     headers=bf.SR_HEADERS, timeout=120)
    r.raise_for_status()
    return r.content


def deletar_lancamentos(documento_id: str):
    r = requests.delete(f"{bf.URL}/rest/v1/lancamentos",
                        headers={**bf.SR_HEADERS, "Prefer": "return=minimal"},
                        params={"documento_id": f"eq.{documento_id}"}, timeout=60)
    if not r.ok:
        raise RuntimeError(f"DELETE lancamentos falhou: {r.status_code} {r.text[:200]}")


def montar_preview(documento_id: str) -> dict:
    doc = bf.sb_get("documentos", {"id": f"eq.{documento_id}",
          "select": "empresa_id,competencia,competencia_id,storage_path,arquivo_nome"})
    if not doc:
        raise RuntimeError(f"documento {documento_id} não encontrado")
    doc = doc[0]
    empresa_id = doc["empresa_id"]; competencia = doc["competencia"]
    competencia_id = doc["competencia_id"]; storage_path = doc["storage_path"]
    banco_cod = resolver_banco(empresa_id) or BANCO_PADRAO
    comp_motor = f"{competencia[5:7]}/{competencia[0:4]}"

    # estado atual (será substituído)
    atuais = bf.sb_get("lancamentos", {"documento_id": f"eq.{documento_id}", "select": "id,valor"})

    # baixa + reparseia (parser corrigido)
    conteudo = baixar_storage(storage_path)
    ext = os.path.splitext(doc.get("arquivo_nome") or storage_path)[1] or ".xlsx"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext); tmp.write(conteudo); tmp.close()
    try:
        transacoes = EB.parsear_extrato(tmp.name, competencia=competencia)
    finally:
        os.unlink(tmp.name)
    if not transacoes:
        raise RuntimeError("reparse não extraiu transações")

    # reclassifica + mapeia
    resultado = classificar_extrato(transacoes, conta_banco=banco_cod, competencia=comp_motor)
    aprovadas = resultado["aprovadas"]
    revisao = [r["classificacao_sugerida"] for r in resultado["revisao_manual"]]
    conta_map = bf.carregar_mapa_codigos("plano_contas")
    hist_map = bf.carregar_mapa_codigos("historicos_contabeis")

    novos, sem_conta = [], 0
    for linha in aprovadas + revisao:
        reg, conta_id = bf.linha_para_lancamento(linha, banco_cod, conta_map, hist_map,
                                                 empresa_id, competencia, competencia_id, documento_id)
        if conta_id is None:
            sem_conta += 1
        novos.append(reg)

    return {
        "documento_id": documento_id, "empresa_id": empresa_id, "competencia": competencia,
        "banco_cod": banco_cod, "arquivo": doc.get("arquivo_nome"),
        "atuais_n": len(atuais), "atuais_soma": round(sum(abs(float(x["valor"])) for x in atuais), 2),
        "transacoes": len(transacoes), "aprovadas": len(aprovadas), "revisao": len(revisao),
        "erros_motor": resultado["resumo"]["erros"], "sem_conta": sem_conta,
        "novos": novos, "novos_soma": round(sum(abs(float(r["valor"])) for r in novos), 2),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    docs = args or DOCS_PADRAO

    for doc_id in docs:
        pf = PREVIEW_DIR / f"{doc_id}.json"
        print("\n" + "=" * 86)
        if apply:
            if not pf.exists():
                print(f"[{doc_id}] SEM PREVIEW — rode o dry-run antes. Pulando."); continue
            p = json.loads(pf.read_text(encoding="utf-8"))
            print(f"APLICANDO {p.get('arquivo')} ({doc_id})")
            print(f"  deletando {p['atuais_n']} lançamentos antigos e inserindo {len(p['novos'])} corretos...")
            deletar_lancamentos(doc_id)
            if p["novos"]:
                bf.sb_insert("lancamentos", p["novos"], retornar=False)
            print(f"  OK: {len(p['novos'])} lançamentos (soma R$ {p['novos_soma']:,.2f})")
        else:
            p = montar_preview(doc_id)
            json.dump(p, open(pf, "w", encoding="utf-8"), ensure_ascii=False, indent=2, default=str)
            print(f"DRY-RUN {p['arquivo']} ({doc_id})  banco_cod={p['banco_cod']}")
            print(f"  ATUAL no banco : {p['atuais_n']:>3} lançamentos | soma R$ {p['atuais_soma']:>16,.2f}")
            print(f"  CORRIGIDO      : {len(p['novos']):>3} lançamentos | soma R$ {p['novos_soma']:>16,.2f}"
                  f"  (aprovadas={p['aprovadas']} revisão={p['revisao']} erros={p['erros_motor']} sem_conta={p['sem_conta']})")
            print(f"  {'data':<11} {'valor':>13} {'conta_id':>10} {'hist':>6} {'status':<8} descrição")
            print("  " + "-" * 78)
            for r in sorted(p["novos"], key=lambda x: abs(float(x["valor"])), reverse=True)[:12]:
                cid = "sem" if r.get("conta_id") is None else str(r["conta_id"])[:8]
                hid = "-" if r.get("historico_id") is None else str(r["historico_id"])[:4]
                print(f"  {str(r.get('data_lancamento')):<11} {float(r['valor']):>13,.2f} {cid:>10} {hid:>6} "
                      f"{str(r.get('status')):<8} {str(r.get('descricao'))[:34]}")
            print(f"  preview salvo em {pf}")

    if not apply:
        print("\n>>> dry-run concluído. Nenhuma escrita no banco. Para aplicar: --apply")


if __name__ == "__main__":
    main()

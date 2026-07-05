#!/usr/bin/env python3
"""Reprocessa EXTRATOS existentes pelo motor LOCAL (parser + IA de classificação),
reusando o documento_id (baixa o original do storage, re-parseia, re-classifica,
troca os lançamentos). É o engine primário de razão (tem Mapa/De-para e o fix da
descrição=histórico-do-banco). Lê Excel também (parsear_extrato -> parsear_excel),
resolvendo os extratos .xls/.xlsx que a edge não abre.

Uso: reprocessar_extrato_local.py <doc_id> [<doc_id> ...] [--apply]
     reprocessar_extrato_local.py --competencia 2026-05 --dropped [--apply] [--limite N]
       (--dropped = só extratos tipo=extrato com 0 lançamentos)
"""
import sys, os, json, tempfile
sys.path.insert(0, "src")
import bridge_front as bf
from parsers.extrato_bancario import parsear_extrato
from ai.motor_classificacao import classificar_extrato

APPLY = "--apply" in sys.argv
BANCO_COD = 657  # Itaú (default do pipeline vivo)

def _arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default

def reprocessar(doc, conta_map, hist_map, apply):
    did = doc["id"]; nome = doc.get("arquivo_nome") or "doc"
    comp = doc.get("competencia"); sp = doc.get("storage_path") or doc.get("arquivo_url")
    if not sp:
        return {"doc": nome, "status": "sem_storage_path"}
    conteudo = bf.baixar_storage(bf.BUCKET_DOCS, sp)
    ext = os.path.splitext(nome)[1] or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
        tf.write(conteudo); caminho = tf.name
    try:
        transacoes = parsear_extrato(caminho, banco="itau", competencia=comp)
    finally:
        try: os.unlink(caminho)
        except OSError: pass
    if not transacoes:
        return {"doc": nome, "status": "parser_0_transacoes"}  # cai p/ edge no fluxo vivo
    comp_motor = f"{comp[5:7]}/{comp[0:4]}"
    res = classificar_extrato(transacoes, conta_banco=BANCO_COD, competencia=comp_motor)
    aprovadas = res["aprovadas"]; revisao = [r["classificacao_sugerida"] for r in res["revisao_manual"]]
    linhas = aprovadas + revisao
    novos = []
    comp_id = bf.ensure_competencia(doc["empresa_id"], comp)
    for l in linhas:
        reg, _ = bf.linha_para_lancamento(l, BANCO_COD, conta_map, hist_map,
                                          doc["empresa_id"], comp, comp_id, did)
        novos.append(reg)
    amostra = [f"{n['data_lancamento']} R${n['valor']:.2f} {n['descricao'][:40]}" for n in novos[:4]]
    if apply:
        bf.sb_delete("lancamentos", {"documento_id": did})  # troca (evita dup)
        if novos:
            bf.sb_insert("lancamentos", novos, retornar=False)
        bf.sb_update("documentos", {"id": did},
                     {"tipo": "extrato", "status_processamento": "classificado",
                      "lancamentos_gerados": len(novos)})
    return {"doc": nome, "status": "ok", "transacoes": len(transacoes),
            "lancamentos": len(novos), "amostra": amostra}

def main():
    conta_map = bf.carregar_mapa_codigos("plano_contas")
    hist_map = bf.carregar_mapa_codigos("historicos_contabeis")
    ids = [a for a in sys.argv[1:] if len(a) >= 8 and "-" in a and not a.startswith("--") and not a.startswith("20")]
    if "--dropped" in sys.argv:
        comp = _arg("--competencia", "2026-05")
        limite = int(_arg("--limite", "0") or 0)
        docs = bf.get_all("documentos", {"select": "id,arquivo_nome,competencia,empresa_id,storage_path,arquivo_url,lancamentos_gerados",
                                         "competencia": f"eq.{comp}", "tipo": "eq.extrato"})
        docs = [d for d in docs if not (d.get("lancamentos_gerados") or 0)]
        if limite:
            docs = docs[:limite]
    else:
        docs = [bf.get_all("documentos", {"select": "id,arquivo_nome,competencia,empresa_id,storage_path,arquivo_url,lancamentos_gerados", "id": f"eq.{i}"})[0] for i in ids]
    print(f"Reprocesso LOCAL de {len(docs)} extrato(s) — {'APPLY' if APPLY else 'DRY'}\n")
    okc = rec = fail = 0
    for d in docs:
        try:
            r = reprocessar(d, conta_map, hist_map, APPLY)
        except Exception as e:
            r = {"doc": d.get("arquivo_nome"), "status": f"ERRO: {str(e)[:100]}"}
        if r["status"] == "ok":
            okc += 1; rec += r["lancamentos"]
            print(f"  OK  {r['doc'][:45]}: {r['transacoes']} tx -> {r['lancamentos']} lanç")
            for a in r.get("amostra", []): print(f"        {a}")
        else:
            fail += 1
            print(f"  --  {r['doc'][:45]}: {r['status']}")
    print(f"\n{okc} ok ({rec} lançamentos), {fail} sem razão/erro. {'' if APPLY else '[DRY] --apply p/ gravar.'}")

main()

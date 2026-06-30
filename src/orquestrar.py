"""
src/orquestrar.py

Orquestra o PROC-001 (Etapas 1–4) em TODAS as tarefas COBRANÇA de uma competência.
Para cada tarefa:
  1. Entra na tarefa (COBRANÇA DE MOVIMENTO MENSAL)
  2. Analisa suficiência dos documentos (Gestta leitura + motor IA)
  3. Se ok → baixa documentos
  4. IA classifica → envia classificados E não-classificados ao front (revisão humana)

REGRA: NÃO escreve nada no Gestta (não conclui tarefa). Conclusão/ajuste fino e
conciliação são manuais na interface, antes do SCI (Etapa 5, em standby).

Pensado para ser disparado pelo n8n (Execute Command), por competência:
  python src/orquestrar.py --competencia 2026-06 [--limite N] [--cliente CODIGO]

Rode da raiz do repo, com PYTHONUTF8=1 no Windows.
"""

import sys
import json
import time
import argparse
import datetime as dt
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "ai"))
sys.path.insert(0, str(ROOT / "src" / "sci"))

import bridge_front as bf                                  # noqa: E402  (obter_jwt, sb_get, processar_via_gestta, _node_eval, comp_to_gestta, vincular_consultor)
from motor_classificacao import avaliar_suficiencia_documentos  # noqa: E402
from gerar_planilha_supabase import BANCO_PARA_CODIGO       # noqa: E402

OUT_DIR = ROOT / "outputs" / "orquestracao"
LEDGER = OUT_DIR / "processadas.json"  # idempotência local (cobre 'processada' sem doc no front)
BANCO_PADRAO = 657  # Itaú (fallback)
COBRANCA_TEMPLATE = "614b4c905962410006a60e08"  # template "COBRANÇA DE MOVIMENTO MENSAL"
GESTTA_SEARCH = "https://api.gestta.com.br/core/customer/task/search"
SESSION_FILE = ROOT / "sessions" / "gestta-session.json"


def _gestta_jwt() -> str:
    """Lê o token (ngStorage-jwt) do arquivo de sessão → 'JWT eyJ...'."""
    s = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
    for o in s.get("origins", []):
        for kv in o.get("localStorage", []):
            if kv.get("name") == "ngStorage-jwt":
                return json.loads(kv["value"])  # remove aspas do JSON → "JWT eyJ..."
    raise RuntimeError("token ngStorage-jwt não encontrado na sessão Gestta")


def listar_cobrancas_api(competencia: str) -> list:
    """Lista tarefas COBRANÇA DE MOVIMENTO MENSAL via API direta (sem navegador).
    Filtra por Data Meta (DUE_DATE) no mês da competência. Paginação automática."""
    jwt = _gestta_jwt()
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    ny, nm = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    start = f"{ano:04d}-{mes:02d}-01T03:00:00.000Z"
    end = f"{ny:04d}-{nm:02d}-01T02:59:59.999Z"
    base = {
        "type": ["SERVICE_ORDER", "RECURRENT", "ACCOUNTING"],
        "company_task": [COBRANCA_TEMPLATE], "status": ["OPEN"],
        "start_date": start, "end_date": end, "date_type": "DUE_DATE",
        "overdue": False, "downloaded": False, "not_downloaded": False, "fine": False,
        "on_time": False, "collaborator": False, "no_owner": False, "email_not_sent": False,
        "document_request_sent": True, "without_external_user": False, "os_free": False,
        "os_workflow": True, "limit": 100,
    }
    headers = {"Authorization": jwt, "Content-Type": "application/json"}
    out, page = [], 1
    while True:
        r = requests.post(GESTTA_SEARCH, headers=headers, json={**base, "page": page}, timeout=60)
        if not r.ok:
            raise RuntimeError(f"Gestta search HTTP {r.status_code}: {r.text[:200]}")
        docs = r.json().get("docs", [])
        for d in docs:
            cust = d.get("customer") or {}
            out.append({
                "taskId": d.get("_id"),
                "nome": d.get("name"),
                "clienteCodigo": cust.get("code") or "",
                "clienteNome": cust.get("name") or "",
                "responsavel": (d.get("owner") or {}).get("name") or "",
                "competence": (d.get("competence_date") or "")[:7],  # mês do movimento (lag)
            })
        if len(docs) < base["limit"]:
            break
        page += 1
    return out


def log(msg):
    print(msg, flush=True)


# ── Gestta (somente leitura) via subprocess Node ─────────────────────────────
def gestta(fn: str, *args) -> object:
    args_js = ",".join(json.dumps(a) for a in args)
    js = (f"const g=require('./src/gestta/index.js');"
          f"g.{fn}({args_js})"
          ".then(r=>console.log(JSON.stringify(r)))"
          ".catch(e=>{console.error(e.message);process.exit(1)});")
    return json.loads(bf._node_eval(js))


# ── Resolução de empresa e banco ─────────────────────────────────────────────
def resolver_empresa(codigo: str, nome: str):
    for termo in (nome, codigo):
        if not termo:
            continue
        # O valor vai entre aspas duplas: assim vírgula/parênteses do nome não são
        # lidos como separadores da árvore lógica do or() do PostgREST (PGRST100).
        # Aspas duplas embutidas quebrariam o quoting → viram espaço.
        t = termo.strip().replace('"', " ")
        if not t:
            continue
        try:
            rows = bf.sb_get("empresas", {
                "select": "id,razao_social,nome_fantasia,cnpj",
                "or": f'(nome_fantasia.ilike."*{t}*",razao_social.ilike."*{t}*")',
                "limit": "2",
            })
        except Exception as e:
            log(f"    resolver_empresa: filtro falhou p/ '{t[:40]}' ({str(e)[:120]}) — tenta próximo termo")
            continue
        if rows:
            return rows[0]
    return None


def resolver_banco(empresa_id: str):
    contas = bf.sb_get("contas_bancarias", {"select": "banco", "empresa_id": f"eq.{empresa_id}", "limit": "1"})
    if not contas:
        return None
    banco = (contas[0].get("banco") or "").lower()
    for nome, cod in BANCO_PARA_CODIGO.items():
        if nome.strip() in banco:
            return cod
    return None


def _carregar_ledger() -> dict:
    """Ledger local de tarefas já processadas (chave 'empresa_id:competencia')."""
    try:
        return json.loads(LEDGER.read_text(encoding="utf-8"))
    except Exception:
        return {}


def marcar_processada(empresa_id: str, competencia: str):
    """Registra no ledger que (empresa, competência) foi processada — inclusive quando
    rendeu 0 lançamentos/0 docs (caso que não cria linha em documentos e, sem isto,
    seria reprocessado todo tick, consumindo um slot do lote à toa)."""
    if not empresa_id:
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    led = _carregar_ledger()
    led[f"{empresa_id}:{competencia}"] = dt.datetime.now().isoformat(timespec="seconds")
    LEDGER.write_text(json.dumps(led, ensure_ascii=False, indent=0), encoding="utf-8")


def ja_processada(empresa_id: str, competencia: str) -> bool:
    # 1) Ledger local (cobre 'processada sem resultado', que não grava doc no front)
    if f"{empresa_id}:{competencia}" in _carregar_ledger():
        return True
    # 2) Doc origem=gestta no front (cobre processamentos anteriores ao ledger)
    docs = bf.sb_get("documentos", {
        "select": "id", "empresa_id": f"eq.{empresa_id}",
        "competencia": f"eq.{competencia}", "origem": "eq.gestta", "limit": "1",
    })
    return bool(docs)


def selecionar_pendentes(tarefas: list, competencia: str, limite: int) -> list:
    """Varre a lista e devolve as próximas `limite` tarefas AINDA NÃO processadas,
    já com a empresa resolvida (anexada em t['_empresa']).

    Bug B: o n8n horário fatia `tarefas[:limite]` sempre do topo da lista; como as
    já-processadas ficam no início e nunca somem, o lote ficava preso nas mesmas 5.
    Pré-filtrar por idempotência aqui garante que cada tick avance em quem falta.
    Tarefas cuja empresa não resolve seguem como pendentes (viram 'erro' visível no loop)."""
    pend = []
    for t in tarefas:
        nome = t.get("clienteNome") or ""
        codigo = t.get("clienteCodigo") or ""
        try:
            empresa = resolver_empresa(codigo, nome)
        except Exception:
            empresa = None
        if empresa is not None:
            comp_mov = t.get("competence") or competencia
            if ja_processada(empresa["id"], comp_mov):
                continue  # já feita → não consome slot do lote
        t["_empresa"] = empresa
        pend.append(t)
        if len(pend) >= limite:
            break
    return pend


# ── Processa uma tarefa (Etapas 1–4, sem escrever no Gestta) ──────────────────
def processar_tarefa(t: dict, competencia: str, comp_g: str, jwt: str) -> dict:
    codigo = t.get("clienteCodigo") or ""
    nome = t.get("clienteNome") or ""
    resp = t.get("responsavel") or ""
    tarefa_id = t.get("taskId")
    base = {"cliente": nome or codigo, "tarefa_id": tarefa_id}

    if not tarefa_id:
        return {**base, "status": "erro", "motivo": "tarefa sem taskId"}

    empresa = t["_empresa"] if "_empresa" in t else resolver_empresa(codigo, nome)
    if not empresa:
        return {**base, "status": "erro", "motivo": f"empresa não encontrada no Supabase ('{nome or codigo}')"}
    empresa_id = empresa["id"]
    comp_mov = t.get("competence") or competencia   # mês do movimento (lançamentos vão p/ cá)
    base["empresa_id"] = empresa_id
    base["competencia_movimento"] = comp_mov

    if ja_processada(empresa_id, comp_mov):
        return {**base, "status": "pulada_idempotencia"}

    # Etapa 2 — suficiência (Gestta leitura + IA)
    try:
        suf = gestta("analisarSuficienciaDocumentos", tarefa_id, comp_g)
    except Exception as e:
        return {**base, "status": "erro", "motivo": f"suficiência: {str(e)[:600]}"}
    try:
        ia = avaliar_suficiencia_documentos(suf.get("observacao", ""), suf.get("documentos", []), comp_g)
    except Exception:
        ia = {"suficiente": suf.get("suficiente", False), "faltando": suf.get("pendentes", [])}
    suficiente = bool(suf.get("suficiente")) and bool(ia.get("suficiente", True))
    if not suficiente:
        return {**base, "status": "aguardando_docs",
                "faltando": ia.get("faltando") or suf.get("pendentes") or []}

    # Etapa 4 — baixa + classifica + envia ao front (sem concluir no Gestta)
    banco = resolver_banco(empresa_id) or BANCO_PADRAO
    try:
        resumo = bf.processar_via_gestta(empresa_id, competencia, None, tarefa_id, banco, jwt, competencia_front=comp_mov)
    except Exception as e:
        return {**base, "status": "erro", "motivo": f"etapa4: {str(e)[:600]}"}

    # Vincula o consultor responsável (processar_via_gestta com tarefa_id não resolve responsavel)
    if resp:
        try:
            bf.vincular_consultor(empresa_id, resp)
        except Exception:
            pass

    extratos = resumo.get("extratos", [])
    lanc = sum(e.get("lancamentos", 0) for e in extratos)
    return {**base, "status": "processada", "banco": banco, "consultor": resp,
            "lancamentos_extrato": lanc, "outros_docs": len(resumo.get("outros", []))}


def main():
    ap = argparse.ArgumentParser(description="Orquestra PROC-001 Etapas 1–4 em todas as tarefas COBRANÇA")
    ap.add_argument("--competencia", required=True, help="YYYY-MM")
    ap.add_argument("--limite", type=int, default=None, help="máximo de tarefas por execução")
    ap.add_argument("--cliente", default=None, help="processa só um cliente (código/nome contém)")
    ap.add_argument("--pausa", type=float, default=0,
                    help="segundos de pausa entre tarefas (espalha a carga; ex.: 90 p/ rodar devagar à noite)")
    args = ap.parse_args()

    comp_g = bf.comp_to_gestta(args.competencia)
    log(f"=== Orquestração PROC-001 · competência {args.competencia} ({comp_g}) ===")
    log("  (somente leitura no Gestta — não conclui tarefas)")

    jwt = bf.obter_jwt()
    log("  JWT do usuário de serviço obtido ✓")

    log(f"\n[E1] Listando tarefas COBRANÇA via API ({args.competencia})...")
    tarefas = listar_cobrancas_api(args.competencia)
    log(f"    {len(tarefas)} tarefa(s) COBRANÇA encontradas (resolver direto, sem navegador)")

    if args.cliente:
        c = args.cliente.lower()
        tarefas = [t for t in tarefas
                   if c in (t.get("clienteCodigo") or "").lower() or c in (t.get("clienteNome") or "").lower()]
        log(f"    filtro --cliente '{args.cliente}': {len(tarefas)} tarefa(s)")
    if args.limite:
        tarefas = selecionar_pendentes(tarefas, args.competencia, args.limite)
        log(f"    --limite {args.limite}: {len(tarefas)} pendente(s) selecionada(s) (já-processadas puladas antes do corte)")

    resultados = []
    for i, t in enumerate(tarefas, 1):
        log(f"\n── [{i}/{len(tarefas)}] {t.get('clienteCodigo')} - {t.get('clienteNome')} ──")
        try:
            r = processar_tarefa(t, args.competencia, comp_g, jwt)
        except Exception as e:
            # Blindagem (Bug A): uma tarefa ruim nunca pode derrubar o run inteiro.
            r = {"cliente": t.get("clienteNome") or t.get("clienteCodigo"),
                 "tarefa_id": t.get("taskId"), "status": "erro",
                 "motivo": f"exceção não tratada: {str(e)[:600]}"}
        log(f"    → {r['status']}" + (f" ({r.get('motivo') or r.get('faltando') or ''})" if r['status'] != 'processada' else f" · {r.get('lancamentos_extrato',0)} lançamentos"))
        if r.get("status") == "processada":
            marcar_processada(r.get("empresa_id"), r.get("competencia_movimento") or args.competencia)
        resultados.append(r)
        if args.pausa and i < len(tarefas):
            log(f"    (pausa {args.pausa:g}s antes da próxima)")
            time.sleep(args.pausa)

    # Resumo + log por execução
    contagem = {}
    for r in resultados:
        contagem[r["status"]] = contagem.get(r["status"], 0) + 1
    resumo = {
        "competencia": args.competencia,
        "gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "total_tarefas": len(tarefas),
        "contagem": contagem,
        "tarefas": resultados,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    arq = OUT_DIR / f"run-{args.competencia}-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    arq.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"\n=== RESUMO === {json.dumps(contagem, ensure_ascii=False)}")
    log(f"Log: {arq}")
    # stdout final em JSON (n8n faz parse)
    print(json.dumps({"ok": True, "competencia": args.competencia, "contagem": contagem, "log": str(arq)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

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

import os
import sys
import re
import json
import time
import base64
import argparse
import subprocess
import datetime as dt
from pathlib import Path

import requests

# Competência contábil YYYY-MM (competence_date do Gestta truncado).
_RE_COMPETENCIA = re.compile(r"^\d{4}-\d{2}$")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "ai"))
sys.path.insert(0, str(ROOT / "src" / "sci"))

import bridge_front as bf                                  # noqa: E402  (obter_jwt, sb_get, processar_via_gestta, _node_eval, comp_to_gestta, vincular_consultor)
from motor_classificacao import avaliar_suficiencia_documentos  # noqa: E402
from gerar_planilha_supabase import buscar_conta_banco       # noqa: E402
from gestta import api_docs                                 # noqa: E402  (detalhe_tarefa/suficiencia/baixar_documentos — caminho --via-api, sem browser)

OUT_DIR = ROOT / "outputs" / "orquestracao"
LEDGER = OUT_DIR / "processadas.json"  # idempotência local (cobre 'processada' sem doc no front)
TAREFAS_VISTAS = OUT_DIR / "tarefas-vistas.json"  # drain: taskId:comp já tentada (aguardando/sem empresa)
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


def _jwt_payload() -> dict:
    tok = _gestta_jwt().replace("JWT ", "").split(".")[1]
    tok += "=" * (-len(tok) % 4)
    return json.loads(base64.urlsafe_b64decode(tok))


def jwt_gestta_quase_expirado(margem_seg: int = 7200) -> bool:
    """True se o JWT expira em menos de margem_seg (default 2h)."""
    try:
        exp = _jwt_payload().get("exp")
        if not exp:
            return True
        return (exp - time.time()) < margem_seg
    except Exception:
        return True


def ping_gestta_api() -> bool:
    """Healthcheck leve: 1 POST na API de tarefas. False se 401/403 ou token ausente."""
    try:
        jwt = _gestta_jwt()
    except Exception:
        return False
    try:
        r = requests.post(
            GESTTA_SEARCH,
            headers={"Authorization": jwt, "Content-Type": "application/json"},
            json={"type": ["SERVICE_ORDER"], "limit": 1, "page": 1, "status": ["OPEN"]},
            timeout=30,
        )
        return r.status_code == 200
    except Exception:
        return False


def listar_cobrancas_api(competencia: str, statuses=None) -> list:
    """Lista tarefas COBRANÇA DE MOVIMENTO MENSAL via API direta (sem navegador).
    Filtra por Data Meta (DUE_DATE) no mês da competência. Paginação automática.
    statuses: lista de status Gestta (default ["OPEN"] — preserva o tick n8n vivo;
    backfill passa ["OPEN","DONE"])."""
    jwt = _gestta_jwt()
    statuses = statuses or ["OPEN"]
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    ny, nm = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    start = f"{ano:04d}-{mes:02d}-01T03:00:00.000Z"
    end = f"{ny:04d}-{nm:02d}-01T02:59:59.999Z"
    base = {
        "type": ["SERVICE_ORDER", "RECURRENT", "ACCOUNTING"],
        "company_task": [COBRANCA_TEMPLATE],
        "start_date": start, "end_date": end, "date_type": "DUE_DATE",
        "overdue": False, "downloaded": False, "not_downloaded": False, "fine": False,
        "on_time": False, "collaborator": False, "no_owner": False, "email_not_sent": False,
        "document_request_sent": True, "without_external_user": False, "os_free": False,
        "os_workflow": True, "limit": 100,
    }
    headers = {"Authorization": jwt, "Content-Type": "application/json"}
    # A API do Gestta NÃO faz união quando 'status' traz vários valores (retorna só
    # OPEN, ignorando DONE — verificado 2026-07-02). Consultamos UM status por vez
    # e mesclamos com dedup por taskId.
    vistos, out = set(), []
    for status in statuses:
        page = 1
        while True:
            body = {**base, "status": [status], "page": page}
            r = requests.post(GESTTA_SEARCH, headers=headers, json=body, timeout=60)
            if not r.ok:
                raise RuntimeError(f"Gestta search HTTP {r.status_code}: {r.text[:200]}")
            docs = r.json().get("docs", [])
            for d in docs:
                tid = d.get("_id")
                if tid in vistos:
                    continue
                vistos.add(tid)
                cust = d.get("customer") or {}
                out.append({
                    "taskId": tid,
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


def outro_orquestrar_rodando() -> bool:
    """True se JÁ existe OUTRO orquestrar.py rodando (exclui o próprio PID).
    Fecha a brecha de concorrência quando um run manual coincide com o tick do
    n8n — o guard 409 do server.js só serializa disparos via HTTP, não protege
    contra um run manual em paralelo (2 browsers no droplet de 2GB = risco de OOM)."""
    try:
        r = subprocess.run(["pgrep", "-af", "orquestrar.py"], capture_output=True, text=True, timeout=10)
    except Exception:
        return False  # sem pgrep (ex.: Windows) → não bloqueia
    meu = os.getpid()
    for linha in r.stdout.splitlines():
        linha = linha.strip()
        if not linha or "drain_backlog" in linha:
            continue
        # Ignora shells de monitoramento (pgrep -f 'orquestrar.py' no comando bash).
        if "python" not in linha and "Python" not in linha:
            continue
        if "src/orquestrar.py" not in linha:
            continue
        try:
            pid = int(linha.split(None, 1)[0])
        except ValueError:
            continue
        if pid != meu:
            return True
    return False


# ── Gestta (somente leitura) via subprocess Node ─────────────────────────────
def gestta(fn: str, *args) -> object:
    args_js = ",".join(json.dumps(a) for a in args)
    js = (f"const g=require('./src/gestta/index.js');"
          f"g.{fn}({args_js})"
          ".then(r=>console.log(JSON.stringify(r)))"
          ".catch(e=>{console.error(e.message);process.exit(1)});")
    return json.loads(bf._node_eval(js))


# ── Sessão do Gestta: healthcheck + relogin headless ─────────────────────────
def relogin_gestta(tentativas: int = 3) -> bool:
    """Relogin headless via autoLogin.js (usa GESTTA_EMAIL/PASSWORD do .env,
    regrava sessions/gestta-session.json). True se recriou a sessão e a API responde."""
    for i in range(1, tentativas + 1):
        log(f"    ↻ relogin Gestta (autoLogin headless) tentativa {i}/{tentativas}...")
        try:
            p = subprocess.run(["node", "src/gestta/autoLogin.js"],
                               cwd=str(ROOT), capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            log("    ✗ relogin: timeout (180s)")
            if i < tentativas:
                time.sleep(10 * i)
            continue
        if p.returncode == 0 and ping_gestta_api():
            log("    ✓ sessão Gestta renovada e API OK")
            return True
        det = (p.stderr or p.stdout or "").strip()[:200]
        log(f"    ✗ relogin falhou (rc={p.returncode}, api_ok={ping_gestta_api()}): {det}")
        if i < tentativas:
            time.sleep(10 * i)
    return False


def garantir_sessao_gestta_api() -> bool:
    """Modo --via-api: refresh preventivo se JWT expira em breve ou API falhar."""
    try:
        _gestta_jwt()
    except Exception:
        log("  token Gestta ausente — relogando...")
        return relogin_gestta()
    if jwt_gestta_quase_expirado():
        log("  JWT Gestta expira em <2h — relogin preventivo...")
        return relogin_gestta()
    if not ping_gestta_api():
        log("  API Gestta inválida (401/expirado) — relogando...")
        return relogin_gestta()
    log("  Sessão Gestta API válida ✓")
    return True


def garantir_sessao_gestta() -> bool:
    """Healthcheck proativo: se a sessão do Gestta estiver inválida, reloga uma
    vez. Evita que o lote inteiro queime quando a sessão expirou antes do run."""
    try:
        r = gestta("checarSessao")
    except Exception as e:
        log(f"  checarSessao falhou ({str(e)[:120]}) — tentando relogin")
        r = {"valida": False}
    if r.get("valida"):
        log("  Sessão Gestta válida ✓")
        return True
    log("  Sessão Gestta inválida — relogando...")
    return relogin_gestta()


def processar_com_retry(t: dict, competencia: str, comp_g: str, jwt: str,
                        via_api: bool = False, jwt_gestta: str = None,
                        ignorar_suficiencia: bool = False) -> dict:
    """Processa a tarefa com até 1 retry. Se o erro for SESSAO_EXPIRADA, reloga
    (headless) antes de retentar; erros transientes de navegação também ganham
    1 nova tentativa. A idempotência (ledger + doc origem=gestta) evita duplicar
    trabalho já concluído.
    via_api: usa processar_tarefa_api (REST, sem browser); no relogin, relê o
    JWT do Gestta (jwt_gestta) antes de retentar."""
    def _uma_vez(jwt_g) -> dict:
        try:
            if via_api:
                return processar_tarefa_api(t, competencia, comp_g, jwt, jwt_g, ignorar_suficiencia)
            return processar_tarefa(t, competencia, comp_g, jwt)
        except Exception as e:
            return {"cliente": t.get("clienteNome") or t.get("clienteCodigo"),
                    "tarefa_id": t.get("taskId"), "status": "erro",
                    "motivo": f"exceção não tratada: {str(e)[:600]}"}

    r = _uma_vez(jwt_gestta)
    if r.get("status") != "erro":
        return r

    if "SESSAO_EXPIRADA" in str(r.get("motivo") or ""):
        if not relogin_gestta():
            r["tentativas"] = 1  # relogin falhou — não adianta retentar
            return r
        if via_api:
            try:
                jwt_gestta = _gestta_jwt()  # relê o token novo p/ o retry (modo API)
            except Exception:
                pass

    log("    ↻ retry da tarefa (1x)...")
    r2 = _uma_vez(jwt_gestta)
    r2["tentativas"] = 2
    return r2


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
    # Fonte de verdade: bancos_apelidos_lcr (+ fallback) via gerar_planilha_supabase.
    return buscar_conta_banco(empresa_id)


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


def _carregar_tarefas_vistas() -> dict:
    try:
        return json.loads(TAREFAS_VISTAS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def tarefa_vista(task_id: str, competencia: str) -> bool:
    if not task_id:
        return False
    return f"{task_id}:{competencia}" in _carregar_tarefas_vistas()


def marcar_tarefa_vista(task_id: str, competencia: str, status: str, motivo: str = ""):
    """Drain: evita reprocessar forever aguardando_docs / sem empresa no Supabase."""
    if not task_id:
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    vist = _carregar_tarefas_vistas()
    vist[f"{task_id}:{competencia}"] = {
        "status": status,
        "motivo": (motivo or "")[:300],
        "em": dt.datetime.now().isoformat(timespec="seconds"),
    }
    TAREFAS_VISTAS.write_text(json.dumps(vist, ensure_ascii=False, indent=0), encoding="utf-8")


def _marcar_vista_se_aplicavel(marcar_vistas: bool, task_id: str, competencia: str, status: str, motivo: str = ""):
    if not marcar_vistas:
        return
    if status == "aguardando_docs":
        marcar_tarefa_vista(task_id, competencia, status, motivo)
    elif status == "erro" and (motivo or "").startswith("empresa não encontrada"):
        marcar_tarefa_vista(task_id, competencia, status, motivo)


def selecionar_pendentes(tarefas: list, competencia: str, limite: int, pular_vistas: bool = False) -> list:
    """Varre a lista e devolve as próximas `limite` tarefas AINDA NÃO processadas,
    já com a empresa resolvida (anexada em t['_empresa']).

    Bug B: o n8n horário fatia `tarefas[:limite]` sempre do topo da lista; como as
    já-processadas ficam no início e nunca somem, o lote ficava preso nas mesmas 5.
    Pré-filtrar por idempotência aqui garante que cada tick avance em quem falta.
    Tarefas cuja empresa não resolve seguem como pendentes (viram 'erro' visível no loop)."""
    pend = []
    for t in tarefas:
        if pular_vistas and tarefa_vista(t.get("taskId"), competencia):
            continue
        nome = t.get("clienteNome") or ""
        codigo = t.get("clienteCodigo") or ""
        try:
            empresa = resolver_empresa(codigo, nome)
        except Exception:
            empresa = None
        if empresa is not None:
            if ja_processada(empresa["id"], competencia):
                continue  # já feita → não consome slot do lote
        t["_empresa"] = empresa
        pend.append(t)
        if len(pend) >= limite:
            break
    return pend


# ── Processa uma tarefa (Etapas 1–4, sem escrever no Gestta) ──────────────────
def competencia_front_da_tarefa(t: dict, competencia_cli: str) -> str:
    """OPT-0004 (Bruno 22/07/2026): grava no Supabase a competência do MOVIMENTO
    (Gestta `competence_date`), não o mês da DUE_DATE usado só para listar a
    cobrança. Sem competence válida, cai no CLI (`--competencia`).

    Ex.: cobrança com due date em 01/2026 e competence_date=2025-12 → docs em 2025-12.
    """
    raw = (t.get("competence") or "").strip()
    if _RE_COMPETENCIA.match(raw):
        return raw
    return competencia_cli


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
    # competence_date = mês do movimento; CLI = mês da due date (lista).
    competencia_front = competencia_front_da_tarefa(t, competencia)
    base["empresa_id"] = empresa_id
    base["competencia_movimento"] = competencia_front
    base["competencia_front"] = competencia_front

    if ja_processada(empresa_id, competencia):
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

    # Suficiência OK, mas nada baixável (todos os documentos "desconsiderado" / 0
    # arquivos). Não há o que baixar → status terminal BENIGNO (não é erro e vai
    # pro ledger p/ NÃO reprocessar). Sem isso, o tick horário reprocessa esse
    # cliente e falha "Nenhum documento baixado" pra sempre (poluindo o /monitor).
    docs_sf = suf.get("documentos") or []
    tem_baixavel = any((d.get("status") == "enviado") or (d.get("numArquivos") or 0) > 0 for d in docs_sf)
    if docs_sf and not tem_baixavel:
        return {**base, "status": "sem_documentos",
                "motivo": "todos os documentos solicitados estão desconsiderados (nada a baixar)"}

    # Etapa 4 — baixa + classifica + envia ao front (sem concluir no Gestta).
    # competencia_front = mês do movimento (OPT-0004), não o mês da due date.
    banco = resolver_banco(empresa_id) or BANCO_PADRAO
    try:
        resumo = bf.processar_via_gestta(
            empresa_id, competencia, None, tarefa_id, banco, jwt,
            competencia_front=competencia_front,
        )
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


# ── Processa uma tarefa via API REST (sem browser) — Etapas 1–4 ───────────────
def _sinalizar_documento(empresa_id: str, competencia: str, arquivo_nome: str, aviso: str,
                         status_proc: str = None):
    """Grava um aviso EXPLÍCITO no documento (aparece na tela de Revisão do front,
    em classificacao_ia.observacoes). Usado p/ 'extrato sem movimento' etc. — para
    o contador não confundir 'veio vazio' com 'faltou processar'. Best-effort."""
    try:
        docs = bf.sb_get("documentos", {"select": "id,classificacao_ia",
                                        "empresa_id": f"eq.{empresa_id}",
                                        "competencia": f"eq.{competencia}",
                                        "arquivo_nome": f"eq.{arquivo_nome}", "limit": "1"})
        if not docs:
            return
        ci = docs[0].get("classificacao_ia")
        ci = ci if isinstance(ci, dict) else {}
        obs = (ci.get("observacoes") or "").strip()
        ci["observacoes"] = (obs + " | " if obs else "") + aviso
        patch = {"classificacao_ia": ci}
        if status_proc:
            patch["status_processamento"] = status_proc
        bf.sb_update("documentos", {"id": docs[0]["id"]}, patch)
    except Exception as e:
        log(f"    (aviso não gravado no doc {arquivo_nome}: {str(e)[:80]})")


def processar_tarefa_api(t: dict, competencia: str, comp_g: str, jwt: str, jwt_gestta: str,
                         ignorar_suficiencia: bool = False) -> dict:
    """Igual a processar_tarefa, mas troca os 2 passos de browser por REST:
    suficiência via api_docs.detalhe_tarefa/suficiencia e download via
    api_docs.baixar_documentos, chamando o MESMO núcleo bf.processar_arquivos.
    jwt = JWT do Supabase (front/edge); jwt_gestta = JWT do Gestta (api.gestta)."""
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
    competencia_front = competencia_front_da_tarefa(t, competencia)
    base["empresa_id"] = empresa_id
    base["competencia_movimento"] = competencia_front
    base["competencia_front"] = competencia_front

    if ja_processada(empresa_id, competencia):
        return {**base, "status": "pulada_idempotencia"}

    # Etapa 2 — suficiência via API REST (1 GET traz docs + customer p/ o download)
    try:
        detalhe = api_docs.detalhe_tarefa(tarefa_id, jwt_gestta)
        suf = api_docs.suficiencia(detalhe)
    except Exception as e:
        return {**base, "status": "erro", "motivo": f"suficiência(api): {str(e)[:600]}"}
    # Backfill de mês fechado (--ignorar-suficiencia): não faz sentido aguardar doc
    # que não virá — processa o que existe. Pula o gate de suficiência (e a chamada
    # de IA). Sem a flag, mantém o gate do fluxo vivo (aguardando_docs).
    if not ignorar_suficiencia:
        try:
            ia = avaliar_suficiencia_documentos(suf.get("observacao", ""), suf.get("documentos", []), comp_g)
        except Exception:
            ia = {"suficiente": suf.get("suficiente", False), "faltando": suf.get("pendentes", [])}
        suficiente = bool(suf.get("suficiente")) and bool(ia.get("suficiente", True))
        if not suficiente:
            return {**base, "status": "aguardando_docs",
                    "faltando": ia.get("faltando") or suf.get("pendentes") or []}

    docs_sf = suf.get("documentos") or []
    tem_baixavel = any((d.get("status") == "enviado") or (d.get("numArquivos") or 0) > 0 for d in docs_sf)
    if docs_sf and not tem_baixavel:
        return {**base, "status": "sem_documentos",
                "motivo": "todos os documentos solicitados estão desconsiderados (nada a baixar)"}

    # Etapa 4 — download via API + núcleo reusado (bf.processar_arquivos, sem browser).
    # Grava sob competencia_front (mês do movimento — OPT-0004).
    banco = resolver_banco(empresa_id) or BANCO_PADRAO
    destino = str(ROOT / "outputs" / "gestta" / f"{empresa_id}_{competencia_front}")
    try:
        dl = api_docs.baixar_documentos(detalhe, destino, jwt_gestta)
        arquivos, vazios_dl, falhas_dl = dl["salvos"], dl.get("vazios", []), dl["falhas"]
    except Exception as e:
        return {**base, "status": "erro", "motivo": f"download(api): {str(e)[:600]}"}
    # Extratos VAZIOS (sem movimento) também entram no processamento (0 lanç) e são
    # sinalizados depois — não travam a tarefa (decisão: processa + sinaliza).
    processaveis = arquivos + [v["caminho"] for v in vazios_dl]
    if not processaveis:
        # Nada processável. Se houve falha real (corrompido/download), é erro; senão sem docs.
        if falhas_dl:
            f0 = falhas_dl[0]
            motivo = (f"download(api): {len(falhas_dl)} arquivo(s) com problema "
                      f"(ex.: {f0.get('tipo','?')} — {f0.get('motivo','')[:80]})")
            return {**base, "status": "erro", "motivo": motivo, "falhas_download": falhas_dl}
        return {**base, "status": "sem_documentos", "motivo": "API: 0 arquivos baixáveis"}

    try:
        # Backfill: extrato que o parser local não ler cai p/ a edge (IA lê layouts diversos).
        resumo = bf.processar_arquivos(
            empresa_id, competencia_front, processaveis, banco, jwt, extrato_fallback_edge=True,
        )
    except Exception as e:
        return {**base, "status": "erro", "motivo": f"etapa4(api): {str(e)[:600]}"}

    # Sinaliza os extratos vazios: aviso EXPLÍCITO no documento (tela de Revisão) —
    # "sem movimento no período" — para não parecer que faltou processar.
    for v in vazios_dl:
        _sinalizar_documento(empresa_id, competencia_front, v["arquivo"], f"AVISO: {v['motivo']}")
        log(f"    sinalizado extrato vazio: {v['arquivo']} — {v['motivo']}")

    if resp:
        try:
            bf.vincular_consultor(empresa_id, resp)
        except Exception:
            pass

    extratos = resumo.get("extratos", [])
    lanc = sum(e.get("lancamentos", 0) for e in extratos)
    resultado = {**base, "banco": banco, "consultor": resp,
                 "lancamentos_extrato": lanc, "outros_docs": len(resumo.get("outros", []))}
    # Extratos vazios (sem movimento): tarefa segue 'processada', mas registra o
    # aviso no resultado (visível no monitor) além do doc (tela de Revisão).
    if vazios_dl:
        resultado["extratos_vazios"] = [{"arquivo": v["arquivo"], "motivo": v["motivo"]} for v in vazios_dl]
    # Falha real (corrompido/download) → tarefa INCOMPLETA (não vira 'processada' no
    # ledger; os OK ficam salvos, o restante é sinalizado p/ reprocesso/revisão).
    if falhas_dl:
        resultado["status"] = "incompleta"
        resultado["falhas_download"] = falhas_dl
    else:
        resultado["status"] = "processada"
    return resultado


def main():
    ap = argparse.ArgumentParser(description="Orquestra PROC-001 Etapas 1–4 em todas as tarefas COBRANÇA")
    ap.add_argument("--competencia", required=True, help="YYYY-MM")
    ap.add_argument("--limite", type=int, default=None, help="máximo de tarefas por execução")
    ap.add_argument("--cliente", default=None, help="processa só um cliente (código/nome contém)")
    ap.add_argument("--pausa", type=float, default=0,
                    help="segundos de pausa entre tarefas (espalha a carga; ex.: 90 p/ rodar devagar à noite)")
    ap.add_argument("--via-api", action="store_true",
                    help="baixa docs/suficiência pela API REST do Gestta (sem Playwright) — backfill")
    ap.add_argument("--status", default="OPEN",
                    help="status Gestta separados por vírgula (default OPEN; backfill: OPEN,DONE)")
    ap.add_argument("--ignorar-suficiencia", action="store_true",
                    help="backfill de mês fechado: processa qualquer tarefa com arquivo baixável, "
                         "sem exigir suficiência (pula o gate aguardando_docs). Só com --via-api.")
    ap.add_argument("--marcar-vistas", action="store_true",
                    help="drain/backfill: marca aguardando_docs e sem_empresa como vistas p/ avançar fila")
    args = ap.parse_args()

    # Self-guard: não roda 2 orquestradores ao mesmo tempo (n8n + run manual).
    if outro_orquestrar_rodando():
        msg = "outro orquestrar.py já em execução — pulando p/ não concorrer"
        log(f"  ⚠️ {msg}")
        print(json.dumps({"ok": True, "skipped": msg}, ensure_ascii=False))
        return

    comp_g = bf.comp_to_gestta(args.competencia)
    statuses = [s.strip().upper() for s in (args.status or "").split(",") if s.strip()] or ["OPEN"]
    modo = "API REST (sem navegador)" if args.via_api else "browser"
    log(f"=== Orquestração PROC-001 · competência {args.competencia} ({comp_g}) · modo {modo} · status {statuses} ===")
    log("  (somente leitura no Gestta — não conclui tarefas)")

    jwt = bf.obter_jwt()
    log("  JWT do usuário de serviço obtido ✓")

    # Modo browser: healthcheck proativo da sessão (reloga headless se expirada).
    # Modo API: pula o browser; usa o JWT do arquivo de sessão e reloga só se a
    # listagem retornar 401/403 (raio ≤1 run; o drain relê o token a cada lote).
    jwt_gestta = None
    if args.via_api:
        if not garantir_sessao_gestta_api():
            log("  ✗ não foi possível garantir sessão Gestta — abortando lote")
            sys.exit(2)
        jwt_gestta = _gestta_jwt()
    else:
        garantir_sessao_gestta()

    log(f"\n[E1] Listando tarefas COBRANÇA via API ({args.competencia}, status={statuses})...")
    try:
        tarefas = listar_cobrancas_api(args.competencia, statuses)
    except RuntimeError as e:
        if args.via_api and ("401" in str(e) or "403" in str(e)):
            log("  sessão Gestta expirada na listagem — relogando (headless) e repetindo...")
            if not relogin_gestta():
                raise
            jwt_gestta = _gestta_jwt()
            tarefas = listar_cobrancas_api(args.competencia, statuses)
        else:
            raise
    log(f"    {len(tarefas)} tarefa(s) COBRANÇA encontradas (resolver direto, sem navegador)")

    if args.cliente:
        c = args.cliente.lower()
        tarefas = [t for t in tarefas
                   if c in (t.get("clienteCodigo") or "").lower() or c in (t.get("clienteNome") or "").lower()]
        log(f"    filtro --cliente '{args.cliente}': {len(tarefas)} tarefa(s)")
    if args.limite:
        tarefas = selecionar_pendentes(tarefas, args.competencia, args.limite, args.marcar_vistas)
        log(f"    --limite {args.limite}: {len(tarefas)} pendente(s) selecionada(s) (já-processadas puladas antes do corte)")

    resultados = []
    for i, t in enumerate(tarefas, 1):
        log(f"\n── [{i}/{len(tarefas)}] {t.get('clienteCodigo')} - {t.get('clienteNome')} ──")
        # Blindagem (Bug A) + retry por tarefa (relogin em SESSAO_EXPIRADA):
        # nunca derruba o run inteiro; tenta 1x novamente antes de desistir.
        r = processar_com_retry(t, args.competencia, comp_g, jwt, via_api=args.via_api,
                                jwt_gestta=jwt_gestta, ignorar_suficiencia=args.ignorar_suficiencia)
        if r['status'] == 'processada':
            extra = f" · {r.get('lancamentos_extrato', 0)} lançamentos"
        elif r['status'] == 'incompleta':
            extra = (f" · {r.get('lancamentos_extrato', 0)} lançamentos, "
                     f"{len(r.get('falhas_download', []))} arquivo(s) falharam no download")
        else:
            extra = f" ({r.get('motivo') or r.get('faltando') or ''})"
        log(f"    → {r['status']}{extra}")
        if r.get("status") in ("processada", "sem_documentos"):
            marcar_processada(r.get("empresa_id"), args.competencia)
        _marcar_vista_se_aplicavel(args.marcar_vistas, t.get("taskId"), args.competencia,
                                   r.get("status", ""), r.get("motivo") or "")
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
    print(json.dumps({"ok": True, "competencia": args.competencia, "contagem": contagem,
                      "total_tarefas": len(tarefas), "log": str(arq)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

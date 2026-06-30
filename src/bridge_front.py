"""
src/bridge_front.py

Conecta a automação ao front (Supabase do projeto nexus-lcr-core), refletindo o
PROC-001 da Entrada até a Etapa 4 para um cliente:

  extrato (PDF/Excel) → parser → motor IA (classificação) →
  documentos + lancamentos no Supabase → conciliação (edge function) →
  status da empresa atualizado.

A planilha SCI (Etapa 4) o próprio front gera sob demanda (RPC sci_planilha)
assim que existem lançamentos.

Execute a partir da RAIZ do repo (os módulos de config usam caminhos relativos):
  python src/bridge_front.py --empresa-id <uuid> --competencia 2026-06 \
      --extrato outputs/CAPI_06-2026/Extrato_3130_971538_03-06-2026.pdf --banco 657

Requer no .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_KEY (anon),
SUPABASE_SVC_EMAIL, SUPABASE_SVC_PASSWORD, ANTHROPIC_API_KEY.
"""

import os
import sys
import csv
import json
import time
import argparse
import subprocess
import datetime as dt
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "lcr-flow" / ".env")
load_dotenv(ROOT / ".env")

# Importa os módulos da automação já existentes (rodando a partir da raiz do repo)
sys.path.insert(0, str(ROOT / "src" / "parsers"))
sys.path.insert(0, str(ROOT / "src" / "ai"))
from extrato_bancario import parsear_extrato            # noqa: E402
from motor_classificacao import classificar_extrato      # noqa: E402

# ── Config Supabase ───────────────────────────────────────────────────────────
URL = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
SR  = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
ANON = (os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY") or "")
SVC_EMAIL = os.getenv("SUPABASE_SVC_EMAIL") or ""
SVC_PWD   = os.getenv("SUPABASE_SVC_PASSWORD") or ""

BUCKET_DOCS = "documentos-clientes"
BUCKET_CONC = "conciliacoes"

SR_HEADERS = {"apikey": SR, "Authorization": f"Bearer {SR}"}


def log(msg):
    print(msg, flush=True)


# ── Auth: JWT do usuário de serviço (p/ edge functions) ──────────────────────
def obter_jwt() -> str:
    r = requests.post(
        f"{URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON, "Content-Type": "application/json"},
        json={"email": SVC_EMAIL, "password": SVC_PWD},
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Login do usuário de serviço falhou: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


# ── REST helpers (service role = bypass RLS) ─────────────────────────────────
def sb_insert(tabela: str, registro, retornar=True):
    headers = {**SR_HEADERS, "Content-Type": "application/json",
               "Prefer": "return=representation" if retornar else "return=minimal"}
    r = requests.post(f"{URL}/rest/v1/{tabela}", headers=headers, json=registro, timeout=60)
    if not r.ok:
        raise RuntimeError(f"INSERT {tabela} falhou: {r.status_code} {r.text[:300]}")
    return r.json() if retornar and r.text else None


def sb_update(tabela: str, match: dict, patch: dict):
    params = {k: f"eq.{v}" for k, v in match.items()}
    headers = {**SR_HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}
    r = requests.patch(f"{URL}/rest/v1/{tabela}", headers=headers, params=params, json=patch, timeout=30)
    if not r.ok:
        raise RuntimeError(f"UPDATE {tabela} falhou: {r.status_code} {r.text[:300]}")


def sb_get(tabela: str, params: dict):
    r = requests.get(f"{URL}/rest/v1/{tabela}", headers=SR_HEADERS, params=params, timeout=30)
    if not r.ok:
        raise RuntimeError(f"GET {tabela} falhou: {r.status_code} {r.text[:300]}")
    return r.json()


def sb_upload(bucket: str, path: str, conteudo: bytes, content_type: str):
    r = requests.post(
        f"{URL}/storage/v1/object/{bucket}/{path}",
        headers={**SR_HEADERS, "Content-Type": content_type, "x-upsert": "true"},
        data=conteudo, timeout=120,
    )
    if not r.ok:
        raise RuntimeError(f"UPLOAD {bucket}/{path} falhou: {r.status_code} {r.text[:300]}")
    return path


def carregar_mapa_codigos(tabela: str) -> dict:
    """codigo(str) -> id(uuid), paginado (plano_contas tem 1187)."""
    mapa, off = {}, 0
    while True:
        r = requests.get(
            f"{URL}/rest/v1/{tabela}",
            headers={**SR_HEADERS, "Range-Unit": "items", "Range": f"{off}-{off+999}"},
            params={"select": "id,codigo"}, timeout=30,
        )
        if not r.ok:
            raise RuntimeError(f"GET {tabela} falhou: {r.status_code} {r.text[:200]}")
        batch = r.json()
        for c in batch:
            mapa[str(c["codigo"]).strip()] = c["id"]
        if len(batch) < 1000:
            break
        off += 1000
    return mapa


# ── Edge functions ───────────────────────────────────────────────────────────
def chamar_edge(func: str, body: dict, jwt: str) -> dict:
    r = requests.post(
        f"{URL}/functions/v1/{func}",
        headers={"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json=body, timeout=180,
    )
    try:
        data = r.json()
    except Exception:
        data = {"raw": r.text[:300]}
    if not r.ok:
        raise RuntimeError(f"edge {func} HTTP {r.status_code}: {r.text[:300]}")
    return data


# ── Domínio ──────────────────────────────────────────────────────────────────
def ensure_competencia(empresa_id: str, competencia: str) -> str:
    periodo = f"{competencia}-01"
    achados = sb_get("competencias", {
        "empresa_id": f"eq.{empresa_id}", "periodo": f"eq.{periodo}", "select": "id",
    })
    if achados:
        return achados[0]["id"]
    novo = sb_insert("competencias", {"empresa_id": empresa_id, "periodo": periodo, "status": "aberta"})
    return novo[0]["id"]


def _iso_data(yyyymmdd: str):
    s = str(yyyymmdd or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s or None


def linha_para_lancamento(linha: dict, banco_cod: int, conta_map: dict, hist_map: dict,
                          empresa_id: str, competencia: str, competencia_id: str, documento_id: str):
    """Converte a saída do motor (códigos LCR débito/crédito) no modelo do front
    (1 conta_id = contrapartida não-banco + valor)."""
    deb, cred = linha.get("debito"), linha.get("credito")
    # contrapartida = lado que NÃO é o banco
    if str(deb) == str(banco_cod):
        conta_cod = cred
    elif str(cred) == str(banco_cod):
        conta_cod = deb
    else:
        conta_cod = deb  # fallback (transação sem banco identificado)
    conta_id = conta_map.get(str(conta_cod))
    hist_id = hist_map.get(str(linha.get("historico"))) if linha.get("historico") not in (None, "", "None") else None
    return {
        "empresa_id": empresa_id,
        "competencia": competencia,
        "competencia_id": competencia_id,
        "documento_id": documento_id,
        "conta_id": conta_id,
        "historico_id": hist_id,
        "data_lancamento": _iso_data(linha.get("data")),
        "valor": float(linha.get("valor") or 0),
        "descricao": (linha.get("complemento") or "")[:200],
        "status": "gerada",
        "confidence": float(linha.get("confianca")) if linha.get("confianca") is not None else None,
        "conciliado": False,
    }, conta_id


def _conta_contrapartida(linha: dict, banco_cod: int):
    deb, cred = linha.get("debito"), linha.get("credito")
    if str(deb) == str(banco_cod):
        return cred
    if str(cred) == str(banco_cod):
        return deb
    return deb


def sugestoes_motor(linhas: list, banco_cod: int) -> list:
    """Converte a saída do motor em lancamentos_sugeridos no formato que a tela de
    Revisão do front consome (conta_codigo, descricao, valor, confidence)."""
    out = []
    for l in linhas:
        conta_cod = _conta_contrapartida(l, banco_cod)
        out.append({
            "data_lancamento": _iso_data(l.get("data")),
            "valor": float(l.get("valor") or 0),
            "tipo_movimento": "debito" if str(conta_cod) == str(l.get("debito")) else "credito",
            "conta_codigo": str(conta_cod) if conta_cod is not None else None,
            "historico_codigo": (str(l.get("historico")) if l.get("historico") not in (None, "", "None") else None),
            "descricao": (l.get("complemento") or "")[:200],
            "confidence": (float(l.get("confianca")) if l.get("confianca") is not None else None),
            "justificativa": l.get("justificativa"),
        })
    return out


def montar_csv_extrato(transacoes: list) -> bytes:
    buf = ["data;descricao;valor;tipo"]
    for t in transacoes:
        data = str(t.get("data") or "")
        desc = str(t.get("descricao") or "").replace(";", ",")
        valor = f"{abs(float(t.get('valor') or 0)):.2f}".replace(".", ",")
        tipo = t.get("tipo") or ""
        buf.append(f"{data};{desc};{valor};{tipo}")
    return ("\n".join(buf)).encode("utf-8")


# ── Pipeline principal ───────────────────────────────────────────────────────
def processar_extrato(empresa_id, competencia, extrato_path, banco_cod, jwt, origem="gestta", finalizar_conciliacao=False):
    extrato_path = Path(extrato_path)
    if not extrato_path.exists():
        raise FileNotFoundError(extrato_path)

    comp_motor = f"{competencia[5:7]}/{competencia[0:4]}"  # 2026-06 -> 06/2026

    log(f"\n[1] Parseando extrato: {extrato_path.name}")
    transacoes = parsear_extrato(str(extrato_path), banco="itau")
    log(f"    {len(transacoes)} transações extraídas")
    if not transacoes:
        raise RuntimeError("Nenhuma transação extraída do extrato.")

    log(f"\n[2] Classificando com o motor IA (banco {banco_cod}, {comp_motor})...")
    resultado = classificar_extrato(transacoes, conta_banco=banco_cod, competencia=comp_motor)
    aprovadas = resultado["aprovadas"]
    revisao = [r["classificacao_sugerida"] for r in resultado["revisao_manual"]]
    log(f"    aprovadas={len(aprovadas)} revisão={len(revisao)} erros={resultado['resumo']['erros']}")

    log("\n[3] Garantindo competência...")
    competencia_id = ensure_competencia(empresa_id, competencia)

    log("\n[4] Upload do extrato + registro em documentos...")
    storage_path = f"{empresa_id}/{competencia}/{extrato_path.name}"
    sb_upload(BUCKET_DOCS, storage_path, extrato_path.read_bytes(), "application/pdf")
    doc = sb_insert("documentos", {
        "empresa_id": empresa_id, "tipo": "extrato", "competencia": competencia,
        "competencia_id": competencia_id, "origem": origem, "status": "recebido",
        "status_processamento": "pendente", "arquivo_nome": extrato_path.name,
        "storage_path": storage_path, "arquivo_url": storage_path,
    })
    documento_id = doc[0]["id"]
    log(f"    documento_id={documento_id}")

    log("\n[5] Mapeando códigos → conta_id/historico_id e inserindo lançamentos...")
    conta_map = carregar_mapa_codigos("plano_contas")
    hist_map = carregar_mapa_codigos("historicos_contabeis")

    lancamentos, sem_conta = [], 0
    for linha in aprovadas + revisao:
        reg, conta_id = linha_para_lancamento(linha, banco_cod, conta_map, hist_map,
                                              empresa_id, competencia, competencia_id, documento_id)
        if conta_id is None:
            sem_conta += 1
        lancamentos.append(reg)
    if lancamentos:
        sb_insert("lancamentos", lancamentos, retornar=False)
    log(f"    {len(lancamentos)} lançamentos inseridos ({sem_conta} sem conta mapeada → revisão)")

    # classificacao_ia no formato que a tela de Revisão do front consome
    sugestoes = sugestoes_motor(aprovadas + revisao, banco_cod)
    confs = [s["confidence"] for s in sugestoes if s["confidence"] is not None]
    conf_geral = round(sum(confs) / len(confs), 2) if confs else None
    classificacao_ia = {
        "tipo_documento": "extrato_bancario",
        "competencia": competencia,
        "confidence_geral": conf_geral,
        "observacoes": (
            f"{len(aprovadas)} de {len(transacoes)} transações classificadas automaticamente "
            f"(confiança ≥ 80%); {len(revisao)} requerem aprovação humana (confiança < 80%). "
            "Revise as linhas destacadas e aprove para confirmar os lançamentos."
        ),
        "lancamentos_sugeridos": sugestoes,
        "dados_extraidos": {"total_transacoes": len(transacoes),
                            "aprovadas": len(aprovadas), "revisao": len(revisao),
                            "fonte": "motor_lcr (Mapa de Transações + De-para)"},
    }
    sb_update("documentos", {"id": documento_id}, {
        "status": "processado", "status_processamento": "classificado",
        "processado_em": dt.datetime.utcnow().isoformat() + "Z",
        "lancamentos_gerados": len(lancamentos),
        "classificacao_ia": classificacao_ia,
    })

    resultado = {"documento_id": documento_id, "lancamentos": len(lancamentos)}

    if finalizar_conciliacao:
        log("\n[6] Conciliação: upload do extrato CSV + edge function conciliar...")
        csv_bytes = montar_csv_extrato(transacoes)
        csv_path = f"{empresa_id}/{competencia}/extrato-{documento_id}.csv"
        sb_upload(BUCKET_CONC, csv_path, csv_bytes, "text/csv")
        conc = sb_insert("conciliacoes", {
            "empresa_id": empresa_id, "competencia": competencia, "competencia_id": competencia_id,
            "extrato_csv_url": csv_path, "status": "em_andamento",
        })
        conciliacao_id = conc[0]["id"]
        res_conc = chamar_edge("conciliar", {"conciliacao_id": conciliacao_id}, jwt)
        log(f"    conciliar → {json.dumps(res_conc, ensure_ascii=False)}")
        sb_update("empresas", {"id": empresa_id}, {"status": "conciliacao"})
        resultado.update({"conciliacao_id": conciliacao_id, "conciliacao": res_conc})
    else:
        # Automação: apenas envia os documentos extraídos + analisados.
        # A conciliação NÃO é finalizada (fica como passo humano no front).
        log("\n[6] Documentos analisados enviados; conciliação não finalizada (status → lancamento)")
        sb_update("empresas", {"id": empresa_id}, {"status": "lancamento"})

    return resultado


# ── Integração com o Gestta (download direto dos documentos) ─────────────────
def comp_to_gestta(competencia: str) -> str:
    """'2026-06' -> '06/2026' (formato esperado pelo módulo Gestta)."""
    ano, mes = competencia.split("-")
    return f"{mes}/{ano}"


def _node_eval(js: str) -> str:
    """Executa JS via `node -e` na raiz do repo e devolve a última linha (JSON)."""
    proc = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0:
        raise RuntimeError(f"Gestta/Node erro: {(proc.stderr or proc.stdout).strip()[:400]}")
    linhas = [l for l in proc.stdout.splitlines() if l.strip()]
    if not linhas:
        raise RuntimeError("Gestta/Node não retornou saída.")
    return linhas[-1]


def resolver_tarefa_gestta(termo: str, comp_gestta: str) -> dict | None:
    """Lista tarefas pendentes no Gestta e acha a do cliente (por código ou nome)."""
    js = ("const g=require('./src/gestta/index.js');"
          f"g.buscarTarefasPendentes('{comp_gestta}')"
          ".then(t=>console.log(JSON.stringify(t)))"
          ".catch(e=>{console.error(e.message);process.exit(1)});")
    tarefas = json.loads(_node_eval(js))
    t_l = termo.lower()
    for t in tarefas:
        if (t_l in (t.get("clienteCodigo") or "").lower()
                or t_l in (t.get("clienteNome") or "").lower()):
            return t
    return None


def baixar_documentos_gestta(tarefa_id: str, comp_gestta: str, destino: str) -> list:
    destino = destino.replace("\\", "/")
    Path(destino).mkdir(parents=True, exist_ok=True)
    js = ("const g=require('./src/gestta/index.js');"
          f"g.baixarDocumentosCliente('{tarefa_id}','{comp_gestta}','{destino}')"
          ".then(a=>console.log(JSON.stringify(a)))"
          ".catch(e=>{console.error(e.message);process.exit(1)});")
    return json.loads(_node_eval(js))


def detectar_tipo(nome: str) -> str:
    """Mapeia o nome do arquivo para o enum documentos.tipo."""
    n = nome.lower()
    if any(k in n for k in ["extrato", "cta", "conta corrente"]):
        return "extrato"
    if any(k in n for k in ["nfe", "nf-e", "nota fiscal", "nfse", "nfs-e"]):
        return "nf_entrada"
    if any(k in n for k in ["fatura", "cartao", "cartão"]):
        return "fatura_cartao"
    if any(k in n for k in ["darf", "das", "guia", "inss", "fgts", "gps"]):
        return "darf"
    if "recibo" in n:
        return "recibo"
    if n.endswith((".xlsx", ".xls", ".csv")) or "planilha" in n or "investimento" in n:
        return "planilha_financeira"
    return "outros"


MIME_POR_EXT = {
    ".pdf": "application/pdf",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
}


def mime_de(p: Path) -> str:
    return MIME_POR_EXT.get(p.suffix.lower(), "application/pdf")


def processar_documento_edge(empresa_id, competencia, competencia_id, file_path, tipo, jwt, origem="gestta"):
    """Documentos não-extrato: sobe no Storage, cria documentos e deixa a edge
    function processar-documento classificar e gerar lançamentos."""
    p = Path(file_path)
    # A edge function (Claude) não lê Excel binário (.xls/.xlsx). Converte p/ CSV
    # para permitir a análise; demais tipos sobem como estão.
    if p.suffix.lower() in (".xls", ".xlsx"):
        import pandas as pd
        df = None
        try:
            cabecalho = p.read_bytes()[:64].lstrip().lower()
            if cabecalho.startswith(b"<"):
                # "xls" que na verdade é HTML (export comum de sistemas BR)
                tabelas = pd.read_html(str(p))
                df = max(tabelas, key=len).astype(str)
            else:
                try:
                    df = pd.read_excel(str(p), sheet_name=0, dtype=str, engine="openpyxl")
                except Exception:
                    df = pd.read_excel(str(p), sheet_name=0, dtype=str, engine="xlrd")
        except Exception as e:
            log(f"    ⚠️ não consegui converter {p.name} p/ CSV ({e}); enviando original")
        if df is not None:
            conteudo = df.fillna("").to_csv(index=False, sep=";").encode("utf-8")
            arquivo_nome = p.stem + ".csv"
            ctype = "text/csv"
            log(f"    {p.name} convertido p/ CSV ({len(df)} linhas)")
        else:
            conteudo, arquivo_nome, ctype = p.read_bytes(), p.name, mime_de(p)
    else:
        conteudo, arquivo_nome, ctype = p.read_bytes(), p.name, mime_de(p)

    storage_path = f"{empresa_id}/{competencia}/{arquivo_nome}"
    sb_upload(BUCKET_DOCS, storage_path, conteudo, ctype)
    doc = sb_insert("documentos", {
        "empresa_id": empresa_id, "tipo": tipo, "competencia": competencia,
        "competencia_id": competencia_id, "origem": origem, "status": "recebido",
        "status_processamento": "pendente", "arquivo_nome": arquivo_nome,
        "storage_path": storage_path, "arquivo_url": storage_path,
    })
    documento_id = doc[0]["id"]
    res = chamar_edge("processar-documento", {"documento_id": documento_id}, jwt)
    # Retry em erros transientes da Anthropic:
    #  - 429/rate_limit: aguarda a janela de ~1 min (65s) e repete.
    #  - 529/overloaded: API momentaneamente sobrecarregada → backoff curto crescente (15/30/45s).
    tentativas = 0
    while (not res.get("ok")) and tentativas < 4:
        err = str(res.get("error", ""))
        is_rate = any(k in err for k in ("429", "rate_limit", "rate limit"))
        is_overload = any(k in err for k in ("529", "overloaded", "overload"))
        if not (is_rate or is_overload):
            break
        tentativas += 1
        espera = 65 if is_rate else 15 * tentativas
        motivo = "rate limit (429)" if is_rate else "sobrecarga (529)"
        log(f"    {motivo} Anthropic — aguardando {espera}s e repetindo ({tentativas}/4)...")
        time.sleep(espera)
        res = chamar_edge("processar-documento", {"documento_id": documento_id}, jwt)
    log(f"    {p.name} [{tipo}] → {json.dumps(res, ensure_ascii=False)[:160]}")
    return {"documento_id": documento_id, "tipo": tipo, "edge": res}


def buscar_consultor(nome_colaborador: str) -> str | None:
    """Mapeia o responsável da tarefa Gestta ('Cleyton - Contábil') para
    usuarios_perfil.id no nosso sistema, por nome."""
    if not nome_colaborador:
        return None
    nome = nome_colaborador.split(" - ")[0].strip()
    if not nome:
        return None
    achados = sb_get("usuarios_perfil", {"select": "id,nome", "nome": f"ilike.*{nome}*", "limit": "1"})
    return achados[0]["id"] if achados else None


def vincular_consultor(empresa_id: str, nome_colaborador: str):
    cid = buscar_consultor(nome_colaborador)
    if cid:
        sb_update("empresas", {"id": empresa_id}, {"consultor_id": cid})
        log(f"    consultor vinculado: '{nome_colaborador}' → {cid}")
    else:
        log(f"    consultor não encontrado p/ '{nome_colaborador}' — consultor_id inalterado")
    return cid


def processar_arquivos(empresa_id, competencia, arquivos, banco_cod, jwt):
    """Roteia uma lista de arquivos: extrato → motor IA; demais → edge function.
    Reutilizado pelo modo Gestta e pelo modo --docs (arquivos locais)."""
    extratos = [a for a in arquivos if detectar_tipo(Path(a).name) == "extrato"]
    outros = [a for a in arquivos if a not in extratos]
    resumo = {"arquivos": len(arquivos), "extratos": [], "outros": []}

    # Resiliência: um documento com formato/erro não derruba a tarefa — é sinalizado.
    for ext in extratos:
        log(f"\n[doc] Processando extrato: {Path(ext).name}")
        try:
            resumo["extratos"].append(processar_extrato(empresa_id, competencia, ext, banco_cod, jwt))
        except Exception as e:
            log(f"    ⚠️ extrato não processado ({Path(ext).name}): {str(e)[:120]}")
            resumo["extratos"].append({"arquivo": Path(ext).name, "erro": str(e)[:200], "status": "revisao_humana"})

    if outros:
        competencia_id = ensure_competencia(empresa_id, competencia)
        log(f"\n[doc] Processando {len(outros)} documento(s) não-extrato via edge function...")
        for doc in outros:
            tipo = detectar_tipo(Path(doc).name)
            try:
                resumo["outros"].append(processar_documento_edge(empresa_id, competencia, competencia_id, doc, tipo, jwt))
            except Exception as e:
                log(f"    ⚠️ documento não processado ({Path(doc).name}): {str(e)[:120]}")
                resumo["outros"].append({"arquivo": Path(doc).name, "tipo": tipo, "erro": str(e)[:200], "status": "revisao_humana"})

    if not extratos:  # ainda assim reflete a fase no painel
        sb_update("empresas", {"id": empresa_id}, {"status": "lancamento"})

    return resumo


def processar_via_gestta(empresa_id, competencia, termo_cliente, tarefa_id, banco_cod, jwt, competencia_front=None):
    # competencia = mês de VENCIMENTO (navegação no Gestta); competencia_front = mês do
    # MOVIMENTO (onde os lançamentos entram no front). Default: iguais.
    competencia_front = competencia_front or competencia
    comp_g = comp_to_gestta(competencia)
    responsavel = None

    if not tarefa_id:
        log(f"\n[G1] Resolvendo tarefa do cliente '{termo_cliente}' no Gestta ({comp_g})...")
        tarefa = resolver_tarefa_gestta(termo_cliente, comp_g)
        if not tarefa:
            raise RuntimeError(f"Nenhuma tarefa pendente encontrada para '{termo_cliente}' em {comp_g}.")
        tarefa_id = tarefa["taskId"]
        responsavel = tarefa.get("responsavel")
        log(f"    tarefa: {tarefa.get('clienteCodigo')} - {tarefa.get('clienteNome')} "
            f"(taskId={tarefa_id}, responsável='{responsavel or '?'}')")

    # Conecta o colaborador responsável da tarefa ao consultor no nosso sistema
    if responsavel:
        log("\n[G1b] Vinculando consultor responsável...")
        vincular_consultor(empresa_id, responsavel)

    destino = f"outputs/gestta/{empresa_id}_{competencia_front}"
    log(f"\n[G2] Baixando documentos do Gestta (task {tarefa_id})...")
    arquivos = baixar_documentos_gestta(tarefa_id, comp_g, destino)
    log(f"    {len(arquivos)} arquivo(s): {[Path(a).name for a in arquivos]}")
    if not arquivos:
        raise RuntimeError("Nenhum documento baixado do Gestta.")

    resumo = processar_arquivos(empresa_id, competencia_front, arquivos, banco_cod, jwt)
    resumo.update({"tarefa_id": tarefa_id, "responsavel": responsavel, "competencia_front": competencia_front})
    return resumo


def main():
    ap = argparse.ArgumentParser(description="Conecta a automação ao front (PROC-001 até Etapa 4)")
    ap.add_argument("--empresa-id", required=True)
    ap.add_argument("--competencia", required=True, help="YYYY-MM")
    ap.add_argument("--banco", type=int, default=657, help="código LCR do banco (657=Itaú)")
    ap.add_argument("--origem", default="gestta")
    ap.add_argument("--conciliar", action="store_true",
                    help="também finaliza a conciliação (default: só envia documentos + análise)")
    # Fonte dos documentos (escolher uma):
    ap.add_argument("--extrato", help="caminho de um extrato local (PDF/Excel)")
    ap.add_argument("--docs", help="pasta com documentos locais já baixados (processa sem Gestta)")
    ap.add_argument("--gestta-task", help="tarefaId do Gestta para baixar os documentos")
    ap.add_argument("--gestta-cliente", help="código/nome do cliente no Gestta (resolve a tarefa)")
    args = ap.parse_args()

    if not (args.extrato or args.docs or args.gestta_task or args.gestta_cliente):
        ap.error("informe uma fonte: --extrato OU --docs OU --gestta-task OU --gestta-cliente")

    faltando = [k for k, v in {"SUPABASE_URL": URL, "SERVICE_ROLE": SR, "ANON": ANON,
                               "SVC_EMAIL": SVC_EMAIL, "SVC_PWD": SVC_PWD}.items() if not v]
    if faltando:
        log(f"[ERRO] Variáveis ausentes no .env: {faltando}")
        sys.exit(1)

    log("=== Bridge Front (PROC-001 → Supabase) ===")
    log(f"  empresa_id : {args.empresa_id}")
    log(f"  competência: {args.competencia}")
    fonte = args.extrato or args.docs or args.gestta_task or args.gestta_cliente
    modo = "extrato local" if args.extrato else ("docs locais" if args.docs else "Gestta")
    log(f"  fonte      : {modo} → {fonte}")

    jwt = obter_jwt()
    log("  JWT do usuário de serviço obtido ✓")

    if args.extrato:
        resumo = processar_extrato(args.empresa_id, args.competencia, args.extrato, args.banco, jwt,
                                   args.origem, finalizar_conciliacao=args.conciliar)
    elif args.docs:
        arquivos = sorted(str(p) for p in Path(args.docs).iterdir() if p.is_file())
        log(f"  docs locais: {[Path(a).name for a in arquivos]}")
        resumo = processar_arquivos(args.empresa_id, args.competencia, arquivos, args.banco, jwt)
    else:
        resumo = processar_via_gestta(args.empresa_id, args.competencia,
                                      args.gestta_cliente, args.gestta_task, args.banco, jwt)

    log("\n✅ CONCLUÍDO")
    log(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

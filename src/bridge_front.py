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
import re
import time
import hashlib
import unicodedata
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
sys.path.insert(0, str(ROOT / "src"))
from arquivos_compactados import expandir_arquivos_compactados  # noqa: E402
from extrato_bancario import parsear_extrato, extrair_identidade, chave_extrato, detectar_banco  # noqa: E402
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
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(str(msg).encode("ascii", "replace").decode("ascii"), flush=True)


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


def sb_delete(tabela: str, match: dict):
    """DELETE por filtros de igualdade. Ex.: sb_delete('lancamentos', {'documento_id': did}).
    EXIGE ao menos um filtro (guarda contra apagar a tabela inteira sem querer)."""
    if not match:
        raise ValueError("sb_delete exige ao menos um filtro (match vazio apagaria tudo).")
    if any(v is None or v == "" for v in match.values()):
        raise ValueError(f"sb_delete: filtro com valor None/vazio recusado ({match}) — "
                         "evita 'eq.None' (deletaria 0 linhas silenciosamente).")
    params = {k: f"eq.{v}" for k, v in match.items()}
    headers = {**SR_HEADERS, "Prefer": "return=minimal"}
    r = requests.delete(f"{URL}/rest/v1/{tabela}", headers=headers, params=params, timeout=60)
    if not r.ok:
        raise RuntimeError(f"DELETE {tabela} falhou: {r.status_code} {r.text[:300]}")


def get_all(tabela: str, params: dict, page: int = 1000) -> list:
    """GET paginado (Range) — junta todas as linhas além do teto do PostgREST.
    Substitui as paginações ad-hoc espalhadas pelos scripts."""
    linhas, off = [], 0
    while True:
        headers = {**SR_HEADERS, "Range-Unit": "items", "Range": f"{off}-{off + page - 1}"}
        r = requests.get(f"{URL}/rest/v1/{tabela}", headers=headers, params=params, timeout=60)
        if not r.ok:
            raise RuntimeError(f"GET {tabela} falhou: {r.status_code} {r.text[:300]}")
        batch = r.json()
        linhas.extend(batch)
        if len(batch) < page:
            break
        off += page
    return linhas


def baixar_storage(bucket: str, path: str) -> bytes:
    """Baixa um objeto do Storage (service role). Reusado pelos scripts de reprocesso
    (antes cada um reimplementava o GET com SR_HEADERS)."""
    r = requests.get(f"{URL}/storage/v1/object/{bucket}/{path}", headers=SR_HEADERS, timeout=120)
    if not r.ok:
        raise RuntimeError(f"DOWNLOAD {bucket}/{path} falhou: {r.status_code} {r.text[:200]}")
    return r.content


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


# ── Sobreposição de transações (confirma dedup por identidade) ────────────────
# A chave de dedup (agência|conta|mês) NÃO inclui o banco, então dois bancos com
# mesma ag/conta/mês na mesma empresa colidiriam. Antes de marcar duplicata (e
# deletar razão), exigimos que as transações realmente se sobreponham — mesmo
# extrato tem sobreposição ~100%; colisão de chave tem ~0%.
OVERLAP_MIN_DEDUP = 0.6  # fração mínima do MENOR conjunto p/ confirmar mesmo extrato

def assin_transacoes(transacoes: list) -> set:
    """Assinatura (data, valor) de transações cruas do parser (campos data/valor)."""
    s = set()
    for t in transacoes or []:
        v = t.get("valor")
        if v in (None, ""):
            continue
        s.add(((_iso_data(t.get("data")) or "")[:10], round(abs(float(v)), 2)))
    return s

def assin_lancamentos(lancs: list) -> set:
    """Assinatura (data, valor) de lançamentos do banco (data_lancamento/valor)."""
    s = set()
    for l in lancs or []:
        v = l.get("valor")
        if v is None:
            continue
        s.add(((l.get("data_lancamento") or "")[:10], round(abs(float(v)), 2)))
    return s

def sobreposicao(a: set, b: set) -> float:
    """Fração do MENOR conjunto que aparece no outro (0..1). Robusto a versões com
    contagens diferentes (resumido ⊂ comentado). 0 se algum conjunto é vazio."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def dedup_intra_transacoes(transacoes: list) -> list:
    """Remove transações repetidas no mesmo extrato (tipo A: mesma data+valor).
    Mantém a 1ª ocorrência — evita classificar/insertar a mesma linha N vezes."""
    seen, out = set(), []
    for t in transacoes or []:
        v = t.get("valor")
        if v in (None, ""):
            out.append(t)
            continue
        d = (_iso_data(t.get("data")) or "")[:10]
        key = (d, round(abs(float(v)), 2))
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def dedup_intra_lancamentos(lancamentos: list) -> list:
    """Remove lançamentos repetidos antes do insert (mesma data_lancamento+valor)."""
    seen, out = set(), []
    for l in lancamentos or []:
        v = l.get("valor")
        if v is None:
            out.append(l)
            continue
        d = (l.get("data_lancamento") or "")[:10]
        key = (d, round(abs(float(v)), 2))
        if key in seen:
            continue
        seen.add(key)
        out.append(l)
    return out


_RE_COMPETENCIA_PREFIXO = re.compile(r"^\d{2}/\d{4}\s*")

def _descricao_lancamento(linha: dict) -> str:
    """Descrição legível do lançamento = histórico do banco (texto do extrato) +
    complemento SCI quando agrega info (ex.: participante). O complemento sozinho
    costuma ser só 'MM/AAAA' (competência) — inútil como descrição — por isso o
    histórico do banco é primário. Fallback: complemento cru se não houver histórico."""
    origem = (linha.get("descricao_origem") or "").strip()
    compl = (linha.get("complemento") or "").strip()
    extra = _RE_COMPETENCIA_PREFIXO.sub("", compl).strip()  # tira 'MM/AAAA' redundante
    if origem and extra and extra.lower() not in origem.lower():
        return f"{origem} · {extra}"[:200]
    return (origem or compl)[:200]


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
        "descricao": _descricao_lancamento(linha),
        "status": "gerada",
        "confidence": float(linha.get("confianca")) if linha.get("confianca") is not None else None,
        "conciliado": False,
        # Razão binária: estes lançamentos vêm do EXTRATO (fonte da conciliação).
        # A flag habilita o filtro do conciliar e o casamento do enriquecer-extrato.
        "fonte_extrato": True,
        "enriquecido": False,
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
            "descricao": _descricao_lancamento(l),
            "confidence": (float(l.get("confianca")) if l.get("confianca") is not None else None),
            "regra_id": l.get("regra_id"),
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


def ensure_conciliacao_extrato(empresa_id: str, competencia: str, competencia_id: str, transacoes: list):
    """Persiste o extrato bancário do Gestta (TODAS as contas do mês juntas) como CSV
    no bucket de conciliações e garante a linha `conciliacoes` com extrato_csv_url —
    SEM rodar o motor (conciliar continua sendo passo humano). É o que habilita o botão
    'Conciliar agora' a atuar sobre os registros extraídos, sem importação manual.
    Requisito da Mariana (2026-06): cruzar razão (lançamentos) × extrato do Gestta."""
    if not transacoes:
        return None
    csv_bytes = montar_csv_extrato(transacoes)
    csv_path = f"{empresa_id}/{competencia}/extrato-gestta-{competencia}.csv"
    sb_upload(BUCKET_CONC, csv_path, csv_bytes, "text/csv")
    achados = sb_get("conciliacoes", {
        "empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{competencia}",
        "select": "id", "limit": "1",
    })
    if achados:
        sb_update("conciliacoes", {"id": achados[0]["id"]},
                  {"extrato_csv_url": csv_path, "status": "em_andamento"})
        return achados[0]["id"]
    novo = sb_insert("conciliacoes", {
        "empresa_id": empresa_id, "competencia": competencia,
        "competencia_id": competencia_id, "extrato_csv_url": csv_path,
        "status": "em_andamento",
    })
    return novo[0]["id"] if novo else None


# ── Pipeline principal ───────────────────────────────────────────────────────
def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def documento_existente(empresa_id: str, hash_sha256: str):
    """Retorna o documento já gravado com o mesmo (empresa_id, hash) ou None.
    Base da idempotência de upload — evita 2º documento/lançamentos duplicados
    quando o mesmo arquivo reentra no pipeline."""
    achados = sb_get("documentos", {
        "empresa_id": f"eq.{empresa_id}", "hash_sha256": f"eq.{hash_sha256}",
        "select": "id,storage_path,tipo", "limit": "1",
    })
    return achados[0] if achados else None


def _buscar_original_extrato(empresa_id: str, chave: str, excluir_id: str):
    """Retorna o extrato ORIGINAL (não-duplicata) com esta identidade nesta empresa,
    ou None. Base do dedup por identidade (mesmo banco/agência/conta/mês)."""
    if not chave:
        return None
    a = sb_get("documentos", {"select": "id,arquivo_nome",
                              "empresa_id": f"eq.{empresa_id}", "extrato_chave": f"eq.{chave}",
                              "duplicata_de": "is.null", "id": f"neq.{excluir_id}", "limit": "1"})
    return a[0] if a else None


def processar_extrato(empresa_id, competencia, extrato_path, banco_cod, jwt, origem="gestta", finalizar_conciliacao=False):
    extrato_path = Path(extrato_path)
    if not extrato_path.exists():
        raise FileNotFoundError(extrato_path)

    # Idempotência: se este arquivo (hash) já foi gravado p/ esta empresa, reusa.
    conteudo = extrato_path.read_bytes()
    hash_doc = _sha256_bytes(conteudo)
    existente = documento_existente(empresa_id, hash_doc)
    if existente:
        log(f"    documento idempotente (hash já existe) → reusando {existente['id']}, pulando reprocessamento")
        return {"documento_id": existente["id"], "lancamentos": 0, "transacoes": 0,
                "status": "idempotente", "arquivo": extrato_path.name}

    comp_motor = f"{competencia[5:7]}/{competencia[0:4]}"  # 2026-06 -> 06/2026

    log(f"\n[1] Parseando extrato: {extrato_path.name}")
    # banco=None → autodetecção (detectar_banco, por nome do arquivo/conteúdo do PDF).
    # Antes hardcoded "itau": forçava o parser específico do Itaú (_parsear_pdf_itau)
    # em extratos de outros bancos, que falhava silenciosamente (0 transações) e caía
    # no fallback Edge/AI sem necessidade — banco_cod é a conta contábil de
    # contrapartida (classificação), não tem relação com o banco emissor do extrato.
    transacoes = parsear_extrato(str(extrato_path), competencia=competencia)
    n_antes = len(transacoes)
    transacoes = dedup_intra_transacoes(transacoes)
    if len(transacoes) < n_antes:
        log(f"    dedup intra-doc: {n_antes - len(transacoes)} transação(ões) repetida(s) descartada(s)")
    log(f"    {len(transacoes)} transações extraídas")
    if not transacoes:
        raise RuntimeError("Nenhuma transação extraída do extrato.")

    log("\n[2] Garantindo competência + registrando documento...")
    competencia_id = ensure_competencia(empresa_id, competencia)
    storage_path = f"{empresa_id}/{competencia}/{_safe_storage_name(extrato_path.name)}"
    sb_upload(BUCKET_DOCS, storage_path, conteudo, "application/pdf")
    doc = sb_insert("documentos", {
        "empresa_id": empresa_id, "tipo": "extrato", "competencia": competencia,
        "competencia_id": competencia_id, "origem": origem, "status": "recebido",
        "status_processamento": "pendente", "arquivo_nome": extrato_path.name,
        "storage_path": storage_path, "arquivo_url": storage_path,
        "hash_sha256": hash_doc, "mime_type": "application/pdf", "tamanho_bytes": len(conteudo),
    })
    documento_id = doc[0]["id"]
    log(f"    documento_id={documento_id}")

    # Dedup por IDENTIDADE (banco/agência/conta/mês = mesmo extrato). Se já existe um
    # original com esta chave nesta empresa → marca ESTE como duplicata, NÃO gera razão
    # (regra Rafa+Cleiton). Feito ANTES do motor IA p/ não gastar classificação à toa.
    identidade = extrair_identidade(str(extrato_path), banco=detectar_banco(extrato_path.name))
    chave = chave_extrato(identidade, competencia)
    original = _buscar_original_extrato(empresa_id, chave, documento_id) if chave else None
    if original:
        # Confirma que é o MESMO extrato (não só mesma chave): as transações precisam
        # se sobrepor. Sem isto, dois bancos com mesma ag/conta/mês colidiriam na chave
        # (o banco não entra nela) e o 2º seria marcado duplicata indevidamente. Só
        # marca quando o original tem razão E a sobreposição confirma — senão processa
        # normal (o backstop por sobreposição ainda cobre duplicata real não pega aqui).
        orig_lancs = get_all("lancamentos", {"select": "data_lancamento,valor",
                                             "documento_id": f"eq.{original['id']}", "fonte_extrato": "eq.true"})
        ov = sobreposicao(assin_transacoes(transacoes), assin_lancamentos(orig_lancs))
        if orig_lancs and ov >= OVERLAP_MIN_DEDUP:
            log(f"    DUPLICATA de '{original.get('arquivo_nome')}' (chave {chave}, sobrep {ov:.0%}) → não gera razão")
            sb_update("documentos", {"id": documento_id}, {
                "status_processamento": "duplicata", "duplicata_de": original["id"],
                "extrato_chave": chave, "lancamentos_gerados": 0,
            })
            return {"documento_id": documento_id, "lancamentos": 0, "transacoes": [],
                    "status": "duplicata", "duplicata_de": original["id"], "arquivo": extrato_path.name}
        log(f"    AVISO: chave {chave} coincide com '{original.get('arquivo_nome')}' mas sobreposição {ov:.0%} "
            f"(orig {len(orig_lancs)} lanç.) — tratando como extrato próprio, gera razão")

    log(f"\n[3] Classificando com o motor IA (banco {banco_cod}, {comp_motor})...")
    resultado = classificar_extrato(transacoes, conta_banco=banco_cod, competencia=comp_motor)
    aprovadas = resultado["aprovadas"]
    revisao = [r["classificacao_sugerida"] for r in resultado["revisao_manual"]]
    log(f"    aprovadas={len(aprovadas)} revisão={len(revisao)} erros={resultado['resumo']['erros']}")

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
    n_lanc_antes = len(lancamentos)
    lancamentos = dedup_intra_lancamentos(lancamentos)
    if len(lancamentos) < n_lanc_antes:
        log(f"    dedup intra-doc: {n_lanc_antes - len(lancamentos)} lançamento(s) repetido(s) descartado(s)")
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
        "extrato_chave": chave,  # identidade p/ dedup vivo dos próximos extratos
    })

    resultado = {"documento_id": documento_id, "lancamentos": len(lancamentos), "transacoes": transacoes}

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
    # json.dumps gera um literal de string JS válido (escapa aspas/barras) —
    # evita injeção/quebra com nomes que tenham apóstrofo, aspas ou '\'.
    js = ("const g=require('./src/gestta/index.js');"
          f"g.buscarTarefasPendentes({json.dumps(comp_gestta)})"
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
          f"g.baixarDocumentosCliente({json.dumps(tarefa_id)},{json.dumps(comp_gestta)},{json.dumps(destino)})"
          ".then(a=>console.log(JSON.stringify(a)))"
          ".catch(e=>{console.error(e.message);process.exit(1)});")
    return json.loads(_node_eval(js))


def detectar_tipo(nome: str) -> str:
    """Mapeia o nome do arquivo para o enum documentos.tipo. É só uma DICA de
    ROTEAMENTO — quem decide razão-vs-suporte de verdade é a IA na edge (por
    CONTEÚDO). Por isso só extrato de conta corrente "limpo" vira 'extrato' (vai
    pro parser local, extração barata); posição/investimento/cartão NÃO viram
    'extrato' — vão pra edge, onde a IA separa movimento (razão) de posição/
    suporte. Assim some o falso-positivo (posição nomeada "Extrato Posicao" virando
    razão local) e o falso-negativo (extrato mal-nomeado virando suporte)."""
    n = nome.lower()
    # posição/investimento → edge (a IA separa movimento de investimento=razão de
    # posição consolidada=suporte). Termos ESPECÍFICOS p/ não colidir com palavras
    # comuns: 'posic'/'posiç' (não 'posi', que casaria "deposito"); sem 'consolidad'
    # (casaria "Extrato Consolidado" bancário) nem 'fundo' (casaria "Fundo de Garantia").
    if any(k in n for k in ["posic", "posiç", "investiment", "aplicac", "aplicaç",
                            "renda fixa", "renda-fixa", "cdb"]):
        return "planilha_financeira"
    # fatura/cartão → edge; a IA confirma como razão (fatura = fonte de movimento).
    if any(k in n for k in ["fatura", "cartao", "cartão"]):
        return "fatura_cartao"
    # extrato ANTES de nf/darf: extrato com 'das'/'guia' no nome ("Extrato das
    # Contas") não pode cair no grupo darf pelo 'das'. → parser local (barato).
    if any(k in n for k in ["extrato", "cta", "conta corrente"]):
        return "extrato"
    if any(k in n for k in ["nfe", "nf-e", "nota fiscal", "nfse", "nfs-e"]):
        return "nf_entrada"
    if any(k in n for k in ["darf", "das", "guia", "inss", "fgts", "gps"]):
        return "darf"
    if "recibo" in n:
        return "recibo"
    if n.endswith((".xlsx", ".xls", ".csv")) or "planilha" in n or "fluxo" in n:
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


def _safe_storage_name(nome: str) -> str:
    """Chave de storage segura p/ o Supabase (evita 400 InvalidKey com acentos/
    espaços/caracteres especiais). Mantém a extensão; o nome legível original
    permanece em documentos.arquivo_nome."""
    p = Path(nome)
    base = unicodedata.normalize("NFKD", p.stem).encode("ascii", "ignore").decode("ascii")
    ext = unicodedata.normalize("NFKD", p.suffix).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "arquivo"
    ext = re.sub(r"[^A-Za-z0-9.]+", "", ext)
    return f"{base}{ext}"


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

    # Idempotência: mesmo arquivo (hash) já gravado p/ esta empresa → reusa.
    hash_doc = _sha256_bytes(conteudo)
    existente = documento_existente(empresa_id, hash_doc)
    if existente:
        log(f"    documento idempotente (hash já existe) → reusando {existente['id']}, pulando edge")
        return {"documento_id": existente["id"], "tipo": tipo, "status": "idempotente"}

    storage_path = f"{empresa_id}/{competencia}/{_safe_storage_name(arquivo_nome)}"
    sb_upload(BUCKET_DOCS, storage_path, conteudo, ctype)
    doc = sb_insert("documentos", {
        "empresa_id": empresa_id, "tipo": tipo, "competencia": competencia,
        "competencia_id": competencia_id, "origem": origem, "status": "recebido",
        "status_processamento": "pendente", "arquivo_nome": arquivo_nome,
        "storage_path": storage_path, "arquivo_url": storage_path,
        "hash_sha256": hash_doc, "mime_type": ctype, "tamanho_bytes": len(conteudo),
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


def deduplicar_razao(empresa_id: str, competencia: str, limiar: float = 0.8) -> int:
    """Remove razão de statements DUPLICADOS (mesmo extrato em 2+ formatos, ex.:
    PDF+xlsx). Agrupa lançamentos fonte_extrato por documento (chave (data,valor)
    -> ids). Se o conjunto de chaves de um doc está >= `limiar` contido no de
    outro, é o mesmo statement. Remoção TRANSAÇÃO-A-TRANSAÇÃO: apaga só os
    lançamentos cuja chave TAMBÉM está no doc mantido; PRESERVA a cauda única
    (chaves que só existem no descartado) — sem perda de transação. Mantém o
    parser local (xlsx/csv) > PDF; depois o mais completo; depois id menor.
    Multi-conta (overlap baixo) não é tocado. Retorna nº de lançamentos removidos."""
    L = sb_get("lancamentos", {"select": "id,documento_id,data_lancamento,valor",
                               "empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{competencia}",
                               "fonte_extrato": "eq.true", "limit": "5000"})
    docs = {}  # doc -> {chave: [lanc_ids]}
    for l in L:
        did = l.get("documento_id")
        if not did:
            continue
        ch = ((l.get("data_lancamento") or "")[:10], round(abs(float(l.get("valor") or 0)), 2))
        docs.setdefault(did, {}).setdefault(ch, []).append(l["id"])
    ids = [d for d in docs if docs[d]]
    if len(ids) < 2:
        return 0
    sets = {d: set(docs[d].keys()) for d in ids}
    nomes = {d["id"]: d.get("arquivo_nome") for d in sb_get("documentos",
             {"select": "id,arquivo_nome", "empresa_id": f"eq.{empresa_id}",
              "competencia": f"eq.{competencia}", "limit": "300"})}
    def _local(did):
        return (nomes.get(did) or "").lower().endswith((".xlsx", ".xls", ".csv"))
    descartar = {}  # descartado -> mantido
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if a in descartar or b in descartar:
                continue
            sa, sb = sets[a], sets[b]
            if len(sa & sb) / min(len(sa), len(sb)) >= limiar:
                if _local(a) != _local(b):
                    manter = a if _local(a) else b
                elif len(sa) != len(sb):
                    manter = a if len(sa) > len(sb) else b
                else:
                    manter = min(a, b)
                descartar[b if manter == a else a] = manter
    removidos = 0
    for did, mant in descartar.items():
        dup_chaves = sets[did] & sets[mant]
        del_ids = [lid for ch in dup_chaves for lid in docs[did][ch]]
        if not del_ids:
            continue
        if len(dup_chaves) == len(sets[did]):   # doc totalmente contido → 1 delete por documento_id
            sb_delete("lancamentos", {"documento_id": did})
        else:                                    # parcial → apaga só os dup, preserva únicos
            for lid in del_ids:
                sb_delete("lancamentos", {"id": lid})
        removidos += len(del_ids)
        unico = len(sets[did]) - len(dup_chaves)
        log(f"    dedup: {(nomes.get(did) or '?')[:40]} — {len(del_ids)} dup removidos"
            + (f", {unico} únicos mantidos" if unico else ""))
    return removidos


def processar_arquivos(empresa_id, competencia, arquivos, banco_cod, jwt,
                       extrato_fallback_edge=False):
    """Roteia uma lista de arquivos: extrato → motor IA; demais → edge function.
    Reutilizado pelo modo Gestta e pelo modo --docs (arquivos locais).
    extrato_fallback_edge (backfill): se o parser local não ler o extrato (layout
    não-Itaú → 0 transações), roteia esse extrato para a edge (a IA lê layouts
    diversos) em vez de mandar p/ revisão humana. O fluxo vivo passa False."""
    arquivos, avisos_compact = expandir_arquivos_compactados(arquivos)
    for msg in avisos_compact:
        log(f"    ⚠️ compactado: {msg}")

    extratos = [a for a in arquivos if detectar_tipo(Path(a).name) == "extrato"]
    outros = [a for a in arquivos if a not in extratos]
    resumo = {"arquivos": len(arquivos), "extratos": [], "outros": [], "avisos_compactados": avisos_compact}

    # Resiliência: um documento com formato/erro não derruba a tarefa — é sinalizado.
    for ext in extratos:
        log(f"\n[doc] Processando extrato: {Path(ext).name}")
        try:
            resumo["extratos"].append(processar_extrato(empresa_id, competencia, ext, banco_cod, jwt))
        except Exception as e:
            if extrato_fallback_edge:
                # Parser local falhou → a edge (IA) tenta ler o extrato. Cai no bloco
                # de 'outros' abaixo com tipo detectado 'extrato' (a edge cria os
                # lançamentos fonte_extrato=true + conciliação server-side).
                log(f"    ↻ parser local falhou ({str(e)[:80]}) → roteando extrato p/ a edge (IA)")
                outros.append(ext)
            else:
                log(f"    ⚠️ extrato não processado ({Path(ext).name}): {str(e)[:120]}")
                resumo["extratos"].append({"arquivo": Path(ext).name, "erro": str(e)[:200], "status": "revisao_humana"})

    # Prepara a conciliação (sem rodar o motor): junta as transações de TODAS as contas
    # num CSV e cria a linha conciliacoes → habilita o botão "Conciliar agora" no front
    # a atuar sobre os registros extraídos do Gestta (passo humano).
    transacoes_extrato = [t for e in resumo["extratos"] for t in (e.get("transacoes") or [])]
    if transacoes_extrato:
        try:
            competencia_id = ensure_competencia(empresa_id, competencia)
            cid = ensure_conciliacao_extrato(empresa_id, competencia, competencia_id, transacoes_extrato)
            resumo["conciliacao_id"] = cid
            log(f"    conciliação preparada: {len(transacoes_extrato)} transação(ões) do extrato → conciliacoes={cid}")
        except Exception as e:
            log(f"    ⚠️ não consegui preparar a conciliação (extrato p/ botão): {str(e)[:160]}")
    for e in resumo["extratos"]:
        e.pop("transacoes", None)  # não carrega as transações cruas no resumo de retorno

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

    # Reflete a fase no painel quando NENHUM extrato foi processado pelo motor local
    # (sem extrato-nomeado, ou todos caíram p/ a edge no fallback). Quando o motor
    # local processa um extrato com sucesso, quem seta o status é processar_extrato.
    # Duplicata (#7) NÃO conta como "processado localmente": ela retorna cedo (não gera
    # razão nem seta status), então uma competência só-de-duplicatas travaria no status
    # anterior — aqui ela cai no fallback e avança normalmente.
    extrato_local_ok = any(e.get("documento_id") and not e.get("erro")
                           and e.get("status") != "duplicata" for e in resumo["extratos"])
    if not extrato_local_ok:
        sb_update("empresas", {"id": empresa_id}, {"status": "lancamento"})

    # Dedup de statements duplicados (mesmo extrato enviado em PDF+xlsx/csv na
    # mesma cobrança) → remove a razão redundante ANTES do enriquecimento,
    # mantendo a versão mais confiável (parser local > IA/PDF). Evita razão dobrada
    # (SHA só dedup por arquivo; PDF e xlsx têm hashes diferentes).
    try:
        rem = deduplicar_razao(empresa_id, competencia)
        if rem:
            log(f"    dedup: {rem} lançamento(s) de statement duplicado removidos")
    except Exception as e:
        log(f"    AVISO: dedup falhou (não-fatal): {str(e)[:120]}")

    # Enriquecimento (validação): casa os documentos de suporte (NF/recibo/etc.)
    # com os lançamentos do extrato (fonte_extrato=true) por valor+data, preenchendo
    # participante/nº nota. Só faz sentido se houve extrato processado com sucesso.
    if any(not e.get("erro") for e in resumo["extratos"]):
        try:
            chamar_edge("enriquecer-extrato", {"empresa_id": empresa_id, "competencia": competencia}, jwt)
            log("    enriquecer-extrato disparado (suporte → lançamentos do extrato)")
        except Exception as e:
            log(f"    ⚠️ enriquecer-extrato falhou (não-fatal): {str(e)[:160]}")

    return resumo


def processar_via_gestta(empresa_id, competencia, termo_cliente, tarefa_id, banco_cod, jwt, competencia_front=None):
    # competencia = mês de COBRANÇA / competência contábil no front (ex.: jan/2026).
    # competencia_front = onde documentos e lançamentos entram no Supabase (default = competencia).
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

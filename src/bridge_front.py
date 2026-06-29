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
import argparse
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
def processar_extrato(empresa_id, competencia, extrato_path, banco_cod, jwt, origem="gestta"):
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
        "storage_path": storage_path,
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

    sb_update("documentos", {"id": documento_id}, {
        "status": "processado", "status_processamento": "classificado",
        "processado_em": dt.datetime.utcnow().isoformat() + "Z",
        "lancamentos_gerados": len(lancamentos),
        "classificacao_ia": {"fonte": "motor_lcr", "aprovadas": len(aprovadas),
                              "revisao": len(revisao), "total": len(transacoes)},
    })

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

    log("\n[7] Atualizando status da empresa → conciliacao...")
    sb_update("empresas", {"id": empresa_id}, {"status": "conciliacao"})

    return {
        "documento_id": documento_id,
        "lancamentos": len(lancamentos),
        "conciliacao_id": conciliacao_id,
        "conciliacao": res_conc,
    }


def main():
    ap = argparse.ArgumentParser(description="Conecta a automação ao front (PROC-001 até Etapa 4)")
    ap.add_argument("--empresa-id", required=True)
    ap.add_argument("--competencia", required=True, help="YYYY-MM")
    ap.add_argument("--extrato", required=True, help="caminho do extrato (PDF/Excel)")
    ap.add_argument("--banco", type=int, default=657, help="código LCR do banco (657=Itaú)")
    ap.add_argument("--origem", default="gestta")
    args = ap.parse_args()

    faltando = [k for k, v in {"SUPABASE_URL": URL, "SERVICE_ROLE": SR, "ANON": ANON,
                               "SVC_EMAIL": SVC_EMAIL, "SVC_PWD": SVC_PWD}.items() if not v]
    if faltando:
        log(f"[ERRO] Variáveis ausentes no .env: {faltando}")
        sys.exit(1)

    log("=== Bridge Front (PROC-001 → Supabase) ===")
    log(f"  empresa_id : {args.empresa_id}")
    log(f"  competência: {args.competencia}")
    log(f"  extrato    : {args.extrato}")

    jwt = obter_jwt()
    log("  JWT do usuário de serviço obtido ✓")

    resumo = processar_extrato(args.empresa_id, args.competencia, args.extrato, args.banco, jwt, args.origem)
    log("\n✅ CONCLUÍDO")
    log(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

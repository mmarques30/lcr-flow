"""
Cria (ou recria) um cliente/mes "sandbox" com dados sempre limpos para testar
o caminho feliz da conciliacao v3 (Analisar -> saldo confere -> faltantes=0 ->
Conciliar liberado -> Baixar SCI) sem depender de dados reais de cliente.

Uso (a partir da raiz do repo lcr-flow):
  python scripts/seed_sandbox_qa.py            # cria (ou recria do zero) o sandbox
  python scripts/seed_sandbox_qa.py --reset    # so reseta a competencia (mantem empresa)

Nao roda em produção via cron/automação: a empresa tem nome propositalmente
fora do padrão para nunca casar com o fuzzy-match do orquestrador (resolver_empresa),
is_demo=true e ativo=false para não entrar nos KPIs/alertas do dashboard.

Requer SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY em algum
.env. O .env deste repo (LCR-front) às vezes não tem a service role key (foi
resetado por algo externo em 2026-07-17) — por isso também tenta o .env do
worktree irmão (repo LCR, pasta "../LCR"), que costuma ter a chave completa.
Ver .cursor/rules/checklist-ambiente-sessao.mdc (item "Múltiplos worktrees").
"""
import os
import sys

import requests
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"))
if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
    load_dotenv(os.path.join(os.path.dirname(ROOT), "LCR", ".env"), override=False)
URL = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")
SR = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
if not SR:
    print("ERRO: SUPABASE_SERVICE_ROLE_KEY nao encontrado em LCR-front/.env nem em ../LCR/.env.")
    sys.exit(1)
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json"}
HREAD = {"apikey": SR, "Authorization": f"Bearer {SR}"}

RAZAO_SOCIAL = "ZZZ SANDBOX QA - NAO E CLIENTE REAL"
CNPJ = "00.000.000/0001-91"
COMPETENCIA = "2026-08"
HIST_RECEB_ID = "388b882f-42ce-412c-ade3-c61019fed2cd"  # historicos_contabeis: "Recebimento de clientes" (codigo 477)
HIST_SCI_CODIGO = 19  # historicos_sci_lcr: "Aquisição de investimento" (qualquer codigo valido serve p/ teste)
# A Planilha SCI (src/lib/sci-xls.ts:linhasSci/linhasSciPreview) resolve
# Debito/Credito a partir de lancamentos.conta_id (join com plano_contas) de UM
# lado, e do banco cadastrado em contas_bancarias (via bancoCodigoDe) do OUTRO
# lado — NAO usa pdc_codigo/hist_sci_codigo pra isso. Se conta_id apontar pro
# mesmo banco da empresa, Debito=Credito=banco na previa (bug encontrado na
# retro de 2026-07-17: nao usar CONTA_BB_ID aqui!). Por isso a contrapartida
# usa contas analiticas DIFERENTES do banco, e diferentes entre credito/debito.
CONTA_CREDITO_ID = "3033c1da-eb81-45da-b6fb-162dd448bdc2"  # plano_contas global: "Aplicação - Banco XP Investimentos" (codigo 1170)
CONTA_DEBITO_ID = "0e75a827-087b-4462-a2dd-aca8c6ca0aa8"  # plano_contas global: "Fornecedores" (codigo 148)

SALDO_INICIAL = 10000.00
MOVS = [
    {"data": f"{COMPETENCIA}-05", "descricao": "Recebimento cliente Delta Consultoria", "valor": 5000.00, "tipo": "credito", "conta_id": CONTA_CREDITO_ID},
    {"data": f"{COMPETENCIA}-10", "descricao": "Pagamento fornecedor Beta Suprimentos", "valor": 2000.00, "tipo": "debito", "conta_id": CONTA_DEBITO_ID},
    {"data": f"{COMPETENCIA}-15", "descricao": "Tarifa de manutencao de conta", "valor": 100.00, "tipo": "debito", "conta_id": CONTA_DEBITO_ID},
]
MOV_NET = sum(m["valor"] if m["tipo"] == "credito" else -m["valor"] for m in MOVS)
SALDO_FINAL = round(SALDO_INICIAL + MOV_NET, 2)


def log(msg):
    print(msg, flush=True)


def buscar_empresa_existente():
    r = requests.get(f"{URL}/rest/v1/empresas", headers=HREAD, params={"select": "id", "razao_social": f"eq.{RAZAO_SOCIAL}"}, timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0]["id"] if rows else None


def apagar_dados_competencia(empresa_id: str):
    """Remove lancamentos/documentos/conciliacao da COMPETENCIA (mantem a empresa)."""
    for tabela in ("lancamentos", "documentos", "conciliacoes"):
        r = requests.delete(
            f"{URL}/rest/v1/{tabela}",
            headers=H,
            params={"empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{COMPETENCIA}"},
            timeout=30,
        )
        if r.status_code not in (200, 204):
            log(f"  aviso: limpar {tabela} -> {r.status_code} {r.text[:200]}")


def criar_empresa() -> str:
    r = requests.post(
        f"{URL}/rest/v1/empresas",
        headers={**H, "Prefer": "return=representation"},
        json={
            "razao_social": RAZAO_SOCIAL,
            "nome_fantasia": "SANDBOX QA",
            "cnpj": CNPJ,
            "regime": "simples",
            "segmento": "QA interno - nao e cliente real",
            "tags": ["sandbox", "qa", "nao-cobrar", "nao-faturar"],
            "status": "conciliacao",
            "ativo": False,
            "is_demo": True,
            "observacoes": "Cliente sintetico para testar o caminho feliz da conciliacao v3 (saldo confere, faltantes=0). Recriado por scripts/seed_sandbox_qa.py. NAO apagar pensando que e um cliente de teste generico sem proposito.",
        },
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"criar_empresa falhou: {r.status_code} {r.text}")
    empresa_id = r.json()[0]["id"]
    log(f"  empresa criada: {empresa_id}")

    r2 = requests.post(
        f"{URL}/rest/v1/contas_bancarias",
        headers=H,
        json={"empresa_id": empresa_id, "banco": "Banco do Brasil", "agencia": "0001", "conta": "12345-6", "tipo": "corrente"},
        timeout=30,
    )
    if r2.status_code >= 300:
        log(f"  aviso: contas_bancarias -> {r2.status_code} {r2.text[:200]}")
    return empresa_id


def montar_csv() -> bytes:
    linhas = ["data;descricao;valor;tipo"]
    for m in MOVS:
        linhas.append(f"{m['data']};{m['descricao']};{m['valor']:.2f};{m['tipo']}")
    return ("\n".join(linhas) + "\n").encode("utf-8")


def subir_csv(empresa_id: str) -> str:
    path = f"{empresa_id}/{COMPETENCIA}/extrato-sandbox-qa.csv"
    csv_bytes = montar_csv()
    r = requests.post(
        f"{URL}/storage/v1/object/conciliacoes/{path}",
        headers={"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "text/csv", "x-upsert": "true"},
        data=csv_bytes,
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"upload CSV falhou: {r.status_code} {r.text}")
    log(f"  CSV enviado: {path}")
    return path


def criar_documento_extrato(empresa_id: str) -> str:
    r = requests.post(
        f"{URL}/rest/v1/documentos",
        headers={**H, "Prefer": "return=representation"},
        json={
            "empresa_id": empresa_id,
            "tipo": "extrato",
            "competencia": COMPETENCIA,
            "origem": "manual",
            "status": "processado",
            "status_processamento": "classificado",
            "arquivo_nome": "extrato-sandbox-qa.csv",
            "dados_extraidos": {
                "tipo_documento": "extrato bancario",
                "saldo_inicial": SALDO_INICIAL,
                "saldo_final": SALDO_FINAL,
                "competencia": COMPETENCIA,
                "observacoes": "Documento sintetico do sandbox QA - saldo sempre confere.",
            },
        },
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"criar_documento_extrato falhou: {r.status_code} {r.text}")
    doc_id = r.json()[0]["id"]
    log(f"  documento extrato criado: {doc_id}")
    return doc_id


def criar_lancamentos(empresa_id: str, documento_id: str):
    for m in MOVS:
        r = requests.post(
            f"{URL}/rest/v1/lancamentos",
            headers=H,
            json={
                "empresa_id": empresa_id,
                "competencia": COMPETENCIA,
                "documento_id": documento_id,
                "data_lancamento": m["data"],
                "valor": m["valor"],
                "descricao": m["descricao"],
                "natureza_movimento": m["tipo"],
                "conta_id": m["conta_id"],
                "historico_id": HIST_RECEB_ID,
                "hist_sci_codigo": HIST_SCI_CODIGO,
                "confidence": 1.0,
                "fonte_extrato": True,
                "conciliado": False,
                "status": "validado",
            },
            timeout=30,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"criar_lancamentos falhou: {r.status_code} {r.text}")
    log(f"  {len(MOVS)} lancamentos criados (todos ja classificados, confidence=1.0)")


def criar_conciliacao(empresa_id: str, extrato_path: str):
    r = requests.post(
        f"{URL}/rest/v1/conciliacoes",
        headers=H,
        json={
            "empresa_id": empresa_id,
            "competencia": COMPETENCIA,
            "status": "em_andamento",
            "extrato_csv_url": extrato_path,
            "divergencias_count": 0,
        },
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"criar_conciliacao falhou: {r.status_code} {r.text}")
    log("  conciliacao (em_andamento, pronta para 'Analisar divergencias') criada")


def main():
    reset_only = "--reset" in sys.argv
    log(f"Saldo inicial: R$ {SALDO_INICIAL:.2f} | movimentacao liquida: R$ {MOV_NET:.2f} | saldo final: R$ {SALDO_FINAL:.2f}")

    empresa_id = buscar_empresa_existente()
    if empresa_id:
        log(f"Empresa sandbox ja existe: {empresa_id}")
    elif reset_only:
        log("ERRO: --reset pedido mas a empresa sandbox nao existe ainda. Rode sem --reset primeiro.")
        sys.exit(1)
    else:
        log("Criando empresa sandbox...")
        empresa_id = criar_empresa()

    log(f"Limpando dados antigos da competencia {COMPETENCIA}...")
    apagar_dados_competencia(empresa_id)

    log("Subindo CSV do extrato...")
    extrato_path = subir_csv(empresa_id)

    log("Criando documento de extrato (com saldo_inicial/saldo_final)...")
    doc_id = criar_documento_extrato(empresa_id)

    log("Criando lancamentos (razao) ja classificados...")
    criar_lancamentos(empresa_id, doc_id)

    log("Criando registro de conciliacao...")
    criar_conciliacao(empresa_id, extrato_path)

    log("")
    log("Pronto! Sandbox QA pronto para uso:")
    log(f"  empresa_id: {empresa_id}")
    log(f"  competencia: {COMPETENCIA}")
    log(f"  URL: /clientes/{empresa_id}  (aba Conciliacao bancaria)")
    log("  Fluxo esperado: Analisar divergencias -> saldo confere=true, faltantes=0 -> Conciliar liberado -> Baixar SCI liberado.")
    log("  Para resetar depois de um teste (ex.: apos editar um lancamento de proposito), rode de novo: python scripts/seed_sandbox_qa.py --reset")


if __name__ == "__main__":
    main()

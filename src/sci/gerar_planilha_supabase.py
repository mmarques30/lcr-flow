"""
src/sci/gerar_planilha_supabase.py
Gera a planilha de importação SCI a partir dos lançamentos no Supabase.

Alinhado ao export do front (src/lib/sci-xls.ts):
  - Contas D/C: plano_de_contas_lcr.apelido (código reduzido, col A PDC)
  - Histórico: historicos_sci_lcr.codigo (apelido histórico desconsiderado)
  - Complemento vazio quando pula_complemento = true
  - Lado débito/crédito: natureza_movimento > sinal valor > tipo conta

Uso:
  python src/sci/gerar_planilha_supabase.py --empresa CAVA --competencia 2026-06
  python src/sci/gerar_planilha_supabase.py --empresa "KIALO" --competencia 2026-05 --banco 657
  python src/sci/gerar_planilha_supabase.py --empresa 12.345.678/0001-90 --competencia 2026-06 --output planilhas/

Requer SUPABASE_URL e SUPABASE_KEY no .env (raiz LCR, lcr-flow/ ou LCR-front/).
Para bypass de RLS: SUPABASE_SERVICE_ROLE_KEY.
"""

import sys
import os
import argparse
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# ── Caminhos ──────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
for _env in (ROOT / ".env", ROOT / "lcr-flow" / ".env", ROOT.parent / "LCR-front" / ".env"):
    if _env.exists():
        load_dotenv(_env)
        ENV_FILE = _env
        break
else:
    ENV_FILE = ROOT / ".env"
    load_dotenv(ENV_FILE)

SUPABASE_URL = (
    os.getenv("SUPABASE_URL")
    or os.getenv("VITE_SUPABASE_URL")
    or ""
).rstrip("/")

SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_KEY")
    or os.getenv("SUPABASE_PUBLISHABLE_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
    or ""
)

TIPOS_DEBITO = {"ativo", "despesa", "custo", "deducoes"}
TIPOS_CREDITO = {"passivo", "receita", "resultado", "patrimonio", "patrimonio_liquido"}

BANCO_PARA_CODIGO = {
    "bradesco": 9,
    "brasil": 7,
    "bb ": 7,
    "caixa": 8,
    "santander": 10,
    "itau": 657,
    "inter": 658,
    "sicoob": 659,
    "sicredi": 775,
    "original": 779,
    "nubank": 821,
    "xp ": 823,
    "c6": 809,
    "stone": 910,
    "pagbank": 946,
    "btg": 1031,
}

COLUNAS_SCI = [
    "DATA",
    "DÉBITO",
    "CRÉDITO",
    "PART DÉB",
    "PART CRED",
    "VALOR",
    "HISTÓRICO",
    "COMPLEMENTO",
    "DOCUMENTO",
    "CENTRO DE CUSTO DÉB",
    "CENTRO DE CUSTO CRED",
]


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }


def sb_get(tabela: str, params: dict) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{tabela}"
    r = requests.get(url, headers=_headers(), params=params, timeout=30)
    if not r.ok:
        raise RuntimeError(f"Supabase erro {r.status_code} em '{tabela}': {r.text[:300]}")
    return r.json()


def buscar_pdc_apelidos() -> dict[int, int]:
    """codigo LCR → código reduzido SCI (plano_de_contas_lcr.apelido)."""
    rows = sb_get("plano_de_contas_lcr", {"select": "codigo,apelido"})
    out: dict[int, int] = {}
    for row in rows:
        cod = row.get("codigo")
        ap = row.get("apelido")
        if cod is not None and ap is not None:
            out[int(cod)] = int(ap)
    return out


def buscar_pdc_tc() -> list[dict]:
    """codigo/classificacao/tipo do Plano de Contas LCR (Anexo 1), para a
    resolução #136 (conta T sintética → filha analítica)."""
    return sb_get("plano_de_contas_lcr", {"select": "codigo,classificacao,tipo"})


def resolver_conta_analitica(codigo, pdc_tc: list[dict]) -> tuple[int | None, str]:
    """Espelha resolverContaAnalitica (src/lib/sci-xls.ts). Retorna
    (codigo_resolvido_ou_None, status) onde status é um de:
    'analitica' (já aceita lançamento), 'resolvido', 'ambigua', 'sem_filha'."""
    try:
        cod = int(codigo)
    except (TypeError, ValueError):
        return None, "analitica"
    conta = next((r for r in pdc_tc if r.get("codigo") == cod), None)
    if not conta or conta.get("tipo") != "T":
        return cod, "analitica"
    prefixo = f"{conta.get('classificacao')}."
    filhas = [
        r for r in pdc_tc
        if r.get("tipo") != "T" and str(r.get("classificacao") or "").startswith(prefixo)
    ]
    if not filhas:
        return None, "sem_filha"
    if len(filhas) == 1:
        return int(filhas[0]["codigo"]), "resolvido"
    return None, "ambigua"


def codigo_para_export_sci(codigo, pdc_tc: list[dict]) -> int | str | None:
    resolvido, status = resolver_conta_analitica(codigo, pdc_tc)
    if status == "resolvido":
        return resolvido
    if status == "analitica":
        return codigo
    return codigo  # ambigua/sem_filha: mantém original — bloqueio fica a cargo do caller


def buscar_historicos_pula_complemento() -> set[str]:
    rows = sb_get("historicos_sci_lcr", {
        "select": "codigo",
        "pula_complemento": "eq.true",
    })
    return {str(r["codigo"]) for r in rows if r.get("codigo") is not None}


def cod_sci_reduzido(codigo_lcr, apelidos: dict[int, int]):
    if codigo_lcr is None:
        return ""
    try:
        c = int(codigo_lcr)
    except (TypeError, ValueError):
        return codigo_lcr
    return apelidos.get(c, c)


def hist_sci_codigo(codigo) -> int | str:
    c = str(codigo or "").strip()
    if not c:
        return ""
    try:
        return int(c)
    except ValueError:
        return c


def _lado_conta(tipo: str) -> str:
    t = (tipo or "").lower()
    for td in TIPOS_DEBITO:
        if td in t:
            return "debito"
    for tc in TIPOS_CREDITO:
        if tc in t:
            return "credito"
    return "debito"


def lado_efetivo(natureza, valor, tipo_conta: str) -> str:
    n = (natureza or "").lower()
    if n.startswith("d"):
        return "debito"
    if n.startswith("c"):
        return "credito"
    if valor is not None:
        try:
            if float(valor) < 0:
                return "debito"
        except (TypeError, ValueError):
            pass
    return _lado_conta(tipo_conta)


def _fmt_data(data_str: str) -> str:
    try:
        return datetime.strptime(str(data_str)[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return str(data_str)


def buscar_empresa(termo: str) -> dict:
    empresas = sb_get("empresas", {
        "select": "id,razao_social,nome_fantasia,cnpj",
        "or": f"(nome_fantasia.ilike.*{termo}*,razao_social.ilike.*{termo}*,cnpj.eq.{termo})",
    })
    if not empresas:
        raise ValueError(f"Empresa nao encontrada: '{termo}'")
    if len(empresas) > 1:
        print(f"  [!] {len(empresas)} empresas encontradas para '{termo}', usando a primeira:")
        for e in empresas:
            print(f"      - {e['razao_social']} ({e['cnpj']})")
    return empresas[0]


def buscar_conta_banco(empresa_id: str) -> int | None:
    """CC nº 1 — mesma regra do front (contas_bancarias[0])."""
    contas = sb_get("contas_bancarias", {
        "select": "banco",
        "empresa_id": f"eq.{empresa_id}",
        "order": "created_at.asc",
        "limit": "1",
    })
    if not contas:
        return None
    banco = (contas[0].get("banco") or "").lower()
    for nome, codigo in BANCO_PARA_CODIGO.items():
        if nome in banco:
            return codigo
    return None


def buscar_lancamentos(empresa_id: str, competencia: str) -> list:
    return sb_get("lancamentos", {
        "select": (
            "id,data_lancamento,valor,descricao,competencia,natureza_movimento,"
            "documento_numero,part_deb,part_cred,"
            "conta:plano_contas(codigo,descricao,tipo),"
            "historico:historicos_contabeis(codigo,descricao)"
        ),
        "empresa_id": f"eq.{empresa_id}",
        "competencia": f"eq.{competencia}",
        "conta_id": "not.is.null",
        "valor": "not.is.null",
        "order": "data_lancamento.asc",
        "limit": "5000",
    })


def gerar_planilha(
    empresa_id: str,
    empresa_nome: str,
    competencia: str,
    conta_banco_codigo: int | None,
    pdc_apelidos: dict[int, int],
    hist_pula: set[str],
    output_dir: Path,
    pdc_tc: list[dict] | None = None,
) -> Path | None:
    print(f"\n  Buscando lancamentos: {empresa_nome} / {competencia} ...")
    lancamentos = buscar_lancamentos(empresa_id, competencia)

    if not lancamentos:
        print("  [!] Nenhum lancamento encontrado.")
        return None

    print(f"  {len(lancamentos)} lancamentos encontrados.")

    sci_banco = cod_sci_reduzido(conta_banco_codigo, pdc_apelidos) if conta_banco_codigo else ""

    linhas = []
    sem_conta = 0
    bloqueados_tc: list[str] = []
    pdc_tc = pdc_tc or []

    for lanc in lancamentos:
        conta = lanc.get("conta") or {}
        historico = lanc.get("historico") or {}

        codigo_lcr = conta.get("codigo")
        tipo_conta = conta.get("tipo") or ""

        if codigo_lcr is None:
            sem_conta += 1
            continue

        # #136: conta sintética (T) resolve para a filha analítica; se ambígua
        # ou sem filha, ignora a linha e reporta para reclassificação manual.
        if pdc_tc:
            _, status_tc = resolver_conta_analitica(codigo_lcr, pdc_tc)
            if status_tc in ("ambigua", "sem_filha"):
                bloqueados_tc.append(f"{codigo_lcr} ({status_tc})")
                continue
            codigo_lcr = codigo_para_export_sci(codigo_lcr, pdc_tc)

        sci_conta = cod_sci_reduzido(codigo_lcr, pdc_apelidos)
        cod_hist = str(historico.get("codigo") or "").strip()
        pula = cod_hist in hist_pula

        valor_raw = lanc.get("valor")
        try:
            valor = abs(float(valor_raw or 0))
        except (TypeError, ValueError):
            valor = 0.0

        lado = lado_efetivo(lanc.get("natureza_movimento"), valor_raw, tipo_conta)
        if lado == "debito":
            debito, credito = sci_conta, sci_banco
        else:
            debito, credito = sci_banco, sci_conta

        linhas.append({
            "DATA": _fmt_data(lanc.get("data_lancamento") or ""),
            "DÉBITO": debito,
            "CRÉDITO": credito,
            "PART DÉB": lanc.get("part_deb") or "",
            "PART CRED": lanc.get("part_cred") or "",
            "VALOR": valor,
            "HISTÓRICO": hist_sci_codigo(cod_hist),
            "COMPLEMENTO": "" if pula else (lanc.get("descricao") or "")[:80],
            "DOCUMENTO": lanc.get("documento_numero") or "",
            "CENTRO DE CUSTO DÉB": "",
            "CENTRO DE CUSTO CRED": "",
        })

    if sem_conta:
        print(f"  [!] {sem_conta} lancamento(s) ignorado(s) por ausencia de conta.")

    if bloqueados_tc:
        print(f"  [!] {len(bloqueados_tc)} lancamento(s) ignorado(s) — conta sintetica (T) sem filha analitica unica:")
        for b in bloqueados_tc[:10]:
            print(f"      - {b}")
        if len(bloqueados_tc) > 10:
            print(f"      ... e mais {len(bloqueados_tc) - 10}")

    if not linhas:
        print("  Nenhuma linha valida para gerar planilha.")
        return None

    df = pd.DataFrame(linhas, columns=COLUNAS_SCI)

    nome_arq = f"{empresa_nome} - Lancamentos {competencia}.xlsx"
    caminho = output_dir / nome_arq

    with pd.ExcelWriter(str(caminho), engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Planilha de importação")
        ws = writer.sheets["Planilha de importação"]
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)

    total = df["VALOR"].sum()
    print(f"  [OK] {nome_arq}")
    print(f"       {len(linhas)} linhas | Total R$ {total:,.2f}")

    return caminho


def main():
    parser = argparse.ArgumentParser(
        description="Gera planilha de importacao SCI a partir dos lancamentos no Supabase",
    )
    parser.add_argument("--empresa", "-e", required=True,
                        help="Nome fantasia, razao social ou CNPJ da empresa")
    parser.add_argument("--competencia", "-c",
                        default=datetime.now().strftime("%Y-%m"),
                        help="Competencia no formato YYYY-MM (default: mes atual)")
    parser.add_argument("--banco", "-b", type=int, default=None,
                        help="Codigo LCR da conta bancaria (ex: 657 = Itau CC#1)")
    parser.add_argument("--output", "-o", default=".",
                        help="Pasta de saida para o XLSX gerado (default: pasta atual)")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERRO] Variaveis SUPABASE_URL / SUPABASE_KEY nao encontradas.")
        print(f"       Verifique o arquivo: {ENV_FILE}")
        sys.exit(1)

    usando_sr = bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    if not usando_sr:
        print("[AVISO] SUPABASE_SERVICE_ROLE_KEY nao encontrado. Usando chave anonima.")
        print("        Se houver erro 401, adicione a service role key ao .env.\n")

    print("=== Gerar Planilha SCI ===")
    print(f"  Empresa    : {args.empresa}")
    print(f"  Competencia: {args.competencia}")

    print("\nCarregando Plano de Contas LCR e historicos SCI...")
    pdc_apelidos = buscar_pdc_apelidos()
    pdc_tc = buscar_pdc_tc()
    hist_pula = buscar_historicos_pula_complemento()
    print(f"  PDC (codigo → reduzido): {len(pdc_apelidos)} contas")
    print(f"  Historicos pula_complemento: {len(hist_pula)}")

    empresa = buscar_empresa(args.empresa)
    print(f"\nEmpresa encontrada: {empresa['razao_social']}")
    print(f"  CNPJ: {empresa['cnpj']}")

    conta_banco = args.banco or buscar_conta_banco(empresa["id"])
    if conta_banco:
        sci_banco = cod_sci_reduzido(conta_banco, pdc_apelidos)
        print(f"  Conta bancaria CC#1: codigo LCR {conta_banco} → reduzido SCI {sci_banco}")
    else:
        print("  Conta bancaria nao identificada automaticamente.")
        print("  Use --banco <codigo> para definir (ex: --banco 657 para Itau).")
        print("  A contrapartida banco ficara em branco.")

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    arquivo = gerar_planilha(
        empresa_id=empresa["id"],
        empresa_nome=empresa.get("nome_fantasia") or empresa["razao_social"],
        competencia=args.competencia,
        conta_banco_codigo=conta_banco,
        pdc_apelidos=pdc_apelidos,
        hist_pula=hist_pula,
        output_dir=output_dir,
        pdc_tc=pdc_tc,
    )

    if arquivo:
        print(f"\nPlanilha salva em: {arquivo.resolve()}")
        print("Proximo passo: importar no SCI via menu Arquivo > Importar Lancamentos")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()

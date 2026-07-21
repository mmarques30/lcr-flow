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
import unicodedata
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

# Fallback local (auditoria 21/07) — usado só se a tabela `bancos_apelidos_lcr`
# não carregar (rede, tabela vazia). A fonte de verdade passou a ser essa
# tabela: dá pra adicionar um banco novo com um INSERT, sem precisar de
# deploy nem sync manual na VPS (ver buscar_apelidos_banco abaixo).
BANCO_PARA_CODIGO_FALLBACK = {
    "bradesco": 9,
    "brasil": 7,
    "bb ": 7,
    "caixa": 8,
    "santander": 10,
    "itau": 657,
    "pagseguro": 946,
    "pagbank": 946,
    "inter": 658,
    "sicoob": 659,
    "sicredi": 775,
    "original": 779,
    "nu pagamentos": 821,
    "nubank": 821,
    "xp ": 823,
    "c6": 809,
    "stone": 910,
    "btg": 1031,
    "safra": 818,
    "cora": 917,
    "mercado pago": 960,
    "wise": 1292,
    "bs2": 830,
    "afinz": 1197,
    "208": 1031,
}


def buscar_apelidos_banco() -> dict[str, int]:
    """Busca os aliases de banco cadastrados em `bancos_apelidos_lcr` (fonte de
    verdade editável sem deploy — auditoria 21/07). Em caso de erro/tabela
    vazia, cai no dicionário fallback embutido no código.
    Espelha buscarApelidosBanco (src/lib/sci-xls.ts)."""
    try:
        rows = sb_get("bancos_apelidos_lcr", {"select": "alias,codigo_lcr"})
    except RuntimeError:
        return dict(BANCO_PARA_CODIGO_FALLBACK)
    out = {r["alias"]: int(r["codigo_lcr"]) for r in rows if r.get("alias") and r.get("codigo_lcr") is not None}
    return out or dict(BANCO_PARA_CODIGO_FALLBACK)

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
    resolução #136 (conta T sintética ou C consolidada → filha analítica)."""
    return sb_get("plano_de_contas_lcr", {"select": "codigo,classificacao,tipo"})


TIPOS_NAO_ANALITICOS = ("T", "C")


def resolver_conta_analitica(codigo, pdc_tc: list[dict]) -> tuple[int | None, str]:
    """Espelha resolverContaAnalitica (src/lib/sci-xls.ts). Retorna
    (codigo_resolvido_ou_None, status) onde status é um de:
    'analitica' (já aceita lançamento), 'resolvido', 'ambigua', 'sem_filha'.
    Trata contas tipo T (sintética) e C (consolidada) da mesma forma —
    nenhuma das duas aceita lançamento direto, só a filha analítica."""
    try:
        cod = int(codigo)
    except (TypeError, ValueError):
        return None, "analitica"
    conta = next((r for r in pdc_tc if r.get("codigo") == cod), None)
    if not conta or conta.get("tipo") not in TIPOS_NAO_ANALITICOS:
        return cod, "analitica"
    prefixo = f"{conta.get('classificacao')}."
    filhas = [
        r for r in pdc_tc
        if r.get("tipo") not in TIPOS_NAO_ANALITICOS and str(r.get("classificacao") or "").startswith(prefixo)
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


def _sem_acento(s: str) -> str:
    """Remove acentos (ex. "Itaú" -> "itau") para comparação tolerante a
    diacríticos. Espelha semAcento (src/lib/sci-xls.ts)."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def _eh_banco_placeholder(banco: str | None) -> bool:
    """Nome de banco "placeholder" — a IA não conseguiu identificar o banco
    no documento original (ex. "Não identificado", "Desconhecido", "N/A").
    Ampliado na auditoria de 21/07: "não disponível"/"não explícito" também
    são placeholders (ex. "Informação não disponível no documento") — antes
    passavam batido e entravam como "conta válida" no _melhor_conta_bancaria,
    às vezes vencendo um registro anterior mais específico (regressão real
    encontrada no cliente PLENUS).
    Espelha ehBancoPlaceholder (src/lib/sci-xls.ts)."""
    t = _sem_acento((banco or "").strip().lower())
    if not t or t == "n/a":
        return True
    return any(
        p in t for p in ("identificado", "especificado", "desconhecido", "informado", "disponivel", "explicito")
    )


def _melhor_conta_bancaria(contas: list[dict]) -> dict | None:
    """Escolhe a conta bancária "mais confiável" entre as cadastradas da
    empresa. Bug 21/07: sempre usava contas_bancarias[0] (a mais ANTIGA
    cadastrada) — se o primeiro documento processado falhou em identificar o
    banco (ex. "Não identificado"), a Planilha SCI ficava com o código do
    banco em branco pra sempre, mesmo com documentos posteriores tendo
    identificado o banco real corretamente (achado no cliente Cultive: 1º
    registro "Não identificado", 2º "Banco Inter", mas o export usava o 1º).
    Espelha melhorContaBancaria (src/lib/sci-xls.ts).

    Fix (code review 20/07): o tie-break por `reduce`/loop dependia da ordem
    de chegada quando `created_at` empatava (ou faltava nos dois lados) — a
    ordem de retorno do Postgres sem `ORDER BY` explícito não é garantida.
    Agora ordena por (created_at, id) antes de escolher, então o resultado
    não depende mais da ordem de chegada."""
    if not contas:
        return None
    validas = [c for c in contas if not _eh_banco_placeholder(c.get("banco"))]
    candidatas = validas if validas else contas
    ordenadas = sorted(candidatas, key=lambda c: (c.get("created_at") or "", str(c.get("id") or "")))
    return ordenadas[-1] if ordenadas else None


def _resolver_codigo_banco(banco_nome: str | None, apelidos: dict[str, int]) -> int | None:
    """Resolve o código LCR a partir do texto livre do banco. Entre vários
    aliases que casam por substring (ex. "inter" dentro de "PagSeguro
    Internet S/A"), escolhe o alias MAIS LONGO — critério robusto contra
    colisão acidental, sem depender da ordem de iteração do dict/tabela
    (achado auditoria 21/07). Espelha bancoCodigoDe (src/lib/sci-xls.ts)."""
    banco = _sem_acento((banco_nome or "").lower())
    melhor_alias = ""
    melhor_codigo: int | None = None
    for nome, codigo in apelidos.items():
        alias = _sem_acento(nome.strip())
        if len(alias) > len(melhor_alias) and alias in banco:
            melhor_alias, melhor_codigo = alias, codigo
    return melhor_codigo


def buscar_conta_banco(empresa_id: str, apelidos: dict[str, int] | None = None) -> int | None:
    """CC nº 1 — mesma regra do front (melhorContaBancaria).
    Bug 21/07: faltava normalizar acento — "Itaú" (cadastro real do cliente)
    nunca casava com a chave "itau" do dicionário, deixando o código do banco
    em branco na Planilha SCI mesmo com o nome aparecendo corretamente."""
    contas = sb_get("contas_bancarias", {
        "select": "id,banco,created_at",
        "empresa_id": f"eq.{empresa_id}",
    })
    melhor = _melhor_conta_bancaria(contas)
    if not melhor:
        return None
    return _resolver_codigo_banco(melhor.get("banco"), apelidos or buscar_apelidos_banco())


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

        # #136: conta sintética (T) ou consolidada (C) resolve para a filha
        # analítica; se ambígua ou sem filha, ignora a linha e reporta para
        # reclassificação manual.
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
        print(f"  [!] {len(bloqueados_tc)} lancamento(s) ignorado(s) — conta sintetica/consolidada (T/C) sem filha analitica unica:")
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

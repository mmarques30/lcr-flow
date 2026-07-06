"""
src/parsers/extrato_bancario.py

Parsers para extratos dos principais bancos.
Retorna lista padronizada de transações para o motor IA.

Formato de saída:
[{
    'data': 'YYYY-MM-DD',
    'descricao': str,
    'valor': float,
    'tipo': 'debito' | 'credito'
}]
"""

import pandas as pd
import pdfplumber
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def _parse_valor(v):
    """Converte valor de célula Excel para float. Se pandas já leu como número,
    usa direto (não bagunça separador decimal). Se veio string em formato BR
    (1.234,56), interpreta corretamente."""
    import pandas as _pd
    if _pd.isna(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    return float(s.replace('.', '').replace(',', '.'))



# ─────────────────────────────────────────────
# Detecção automática de banco e formato
# ─────────────────────────────────────────────

def detectar_banco(caminho: str) -> str:
    """Tenta identificar o banco pelo nome do arquivo ou pelo conteúdo (PDF)."""
    nome = Path(caminho).name.lower()

    mapeamento_nome = {
        'itau': 'itau',
        'bradesco': 'bradesco',
        'santander': 'santander',
        'bb': 'banco_brasil',
        'brasil': 'banco_brasil',
        'caixa': 'caixa',
        'inter': 'inter',
        'nubank': 'nubank',
        'sicoob': 'sicoob',
        'sicredi': 'sicredi',
        'btg': 'btg',
        'xp': 'xp',
        'c6': 'c6',
        'original': 'original',
    }

    for chave, banco in mapeamento_nome.items():
        if chave in nome:
            return banco

    # Para PDF, tenta detectar pelo conteúdo
    if Path(caminho).suffix.lower() == '.pdf':
        try:
            with pdfplumber.open(caminho) as pdf:
                texto = (pdf.pages[0].extract_text() or '').lower()
            mapeamento_conteudo = {
                'itau': 'itau',
                'bradesco': 'bradesco',
                'santander': 'santander',
                'banco do brasil': 'banco_brasil',
                'caixa economica': 'caixa',
                'inter ': 'inter',
                'nubank': 'nubank',
                'sicoob': 'sicoob',
                'sicredi': 'sicredi',
                'btg pactual': 'btg',
            }
            for chave, banco in mapeamento_conteudo.items():
                if chave in texto:
                    return banco
        except Exception:
            pass

    return 'desconhecido'


# Identidade do extrato (banco+agência+conta) p/ dedup por conteúdo — o cabeçalho
# que o parser normalmente descarta. Best-effort por layout; onde não achar, retorna
# None (o caller então NÃO deduplica por identidade). Cobre rótulos completos
# ('Agência:'/'Conta:') e abreviados ('ag 4465'/'cc 33033-2').
_PATS_AGENCIA = [r"ag[eê]nc\w*\.?\s*[:\-]?\s*0*(\d{2,6})", r"\bag\.?\s*[:\-]?\s+0*(\d{3,6})"]
_PATS_CONTA = [r"\bconta\s*(?:corrente)?\s*[:\-]?\s*(\d[\d.\-]{2,})",
               r"\bc\.?\s*/?\s*c\.?\s*[:\-]?\s+(\d[\d.\-]{2,})"]


def _so_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _primeiro_match(pats, texto):
    for p in pats:
        m = re.search(p, texto, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def extrair_identidade(caminho: str, banco: str = None) -> dict:
    """Extrai (banco, agencia, conta) do CABEÇALHO do extrato p/ chave de dedup.
    Lê só o topo (1ª página do PDF / 1ªs linhas do Excel/CSV). agência/conta são
    normalizadas a só-dígitos SEM zeros à esquerda (ex.: '0033033-2' e '33033-2'
    → '330332'). banco deve vir do caller (o nome do tempfile não tem o banco);
    fallback p/ detectar_banco. Best-effort: campos não achados voltam None."""
    ext = Path(caminho).suffix.lower()
    texto = ""
    try:
        if ext == ".pdf":
            with pdfplumber.open(caminho) as pdf:
                # só o CABEÇALHO (1ªs linhas) — evita casar 'agência/conta' que
                # aparecem no corpo (descrições, rodapé) e pegar o número errado.
                texto = "\n".join((pdf.pages[0].extract_text() or "").splitlines()[:6])
        elif ext in (".xlsx", ".xls") and not _e_html(caminho):
            eng = "xlrd" if ext == ".xls" else "openpyxl"
            df = pd.read_excel(caminho, engine=eng, sheet_name=0, header=None, dtype=str, nrows=15)
            texto = df.to_string()
        else:  # csv / html / .xls-que-é-html → primeiros bytes como texto
            with open(caminho, "rb") as fh:
                texto = fh.read(4096).decode("utf-8", "ignore")
    except Exception:
        texto = ""
    ag = _primeiro_match(_PATS_AGENCIA, texto)
    ct = _primeiro_match(_PATS_CONTA, texto)
    ag = _so_digitos(ag).lstrip("0") or None if ag else None
    ct = _so_digitos(ct).lstrip("0") or None if ct else None
    return {
        "banco": ((banco or detectar_banco(caminho)) or "").lower() or None,
        "agencia": ag,
        "conta": ct,
    }


def chave_extrato(identidade: dict, competencia: str) -> str:
    """Chave canônica de dedup: 'agencia|conta|AAAA-MM'. O nº de conta (agência+
    conta) já identifica o banco univocamente DENTRO de um cliente (a checagem é
    escopada por empresa), então o banco não entra na chave — a detecção de banco
    varia por layout e quebraria o match (ex.: o mesmo extrato Itaú vem sem 'itau'
    numa das versões). Retorna None se agência OU conta faltarem (sem identidade
    confiável → não deduplica; o backstop por sobreposição cobre)."""
    if not identidade:
        return None
    ag = identidade.get("agencia")
    ct = identidade.get("conta")
    comp = (competencia or "")[:7]
    if not (ag and ct and len(comp) == 7):
        return None
    return f"{ag}|{ct}|{comp}"


def parsear_extrato(caminho: str, banco: str = None, competencia: str = None) -> list:
    """
    Ponto de entrada principal. Detecta o formato e parseia.
    Retorna lista padronizada de transações.
    `competencia` (AAAA-MM) ajuda a escolher a aba certa em planilhas multi-aba.
    """
    if banco is None:
        banco = detectar_banco(caminho)

    extensao = Path(caminho).suffix.lower()

    print(f"Parseando extrato: {Path(caminho).name} (banco: {banco}, formato: {extensao})")

    if extensao in ['.xlsx', '.xls']:
        tr = parsear_excel(caminho, competencia)
    elif extensao == '.pdf':
        tr = parsear_pdf(caminho, banco)
    else:
        raise ValueError(f"Formato não suportado: {extensao}")

    # Varredura de aplicação automática (Itaú "APL/RES APLIC AUT MAIS" e afins):
    # o banco aplica o saldo ocioso à noite e resgata de manhã — o par se anula no
    # ciclo (~zero) e polui a razão com dezenas de linhas. Decisão contábil: não é
    # movimento econômico → filtrar. Preserva 'RENDIMENTOS REND PAGO APLIC' (renda
    # real) e 'APLICACAO CDB DI'/aplicações deliberadas (sem 'automática').
    antes_aa = len(tr)
    tr = [t for t in tr if not FILTRO_APLIC_AUTO.search(t.get('descricao') or '')]
    if len(tr) != antes_aa:
        print(f"  Filtro aplicação automática: {antes_aa - len(tr)} linha(s) de APL/RES automático descartada(s)")

    # Filtro de janela de competência aplicado AQUI (ponto único por onde TODOS os
    # formatos passam) → cobre Excel E PDF, e qualquer banco. Elimina contaminação
    # de extratos multi-ano/multi-mês (linhas de anos alheios na competência).
    if competencia:
        tr, n_desc = _filtrar_janela_competencia(tr, competencia)
        if n_desc:
            print(f"  Filtro de competência {competencia}: {n_desc} transação(ões) fora da janela descartada(s)")
    return tr


# ─────────────────────────────────────────────
# Parser Excel (genérico p/ qualquer banco — detecção de coluna por NOME)
# ─────────────────────────────────────────────

def _sem_acento(s: str) -> str:
    """minúsculas sem acento — casamento de cabeçalho robusto a acentuação
    (bancos escrevem 'historico'/'credito'/'debito'/'saida' sem acento)."""
    return "".join(c for c in unicodedata.normalize("NFKD", str(s).strip().lower())
                   if not unicodedata.combining(c))


def _idx_coluna(colunas, termos, excluir=(), default=None):
    """Índice POSICIONAL da 1ª coluna cujo cabeçalho contém algum de `termos`
    e nenhum de `excluir`. Case-insensitive E acento-insensitive (senão 'histór'
    não casava 'historico' → descrição perdida → transações distintas colapsavam
    como duplicata). Robusto a layouts que inserem/removem colunas. Retorna
    `default` se não encontrar."""
    termos = [_sem_acento(t) for t in termos]
    excluir = [_sem_acento(e) for e in excluir]
    for i, c in enumerate(colunas):
        h = _sem_acento(c)
        if any(t in h for t in termos) and not any(e in h for e in excluir):
            return i
    return default


def _parsear_planilha_df(df) -> list:
    """Parser UNIVERSAL de uma planilha (dataframe lido com header=None). Detecta
    colunas por NOME e cobre os 3 esquemas de valor dos bancos BR — sem função
    por banco:
      (a) coluna única 'valor' COM SINAL (ex.: Itaú);
      (b) colunas SEPARADAS 'crédito'/'débito' (ex.: Bradesco, BB);
      (c) 'valor' + indicador 'D/C'/'tipo' (ex.: Santander).
    Retorna [] se não achar cabeçalho OU nenhum esquema de valor (data + valor/
    crédito/débito) — o caller então roteia p/ a edge (IA). SEM default posicional
    (chutar 0/1/2 foi a raiz do bug 'R$ 7 bi')."""
    header_row = None
    for i, row in df.iterrows():
        valores = [str(v).strip().lower() for v in row.values if pd.notna(v)]
        if any('data' in v for v in valores):
            header_row = i
            break
    if header_row is None:
        return []

    colunas = list(df.iloc[header_row])
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    df = df.dropna(how='all')

    i_data    = _idx_coluna(colunas, ('data',))
    i_desc    = _idx_coluna(colunas, ('histór', 'descri', 'lanç', 'moviment', 'memo'))
    # Crédito/débito cobrem os nomes usados pelos bancos BR: crédito/débito
    # (Bradesco/BB) e entradas/saídas (Itaú "extrato comentado").
    i_credito = _idx_coluna(colunas, ('créd', 'cred', 'entrada'))
    i_debito  = _idx_coluna(colunas, ('déb', 'deb', 'saída', 'saida'))
    i_valor   = _idx_coluna(colunas, ('valor', 'amount'), excluir=('saldo',))
    i_dc      = _idx_coluna(colunas, ('d/c', 'tipo', 'natur'))

    # Coluna combinada "Entradas / Saídas" casa 'entrada' E 'saída' no MESMO índice:
    # NÃO é par separado, é coluna única com sinal (+=entrada, -=saída). Sem isto,
    # cada linha viraria 2 lançamentos (crédito+débito da mesma célula) → razão dobrada.
    if i_credito is not None and i_credito == i_debito:
        if i_valor is None:
            i_valor = i_credito
        i_credito = i_debito = None

    # 'Data de lançamento' casa 'lanç' e rouba o i_desc do campo de data. Se a
    # descrição colidir com a data, redetecta só pelos nomes fortes de descrição
    # (que não casam a coluna de data).
    if i_desc is not None and i_desc == i_data:
        i_desc = _idx_coluna(colunas, ('descri', 'histór', 'moviment', 'memo'))

    # Esquema de valor: par crédito/débito em colunas separadas vs coluna única
    # 'valor'. Usa cred/déb quando há o PAR, ou quando há um dos lados e NÃO há
    # 'valor' (evita falso-positivo quando existe 'valor' + coluna que casa
    # 'entrada/saída' por acaso).
    usar_credeb = (i_credito is not None and i_debito is not None) or \
                  ((i_credito is not None or i_debito is not None) and i_valor is None)
    if i_data is None or not (usar_credeb or i_valor is not None):
        return []  # layout não reconhecido → caller roteia p/ edge/revisão

    def _cel(row, idx):
        return str(row.iloc[idx]).strip() if idx is not None else ""

    transacoes = []
    for _, row in df.iterrows():
        try:
            data_raw = _cel(row, i_data)
            if not data_raw or data_raw == 'nan':
                continue
            data = normalizar_data(data_raw)
            descricao = _cel(row, i_desc)

            # (b) crédito/débito (ou entradas/saídas) em colunas separadas → 1-2 lançamentos
            if usar_credeb:
                cred = _parse_valor(row.iloc[i_credito]) if i_credito is not None else None
                deb  = _parse_valor(row.iloc[i_debito])  if i_debito  is not None else None
                cred = abs(cred) if cred else 0.0
                deb  = abs(deb) if deb else 0.0
                if cred > 0:
                    transacoes.append({'data': data, 'descricao': descricao, 'valor': cred, 'tipo': 'credito'})
                if deb > 0:
                    transacoes.append({'data': data, 'descricao': descricao, 'valor': deb, 'tipo': 'debito'})
                continue

            # (a)/(c) coluna única de valor: sinal manda; D/C só desempata positivos.
            valor = _parse_valor(row.iloc[i_valor])
            if valor is None:
                continue
            if valor < 0:
                tipo = 'debito'
            elif i_dc is not None:
                dc = _cel(row, i_dc).upper()
                tipo = 'debito' if dc in ('D', 'DEB', 'DÉBITO', 'DEBITO') else 'credito'
            else:
                tipo = 'credito'
            transacoes.append({'data': data, 'descricao': descricao, 'valor': abs(valor), 'tipo': tipo})
        except (ValueError, IndexError):
            continue
    return transacoes


def _competencia_ym(competencia):
    """Normaliza competência p/ (ano, mes) como strings. Aceita AAAA-MM ou MM/AAAA."""
    c = str(competencia or "").replace("/", "-")
    p = [x for x in c.split("-") if x]
    if len(p) >= 2 and len(p[0]) == 4:
        return p[0], p[1].zfill(2)
    if len(p) >= 2:
        return p[1], p[0].zfill(2)
    return None, None


def _filtrar_janela_competencia(transacoes, competencia, meses=1):
    """Mantém só transações a ±`meses` do mês da competência (índice absoluto
    ano*12+mes, robusto à virada dez↔jan). Elimina contaminação de planilhas
    Excel multi-ANO (ex.: aba única com linhas de 2024/2025 num extrato de 2026).
    No-op se a competência não resolver. Se TODAS caírem fora da janela (arquivo
    do período errado), devolve vazio e avisa — NÃO re-admite as transações fora
    da janela (isso reintroduziria a contaminação). Retorna (filtradas, n_descartadas)."""
    ano, mes = _competencia_ym(competencia)
    if not ano:
        return transacoes, 0
    alvo = int(ano) * 12 + int(mes)
    mantidas = []
    for t in transacoes:
        ym = (t.get('data') or '')[:7]
        try:
            y, m = ym.split('-')
            idx = int(y) * 12 + int(m)
        except (ValueError, AttributeError):
            mantidas.append(t)  # sem data legível → conservador, mantém
            continue
        if abs(idx - alvo) <= meses:
            mantidas.append(t)
    n_desc = len(transacoes) - len(mantidas)
    if transacoes and not mantidas:
        # Nenhuma na janela: arquivo do período errado (ou competência ausente do
        # arquivo). Devolve vazio → o caller trata (0 transações → revisão/edge).
        print(f"  AVISO: NENHUMA das {len(transacoes)} transações está na janela de "
              f"{competencia} — arquivo possivelmente do período errado; descartando todas.")
    return mantidas, n_desc


def _e_html(caminho: str) -> bool:
    """True se o arquivo é HTML (muitos bancos exportam .xls/.xlsx que na verdade
    são HTML — xlrd/openpyxl quebram neles)."""
    try:
        with open(caminho, "rb") as fh:
            ini = fh.read(512).lstrip().lower()
    except Exception:
        return False
    return ini.startswith(b"<") or b"<html" in ini or b"<table" in ini


def _parsear_html(caminho: str) -> list:
    """Lê extrato que é HTML disfarçado de Excel. Usa read_html, roda cada tabela
    pelo MESMO parser universal (_parsear_planilha_df) e devolve a que rende mais
    transações."""
    try:
        # thousands=None desliga a conversão de milhar do read_html (padrão ','),
        # que senão mangleria valores BR: "-50,00" viraria "-5000". Assim as células
        # ficam string crua ("1.234,56", "-50,00") e o _parse_valor faz a conversão
        # BR correta por célula. (bug pego em teste local.)
        tabelas = pd.read_html(caminho, thousands=None)
    except Exception:
        return []
    melhor = []
    for df in tabelas:
        try:
            tr = _parsear_planilha_df(df)
        except Exception:
            tr = []
        if len(tr) > len(melhor):
            melhor = tr
    print(f"  Excel-HTML: {len(melhor)} transações extraídas")
    return melhor


def parsear_excel(caminho: str, competencia: str = None) -> list:
    """Parseia extrato em Excel (genérico p/ qualquer banco; detecção de coluna
    por NOME). Trata também .xls/.xlsx que são HTML disfarçado (export BR). Se o
    arquivo tiver VÁRIAS abas (ex.: planilha anual, uma aba por mês) e `competencia`
    for informada, escolhe a aba cujas transações mais casam com a competência
    (AAAA-MM). O filtro fino de janela de competência é aplicado em parsear_extrato
    (ponto único que cobre Excel e PDF)."""
    if _e_html(caminho):
        return _parsear_html(caminho)

    engine = 'xlrd' if caminho.endswith('.xls') else 'openpyxl'
    try:
        sheets = pd.ExcelFile(caminho, engine=engine).sheet_names
    except Exception:
        sheets = [0]

    if len(sheets) <= 1 or not competencia:
        df = pd.read_excel(caminho, engine=engine, sheet_name=(sheets[0] if sheets else 0), header=None)
        tr = _parsear_planilha_df(df)
        print(f"  Excel: {len(tr)} transações extraídas")
        return tr

    # Multi-aba + competência: pontua cada aba e escolhe a que melhor casa
    # (mês exato > mesmo ano > mais transações).
    alvo_ano, alvo_mes = _competencia_ym(competencia)
    alvo_ym = f"{alvo_ano}-{alvo_mes}" if alvo_ano else None
    melhor, melhor_score, melhor_sh = [], -1, None
    for sh in sheets:
        try:
            tr = _parsear_planilha_df(pd.read_excel(caminho, engine=engine, sheet_name=sh, header=None))
        except Exception:
            tr = []
        n_ym = sum(1 for t in tr if (t.get('data') or '')[:7] == alvo_ym) if alvo_ym else 0
        n_ano = sum(1 for t in tr if (t.get('data') or '')[:4] == alvo_ano) if alvo_ano else 0
        score = n_ym * 10000 + n_ano * 100 + len(tr)
        if score > melhor_score:
            melhor, melhor_score, melhor_sh = tr, score, sh
    print(f"  Excel (multi-aba): aba '{melhor_sh}' escolhida p/ competência {competencia} — {len(melhor)} transações")
    return melhor




# ─────────────────────────────────────────────
# Parser PDF
# ─────────────────────────────────────────────

FILTROS_SALDO = re.compile(
    r'(saldo\s+(anterior|total|dispon|period|atual|dia|final|inici|aplic|movimenta|bloq|invest)|'
    r'saldo\s*$|total\s+dispon)',
    re.IGNORECASE
)
_DATA_RE = re.compile(r'^\d{2}/\d{2}/\d{2,4}$')
_VALOR_RE = re.compile(r'^-?[\d.]+,\d{2}$')

# Aplicação automática (aplica saldo ocioso à noite / resgata de manhã — net ~zero).
# Pega 'APL APLIC AUT MAIS' / 'RES APLIC AUT MAIS' e 'APLICACAO/RESGATE AUTOMÁTICA';
# NÃO pega 'RENDIMENTOS REND PAGO APLIC' (renda real) nem 'APLICACAO CDB DI' (aplicação
# deliberada, sem 'automática').
FILTRO_APLIC_AUTO = re.compile(
    r'^\s*(apl|res)\b.*aplic\.?\s*aut\.?\s*mais\b'
    r'|^\s*(aplicac|aplicaç|resgate)\w*\s+autom',
    re.IGNORECASE
)


def parsear_pdf(caminho: str, banco: str) -> list:
    """
    Extrai transações de PDF de extrato bancário.
    Usa extração por coordenadas de palavra (extract_words) para capturar
    entradas multi-linha onde data/valor e descrição estão em Y diferentes.
    """
    parsers_especificos = {
        'itau': _parsear_pdf_itau,
    }
    parser = parsers_especificos.get(banco, _parsear_pdf_generico)
    transacoes = parser(caminho)
    print(f"  PDF ({banco}): {len(transacoes)} transações extraídas")
    return transacoes


def _agrupar_palavras_por_y(words, tolerancia=4):
    """Agrupa palavras por Y-coordinate com tolerância, retorna dict {y: [words]}."""
    grupos = defaultdict(list)
    for w in words:
        y_key = round(w['top'] / tolerancia) * tolerancia
        grupos[y_key].append(w)
    return grupos


def _parsear_pdf_itau(caminho: str) -> list:
    """
    Parser específico para extratos Itaú PDF.
    Layout de colunas: Data (x<80) | Descrição (x≈96) | Valor (x>400)
    Suporta entradas multi-linha onde descrição está em Y adjacente ao da data/valor.
    """
    transacoes = []

    with pdfplumber.open(caminho) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=3, y_tolerance=3)
            grupos = _agrupar_palavras_por_y(words, tolerancia=4)
            y_keys = sorted(grupos.keys())

            for yi, y in enumerate(y_keys):
                ws = sorted(grupos[y], key=lambda w: w['x0'])

                # Precisa ter uma data na coluna esquerda (x < 80)
                date_words = [w for w in ws if w['x0'] < 80 and _DATA_RE.match(w['text'])]
                if not date_words:
                    continue

                data_raw = date_words[0]['text']

                # Valor: palavra mais à direita matching VALOR_RE
                value_words = [w for w in ws if _VALOR_RE.match(w['text'])]
                if not value_words:
                    continue
                valor_word = max(value_words, key=lambda w: w['x0'])
                valor_raw = valor_word['text']

                # Descrição: palavras na coluna do meio (x entre 80 e valor_word.x0 - 5)
                desc_meio = [
                    w for w in ws
                    if w['x0'] >= 80 and w['x0'] < valor_word['x0'] - 5
                    and w not in date_words
                ]
                desc_parts = [' '.join(w['text'] for w in desc_meio)] if desc_meio else []

                if not desc_parts:
                    # Multi-linha: busca descrição nas Y adjacentes (± 20px)
                    prev_y_last = y
                    for prev_y in reversed(y_keys[:yi]):
                        if prev_y_last - prev_y > 10:
                            break
                        prev_ws = sorted(grupos[prev_y], key=lambda w: w['x0'])
                        has_own_date = any(
                            w['x0'] < 80 and _DATA_RE.match(w['text']) for w in prev_ws
                        )
                        if has_own_date:
                            break
                        prev_desc = [w for w in prev_ws if w['x0'] >= 80]
                        if prev_desc:
                            desc_parts.insert(0, ' '.join(w['text'] for w in prev_desc))
                        prev_y_last = prev_y

                    next_y_last = y
                    for next_y in y_keys[yi + 1:]:
                        if next_y - next_y_last > 10:
                            break
                        next_ws = sorted(grupos[next_y], key=lambda w: w['x0'])
                        has_own_date = any(
                            w['x0'] < 80 and _DATA_RE.match(w['text']) for w in next_ws
                        )
                        if has_own_date:
                            break
                        next_desc = [w for w in next_ws if w['x0'] >= 80]
                        if next_desc:
                            desc_parts.append(' '.join(w['text'] for w in next_desc))
                        next_y_last = next_y

                descricao = ' '.join(desc_parts).strip()
                if not descricao or FILTROS_SALDO.search(descricao):
                    continue

                try:
                    valor = float(valor_raw.replace('.', '').replace(',', '.'))
                    data = normalizar_data(data_raw)
                    transacoes.append({
                        'data': data,
                        'descricao': descricao,
                        'valor': abs(valor),
                        'tipo': 'debito' if valor < 0 else 'credito'
                    })
                except ValueError:
                    continue

    return transacoes


def _parsear_pdf_generico(caminho: str) -> list:
    """
    Fallback para bancos sem parser específico.
    Usa extract_text() linha a linha com regex.
    """
    with pdfplumber.open(caminho) as pdf:
        texto_completo = '\n'.join(page.extract_text() or '' for page in pdf.pages)

    padrao = r'(\d{2}/\d{2}/\d{2,4})\s+(.+?)\s+([-]?[\d.,]+)\s*$'
    transacoes = []

    for linha in texto_completo.split('\n'):
        match = re.search(padrao, linha.strip())
        if match:
            try:
                data_raw, descricao, valor_raw = match.groups()
                descricao = descricao.strip()
                if FILTROS_SALDO.search(descricao):
                    continue
                valor = float(valor_raw.replace('.', '').replace(',', '.'))
                data = normalizar_data(data_raw)
                transacoes.append({
                    'data': data,
                    'descricao': descricao,
                    'valor': abs(valor),
                    'tipo': 'debito' if valor < 0 else 'credito'
                })
            except ValueError:
                continue

    return transacoes


# ─────────────────────────────────────────────
# Utilitários
# ─────────────────────────────────────────────

def normalizar_data(data_raw: str) -> str:
    """Converte qualquer formato de data para YYYY-MM-DD."""
    data_raw = str(data_raw).strip()

    formatos = [
        '%d/%m/%Y', '%d/%m/%y',
        '%Y-%m-%d', '%d-%m-%Y',
        '%d.%m.%Y', '%d.%m.%y',
        '%Y%m%d'
    ]

    for fmt in formatos:
        try:
            dt = datetime.strptime(data_raw[:10], fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue

    raise ValueError(f"Data não reconhecida: {data_raw}")


# ─────────────────────────────────────────────
# Teste local
# ─────────────────────────────────────────────

if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        caminho = sys.argv[1]
        banco = sys.argv[2] if len(sys.argv) > 2 else None
        transacoes = parsear_extrato(caminho, banco)
        print(f"\nTotal: {len(transacoes)} transações")
        for t in transacoes[:5]:
            print(f"  {t['data']} | {t['tipo']:7} | R$ {t['valor']:10.2f} | {t['descricao'][:50]}")
    else:
        print("Uso: python3 extrato_bancario.py <caminho_arquivo> [banco]")
        print("Bancos suportados: itau, bradesco, santander, banco_brasil, caixa, inter")

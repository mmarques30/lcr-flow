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


def parsear_extrato(caminho: str, banco: str = None) -> list:
    """
    Ponto de entrada principal. Detecta o formato e parseia.
    Retorna lista padronizada de transações.
    """
    if banco is None:
        banco = detectar_banco(caminho)

    extensao = Path(caminho).suffix.lower()

    print(f"Parseando extrato: {Path(caminho).name} (banco: {banco}, formato: {extensao})")

    if extensao in ['.xlsx', '.xls']:
        return parsear_excel(caminho, banco)
    elif extensao == '.pdf':
        return parsear_pdf(caminho, banco)
    else:
        raise ValueError(f"Formato não suportado: {extensao}")


# ─────────────────────────────────────────────
# Parsers Excel por banco
# ─────────────────────────────────────────────

def parsear_excel(caminho: str, banco: str) -> list:
    """Parseia extrato em Excel conforme layout do banco."""

    parsers_excel = {
        'itau': parsear_itau_excel,
        'bradesco': parsear_bradesco_excel,
        'santander': parsear_santander_excel,
        'banco_brasil': parsear_bb_excel,
        'caixa': parsear_caixa_excel,
        'inter': parsear_inter_excel,
    }

    parser = parsers_excel.get(banco)
    if parser:
        return parser(caminho)
    else:
        # Fallback genérico para bancos não mapeados
        return parsear_excel_generico(caminho)


def _idx_coluna(colunas, termos, excluir=(), default=None):
    """Índice POSICIONAL da 1ª coluna cujo cabeçalho contém algum de `termos`
    e nenhum de `excluir` (case-insensitive). Torna o parser robusto a layouts
    que inserem/removem colunas (ex.: alguns exports do Itaú têm 'Documento'
    entre Histórico e Valor). Retorna `default` se não encontrar."""
    for i, c in enumerate(colunas):
        h = str(c).strip().lower()
        if any(t in h for t in termos) and not any(e in h for e in excluir):
            return i
    return default


def parsear_itau_excel(caminho: str) -> list:
    """
    Layout típico do Itaú:
    Linha de cabeçalho variável, colunas: Data | Descrição | Valor | Saldo
    O valor já vem com sinal (negativo = débito)
    """
    df = pd.read_excel(caminho, engine='xlrd' if caminho.endswith('.xls') else 'openpyxl',
                       header=None)

    # Localiza a linha de cabeçalho procurando por "Data"
    header_row = None
    for i, row in df.iterrows():
        valores = [str(v).strip().lower() for v in row.values if pd.notna(v)]
        if any('data' in v for v in valores):
            header_row = i
            break

    if header_row is None:
        return parsear_excel_generico(caminho)

    colunas = list(df.iloc[header_row])
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    df = df.dropna(how='all')

    # Localiza colunas por nome (layouts do Itaú variam: alguns exports têm
    # "Documento" entre Histórico e Valor, deslocando as posições fixas).
    i_data  = _idx_coluna(colunas, ('data',), default=0)
    i_desc  = _idx_coluna(colunas, ('histór', 'descri', 'lanç', 'moviment'), default=1)
    i_valor = _idx_coluna(colunas, ('valor',), excluir=('saldo',), default=2)

    transacoes = []
    for _, row in df.iterrows():
        try:
            data_raw = str(row.iloc[i_data]).strip()
            descricao = str(row.iloc[i_desc]).strip()
            valor_raw = row.iloc[i_valor]

            if pd.isna(valor_raw) or not data_raw or data_raw == 'nan':
                continue

            data = normalizar_data(data_raw)
            valor = _parse_valor(valor_raw)

            transacoes.append({
                'data': data,
                'descricao': descricao,
                'valor': abs(valor),
                'tipo': 'debito' if valor < 0 else 'credito'
            })
        except (ValueError, IndexError):
            continue

    print(f"  Itaú Excel: {len(transacoes)} transações extraídas")
    return transacoes


def parsear_bradesco_excel(caminho: str) -> list:
    """
    Layout típico do Bradesco:
    Colunas: Data | Histórico | Docto | Crédito(R$) | Débito(R$) | Saldo(R$)
    Créditos e Débitos em colunas separadas
    """
    df = pd.read_excel(caminho, engine='xlrd' if caminho.endswith('.xls') else 'openpyxl',
                       header=None)

    header_row = None
    for i, row in df.iterrows():
        valores = [str(v).strip().lower() for v in row.values if pd.notna(v)]
        if 'histórico' in valores or 'historico' in valores:
            header_row = i
            break

    if header_row is None:
        return parsear_excel_generico(caminho)

    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    df = df.dropna(how='all')

    colunas = list(df.columns)
    i_data = _idx_coluna(colunas, ('data',), default=0)
    i_desc = _idx_coluna(colunas, ('histór', 'descri', 'lanç', 'moviment'), default=1)

    transacoes = []
    for _, row in df.iterrows():
        try:
            data_raw = str(row.iloc[i_data]).strip()
            if not data_raw or data_raw == 'nan':
                continue

            descricao = str(row.iloc[i_desc]).strip()

            # Identifica colunas de crédito e débito
            credito = 0.0
            debito = 0.0
            for col in row.index:
                col_lower = str(col).lower()
                if 'créd' in col_lower or 'cred' in col_lower:
                    v = row[col]
                    if pd.notna(v):
                        credito = _parse_valor(v)
                elif 'déb' in col_lower or 'deb' in col_lower:
                    v = row[col]
                    if pd.notna(v):
                        debito = _parse_valor(v)

            data = normalizar_data(data_raw)

            if credito > 0:
                transacoes.append({
                    'data': data,
                    'descricao': descricao,
                    'valor': credito,
                    'tipo': 'credito'
                })
            if debito > 0:
                transacoes.append({
                    'data': data,
                    'descricao': descricao,
                    'valor': debito,
                    'tipo': 'debito'
                })

        except (ValueError, IndexError):
            continue

    print(f"  Bradesco Excel: {len(transacoes)} transações extraídas")
    return transacoes


def parsear_santander_excel(caminho: str) -> list:
    """
    Layout típico do Santander:
    Colunas: Data | Descrição | Valor | Tipo (D/C) | Saldo
    """
    df = pd.read_excel(caminho, engine='xlrd' if caminho.endswith('.xls') else 'openpyxl',
                       header=None)

    header_row = None
    for i, row in df.iterrows():
        valores = [str(v).strip().lower() for v in row.values if pd.notna(v)]
        if 'descrição' in valores or 'descricao' in valores:
            header_row = i
            break

    if header_row is None:
        return parsear_excel_generico(caminho)

    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    df = df.dropna(how='all')

    colunas = list(df.columns)
    i_data  = _idx_coluna(colunas, ('data',), default=0)
    i_desc  = _idx_coluna(colunas, ('descri', 'histór', 'lanç', 'moviment'), default=1)
    i_valor = _idx_coluna(colunas, ('valor',), excluir=('saldo',), default=2)

    transacoes = []
    for _, row in df.iterrows():
        try:
            data_raw = str(row.iloc[i_data]).strip()
            if not data_raw or data_raw == 'nan':
                continue

            descricao = str(row.iloc[i_desc]).strip()
            valor_raw = row.iloc[i_valor]

            if pd.isna(valor_raw):
                continue

            valor = abs(_parse_valor(valor_raw))

            # Santander geralmente tem coluna D/C
            tipo = 'credito'
            for col in row.index:
                if str(col).upper() in ['D/C', 'TIPO', 'NAT']:
                    v = str(row[col]).strip().upper()
                    tipo = 'debito' if v in ['D', 'DEB', 'DÉBITO'] else 'credito'
                    break
            else:
                # Se não tem coluna D/C, usa o sinal do valor original
                valor_original = _parse_valor(valor_raw)
                tipo = 'debito' if valor_original < 0 else 'credito'

            data = normalizar_data(data_raw)
            transacoes.append({
                'data': data,
                'descricao': descricao,
                'valor': valor,
                'tipo': tipo
            })

        except (ValueError, IndexError):
            continue

    print(f"  Santander Excel: {len(transacoes)} transações extraídas")
    return transacoes


def parsear_bb_excel(caminho: str) -> list:
    """Banco do Brasil — estrutura similar ao Bradesco com crédito/débito separados."""
    return parsear_bradesco_excel(caminho)  # Layout muito similar


def parsear_caixa_excel(caminho: str) -> list:
    """Caixa Econômica Federal — usa parsear genérico como base."""
    return parsear_excel_generico(caminho)


def parsear_inter_excel(caminho: str) -> list:
    """Banco Inter — geralmente CSV exportado como Excel."""
    return parsear_excel_generico(caminho)


def parsear_excel_generico(caminho: str) -> list:
    """
    Fallback genérico para bancos não mapeados.
    Tenta identificar colunas por nome comum.
    """
    engine = 'xlrd' if caminho.endswith('.xls') else 'openpyxl'

    # Tenta diferentes posições de cabeçalho
    for skip in range(0, 15):
        try:
            df = pd.read_excel(caminho, engine=engine, skiprows=skip)
            cols_lower = [str(c).lower().strip() for c in df.columns]

            # Precisa ter pelo menos data e valor
            tem_data = any('data' in c for c in cols_lower)
            tem_valor = any('valor' in c or 'amount' in c for c in cols_lower)

            if tem_data and tem_valor:
                break
        except Exception:
            continue
    else:
        raise ValueError(f"Não foi possível identificar o layout do extrato: {caminho}")

    transacoes = []
    for _, row in df.iterrows():
        try:
            # Pega primeira coluna de data
            data_col = next((c for c in df.columns if 'data' in str(c).lower()), df.columns[0])
            desc_col = next((c for c in df.columns if any(
                k in str(c).lower() for k in ['descri', 'histori', 'memo', 'lançamento']
            )), df.columns[1] if len(df.columns) > 1 else df.columns[0])
            valor_col = next((c for c in df.columns if 'valor' in str(c).lower()), None)

            if valor_col is None:
                continue

            data_raw = str(row[data_col]).strip()
            if not data_raw or data_raw == 'nan':
                continue

            descricao = str(row[desc_col]).strip()
            valor_raw = row[valor_col]

            if pd.isna(valor_raw):
                continue

            valor = _parse_valor(valor_raw)
            data = normalizar_data(data_raw)

            transacoes.append({
                'data': data,
                'descricao': descricao,
                'valor': abs(valor),
                'tipo': 'debito' if valor < 0 else 'credito'
            })
        except Exception:
            continue

    print(f"  Genérico Excel: {len(transacoes)} transações extraídas")
    return transacoes


# ─────────────────────────────────────────────
# Parser PDF
# ─────────────────────────────────────────────

FILTROS_SALDO = re.compile(
    r'(saldo\s+(anterior|total|dispon|period|atual|dia|final|inici)|'
    r'saldo\s*$|total\s+dispon)',
    re.IGNORECASE
)
_DATA_RE = re.compile(r'^\d{2}/\d{2}/\d{2,4}$')
_VALOR_RE = re.compile(r'^-?[\d.]+,\d{2}$')


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

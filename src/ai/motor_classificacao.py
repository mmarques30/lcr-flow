"""
src/ai/motor_classificacao.py

Motor de classificação IA usando Claude API.
Recebe transações brutas do extrato e gera linhas da planilha SCI.

Referências usadas pela IA (em ordem de prioridade):
1. Mapa de Transações Típicas  — regras explícitas por tipo de transação
2. De-para conta/histórico     — fallback por código de conta bancária
3. Plano de históricos contábeis
4. Lista de participantes
"""

import os
import json
import time
import anthropic
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))

# Modelo de classificação. Haiku 4.5 é ~5x mais barato que Sonnet no caminho de
# extratos (alavanca de custo do backfill) e tem limite de tokens/min bem maior.
# Para maior precisão contábil, defina LCR_MODELO_CLASSIFICACAO=claude-sonnet-4-6
# no .env — itens de baixa confiança já caem em revisão humana no front.
MODELO_CLASSIFICACAO = os.getenv('LCR_MODELO_CLASSIFICACAO', 'claude-haiku-4-5')

# ─────────────────────────────────────────────
# Carrega tabelas de referência
# ─────────────────────────────────────────────

def carregar_mapa_transacoes():
    """Carrega o Mapa de Transações Típicas como lista de regras estruturadas."""
    import re
    df = pd.read_excel(
        'config/Modelo de mapeamento das transações típicas.xlsx',
        header=2
    )
    df = df.dropna(how='all')
    df.columns = [
        'ID', 'DOC_ORIGEM', 'TIPO', 'GATILHO',
        'CONTA_DEB', 'CONTA_CRED', 'PARTICIPANTE',
        'COD_HIST', 'TEXTO_HIST', 'REGRA_COMPLEMENTO',
        'DOC', 'OBSERVACOES'
    ]
    linhas = df[
        df['ID'].notna() &
        df['ID'].astype(str).str.match(r'^[A-Z]{2,}-\d+')
    ].copy()

    def _s(v):
        return str(v).strip() if pd.notna(v) and str(v) != 'nan' else ''

    regras = []
    for _, r in linhas.iterrows():
        regras.append({
            'id':                 _s(r['ID']),
            'tipo':               _s(r['TIPO']),
            'gatilho':            _s(r['GATILHO']),
            'conta_deb':          _s(r['CONTA_DEB']),
            'conta_cred':         _s(r['CONTA_CRED']),
            'participante':       _s(r['PARTICIPANTE']),
            'cod_hist':           _s(r['COD_HIST']),
            'texto_hist':         _s(r['TEXTO_HIST']),
            'regra_complemento':  _s(r['REGRA_COMPLEMENTO']),
            'observacoes':        _s(r['OBSERVACOES']),
        })
    return regras


def carregar_depara():
    """Carrega a tabela De-para como dicionário indexado por apelido da conta."""
    df = pd.read_excel(
        'config/De-para_conta_contabil_em_codigo_historico.xls',
        engine='xlrd',
        header=0
    )
    # Remove linhas sem histórico definido
    df = df[df['HISTORICO PADRÃO'].notna() & (df['HISTORICO PADRÃO'] != '-')]
    return df.to_dict('records')

def carregar_historicos():
    """Carrega plano de históricos como dict {codigo: texto}."""
    import csv
    df = pd.read_csv(
        'config/Plano_de_historicos_contabeis_do_SCI.csv',
        encoding='latin1',
        sep=';',
        quoting=csv.QUOTE_NONE,
        on_bad_lines='skip',
        skiprows=1,
        header=0,
        dtype=str
    )
    df.columns = df.columns.str.strip()
    historicos = {}
    for _, row in df.iterrows():
        try:
            codigo = int(str(row.iloc[0]).strip())
            nome = str(row.iloc[2]).strip()
            if nome and nome != 'nan':
                historicos[codigo] = nome
        except (ValueError, TypeError):
            continue
    return historicos

def carregar_participantes():
    """Carrega lista de participantes como dict {cnpj_cpf: {codigo, nome}}."""
    import csv
    df = pd.read_csv(
        'config/Lista_de_participantes.csv',
        encoding='latin1',
        sep=';',
        quoting=csv.QUOTE_NONE,
        on_bad_lines='skip',
        dtype=str
    )
    df.columns = df.columns.str.strip()
    participantes = {}
    for _, row in df.iterrows():
        cnpj = str(row.get('CNPJ/CPF/CIE', '')).strip()
        if cnpj and cnpj != 'nan':
            participantes[cnpj] = {
                'codigo': row.get('Código'),
                'nome': row.get('Nome', ''),
                'apelido': row.get('Apelido', '')
            }
    return participantes


# ─────────────────────────────────────────────
# Prompt de classificação
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """Você é um assistente contábil especializado em lançamentos do sistema SCI Único.

Sua tarefa é classificar transações bancárias e gerar o JSON exato para importação no SCI.

REGRAS IMPORTANTES:
1. Use o MAPA DE TRANSAÇÕES TÍPICAS como referência PRINCIPAL — ele tem regras explícitas por tipo
2. Quando o Mapa indicar "Banco C6", "Banco Bradesco" ou qualquer banco na conta de débito/crédito,
   substitua pelo código SCI real do banco deste cliente (informado no prompt)
3. Extraia o código numérico das contas: "160 - Salários a pagar" → débito = 160
4. Siga a Regra de COMPLEMENTO exatamente: MM/AAAA = competência, nome = extraia da descrição
5. "Participante" só é preenchido quando a coluna PARTICIPANTE do Mapa indicar D ou C
6. Se não encontrar regra correspondente no Mapa, use o De-para como fallback
7. confianca deve refletir sua certeza real (0.0 a 1.0)
8. Se não encontrar correspondência clara em nenhuma tabela, retorne confianca < 0.7

Responda APENAS com JSON válido, sem markdown, sem explicações fora do JSON."""


def montar_contexto(mapa: list, depara: list, historicos: dict) -> str:
    """Tabelas de referência (Mapa, De-para, Históricos), priorizando o Mapa.

    NÃO inclui a conta bancária do cliente: este bloco é IDÊNTICO entre todos os
    extratos e clientes, então vai num bloco de sistema com cache_control p/ ser
    reaproveitado (prompt caching) em todas as chamadas do backfill. A conta do
    cliente entra no prompt volátil (por lote) em classificar_extrato_batch."""

    # Mapa de transações — referência primária (formato compacto)
    linhas_mapa = []
    for r in mapa:
        linha = (
            f"[{r['id']}] {r['tipo']}\n"
            f"  Gatilho: {r['gatilho'][:100]}\n"
            f"  D: {r['conta_deb']} | C: {r['conta_cred']} | Hist: {r['cod_hist']}\n"
            f"  Complemento: {r['regra_complemento']}"
        )
        if r['participante'] and r['participante'] not in ('-', 'Não', 'nan'):
            linha += f" | Participante: {r['participante']}"
        if r['observacoes'] and r['observacoes'] not in ('-', 'nan'):
            linha += f"\n  Obs: {r['observacoes'][:100]}"
        linhas_mapa.append(linha)

    # De-para resumido — fallback
    depara_resumido = []
    for item in depara[:80]:
        depara_resumido.append({
            'apelido': item.get('Apelido', ''),
            'historico': item.get('HISTORICO PADRÃO'),
            'complementar': item.get('HISTORICO COMPLEMENTAR', ''),
            'participante': item.get('PARTICIPANTE', 0),
        })

    historicos_resumido = {k: v for k, v in list(historicos.items())[:60]}

    return f"""══════════════════════════════════════════
MAPA DE TRANSAÇÕES TÍPICAS (referência primária)
══════════════════════════════════════════
{chr(10).join(linhas_mapa)}

══════════════════════════════════════════
DE-PARA (fallback por conta bancária)
══════════════════════════════════════════
{json.dumps(depara_resumido, ensure_ascii=False)}

HISTÓRICOS DISPONÍVEIS:
{json.dumps(historicos_resumido, ensure_ascii=False)}"""


def _chamar_api_com_retry(prompt_usuario: str, max_tokens: int = 4000, tentativas: int = 4,
                          system=None) -> str:
    """Chama a API com retry exponencial em caso de rate limit.

    system: string OU lista de blocos de sistema (use blocos com cache_control p/
    prompt caching). Default = SYSTEM_PROMPT simples (avaliar_suficiencia_documentos)."""
    if system is None:
        system = SYSTEM_PROMPT
    for tentativa in range(tentativas):
        try:
            response = client.messages.create(
                model=MODELO_CLASSIFICACAO,
                max_tokens=max_tokens,
                system=system,
                messages=[{'role': 'user', 'content': prompt_usuario}]
            )
            return response.content[0].text.strip()
        except anthropic.RateLimitError:
            if tentativa == tentativas - 1:
                raise
            espera = 60 * (2 ** tentativa)
            print(f"  Rate limit. Aguardando {espera}s...")
            time.sleep(espera)


def classificar_extrato_batch(
    transacoes: list,
    conta_banco: int,
    competencia: str,
    contexto: str
) -> list:
    """
    Classifica todas as transações em uma única chamada API (batch).
    Usa o Mapa de Transações Típicas como referência primária.
    Retorna lista de resultados na mesma ordem das transações.

    `contexto` (tabelas de referência) vai num bloco de sistema com cache_control:
    é byte-idêntico entre lotes e clientes, então só o 1º lote paga o input cheio;
    os demais leem do cache (~90% mais barato) e o backfill inteiro reaproveita
    (dentro da janela de 5 min, que um drain contínuo mantém quente).
    """
    lista_txs = []
    for i, t in enumerate(transacoes):
        lista_txs.append(
            f"{i+1}. Data: {t['data']} | Tipo: {t['tipo']} | "
            f"Valor: R$ {t['valor']:.2f} | Descricao: {t['descricao']}"
        )

    comp_fmt = competencia  # ex.: "05/2026"

    # Sistema = prompt fixo + tabelas cacheadas (estável). A conta do cliente e as
    # transações vão no prompt do usuário (voláteis) para não invalidar o cache.
    system_blocks = [
        {"type": "text", "text": SYSTEM_PROMPT},
        {"type": "text", "text": contexto, "cache_control": {"type": "ephemeral"}},
    ]

    prompt = f"""Classifique as transacoes bancarias abaixo para importacao no SCI Unico.

CONTA BANCÁRIA DESTE CLIENTE NO SCI: {conta_banco}
(substitua qualquer referência a "Banco C6", "Banco Bradesco" ou similar pelo código {conta_banco})

Competencia: {comp_fmt}

TRANSACOES:
{chr(10).join(lista_txs)}

INSTRUCOES:
- Para cada transacao, identifique a regra correspondente no Mapa de Transacoes Tipicas
- Use o ID da regra no campo "regra_id" (ex: "FP-01") para rastreabilidade
- Extraia apenas o numero da conta: "160 - Salarios a pagar" → debito = 160
- MM/AAAA no complemento = {comp_fmt.replace('/', '/')}
- Se nao encontrar regra no Mapa, use o De-para como fallback (regra_id = "DEPARA")

Retorne um array JSON com um objeto por transacao (na mesma ordem):
[
  {{
    "idx": 1,
    "regra_id": "FP-01",
    "data": "YYYYMMDD",
    "debito": <int>,
    "credito": <int>,
    "part_deb": null,
    "part_cred": null,
    "valor": <float>,
    "historico": <int>,
    "complemento": "<texto conforme regra>",
    "documento": null,
    "confianca": <0.0_a_1.0>,
    "justificativa": "<regra aplicada e raciocinio>"
  }},
  ...
]

Responda APENAS com o array JSON, sem markdown."""

    texto = _chamar_api_com_retry(prompt, max_tokens=8000, system=system_blocks)
    texto = texto.replace('```json', '').replace('```', '').strip()
    return json.loads(texto)


def classificar_extrato(
    transacoes: list,
    conta_banco: int,
    competencia: str
) -> dict:
    """
    Classifica todas as transacoes de um extrato.
    Usa batch (1 chamada API para todas as transacoes) para respeitar rate limits.
    Retorna dict com linhas aprovadas e linhas para revisao manual.
    """

    mapa         = carregar_mapa_transacoes()
    depara       = carregar_depara()
    historicos   = carregar_historicos()
    participantes = carregar_participantes()

    aprovadas = []
    revisao_manual = []
    erros = []

    print(f"Classificando {len(transacoes)} transacoes ({len(mapa)} regras no mapa)...")

    # Contexto (tabelas) montado UMA vez e reusado em todos os lotes → o bloco
    # cacheável de classificar_extrato_batch fica byte-idêntico entre lotes/clientes.
    contexto = montar_contexto(mapa, depara, historicos)

    CHUNK = 12  # lotes menores evitam resposta JSON truncada (max_tokens)
    resultados = []
    for ini in range(0, len(transacoes), CHUNK):
        bloco = transacoes[ini:ini + CHUNK]
        try:
            parciais = classificar_extrato_batch(
                bloco, conta_banco, competencia, contexto
            )
            for k, linha in enumerate(parciais):
                linha['idx'] = ini + k + 1  # idx global por ordem (não confia no idx do modelo)
                resultados.append(linha)
        except Exception as e:
            print(f"  [X] Erro no lote {ini // CHUNK + 1}: {e}")
            for transacao in bloco:
                erros.append({'transacao': transacao, 'erro': str(e)})

    for linha in resultados:
        idx = linha.get('idx', 0) - 1
        transacao = transacoes[idx] if 0 <= idx < len(transacoes) else {}
        # Histórico real do extrato (ex.: 'APLICACAO CDB DI') p/ a descrição do
        # lançamento; sem isso o front mostra só o complemento SCI ('MM/AAAA').
        linha['descricao_origem'] = transacao.get('descricao', '')
        confianca = linha.get('confianca', 0)
        desc = transacao.get('descricao', '')[:50]

        regra = linha.get('regra_id', '?')
        if confianca >= 0.80:
            aprovadas.append(linha)
            print(f"  [OK] {desc} | regra: {regra} ({confianca:.0%})")
        else:
            revisao_manual.append({
                'transacao_original': transacao,
                'classificacao_sugerida': linha,
                'motivo': f"Confianca baixa: {confianca:.0%}"
            })
            print(f"  [?]  {desc} | regra: {regra} ({confianca:.0%})")

    return {
        'aprovadas': aprovadas,
        'revisao_manual': revisao_manual,
        'erros': erros,
        'resumo': {
            'total': len(transacoes),
            'aprovadas': len(aprovadas),
            'revisao': len(revisao_manual),
            'erros': len(erros)
        }
    }


def avaliar_suficiencia_documentos(
    observacao: str,
    documentos: list,
    competencia: str
) -> dict:
    """
    Avalia se os documentos recebidos são suficientes para lançar a contabilidade.

    observacao : texto do campo Observação dos Dados Cadastrais (requisitos do cliente)
    documentos : lista de {'nome': str, 'status': 'enviado'|'desconsiderado'|'pendente'}
    competencia: ex. "05/2026"

    Retorna:
    {
        'suficiente': bool,
        'observacoes': [str],   # pontos de atenção
        'faltando': [str],      # docs pendentes segundo a IA
        'justificativa': str
    }
    """
    docs_texto = '\n'.join(
        f"- {d['nome']}: {d['status'].upper()}"
        for d in documentos
    )

    prompt = f"""Analise os documentos recebidos de um cliente de contabilidade para a competência {competencia}.

REQUISITOS DO CLIENTE (campo Observação):
{observacao or '(sem observação específica)'}

DOCUMENTOS SOLICITADOS E STATUS:
{docs_texto}

STATUS possíveis:
- ENVIADO: cliente enviou o arquivo — OK
- DESCONSIDERADO: documento não se aplica a este cliente — OK
- PENDENTE: cliente ainda não enviou — PROBLEMA

Responda APENAS com JSON no formato:
{{
  "suficiente": true,
  "observacoes": ["ponto de atenção 1", "ponto de atenção 2"],
  "faltando": [],
  "justificativa": "todos os documentos necessários foram recebidos ou desconsiderados"
}}

Se houver algum PENDENTE, defina suficiente=false e liste o que está faltando.
Responda APENAS com o JSON, sem markdown."""

    texto = _chamar_api_com_retry(prompt, max_tokens=800)
    texto = texto.replace('```json', '').replace('```', '').strip()
    return json.loads(texto)


# ─────────────────────────────────────────────
# Teste local
# ─────────────────────────────────────────────

if __name__ == '__main__':
    # Transações de exemplo para teste
    transacoes_teste = [
        {
            'data': '2026-04-01',
            'descricao': 'Rendimento de aplicação CDB Bradesco',
            'valor': 0.25,
            'tipo': 'credito'
        },
        {
            'data': '2026-04-02',
            'descricao': 'Pagamento fornecedor Ze Bolacha Generos Alimenticios NF 83883',
            'valor': 18.00,
            'tipo': 'debito'
        },
        {
            'data': '2026-04-10',
            'descricao': 'Pagamento salario Maria De Lourdes Do Nascimento Silva',
            'valor': 2688.00,
            'tipo': 'debito'
        },
        {
            'data': '2026-04-15',
            'descricao': 'Tarifa bancária manutenção conta',
            'valor': 1.26,
            'tipo': 'debito'
        }
    ]

    print("=== Teste do Motor de Classificação IA ===\n")
    resultado = classificar_extrato(
        transacoes=transacoes_teste,
        conta_banco=9,  # Banco Bradesco no SCI
        competencia='04/2026'
    )

    print(f"\n=== Resumo ===")
    print(f"Total: {resultado['resumo']['total']}")
    print(f"Aprovadas: {resultado['resumo']['aprovadas']}")
    print(f"Revisão manual: {resultado['resumo']['revisao']}")
    print(f"Erros: {resultado['resumo']['erros']}")

    print(f"\n=== Linhas aprovadas ===")
    for linha in resultado['aprovadas']:
        print(json.dumps(linha, ensure_ascii=False, indent=2))

# LCR Flow — Arquitetura do Sistema
**Versão:** 1.0 | **Data:** 2026-06-26 | **Processo:** PROC-001

---

## Visão Geral

Sistema de automação fim a fim do processo de Integração e Conciliação Bancária de Clientes.
Elimina o trabalho manual das etapas 1 a 6 do mapeamento PROC-001.

```
Gestta (portal web)
  → detecta tarefas "Abertas e com cobrança"
  → baixa documentos do cliente
  → Parser extrai transações (Excel/PDF)
  → Claude API classifica e gera planilha SCI
  → Upload no LevelDrive
  → SCI importa lançamentos
  → Gestta conclui tarefa "Lançamentos Contábeis"
  → Notificação para o contador validar saldos
```

---

## Sistemas Envolvidos

| Sistema | URL | Tipo de acesso | Risco de bloqueio |
|---|---|---|---|
| Gestta | portal interno | Playwright stealth | Médio |
| LevelDrive | drv2.leveldrive.com.br | Playwright stealth | Baixo |
| SCI Único | novalcr.levelcloud.com.br | Playwright stealth | Alto (já bloqueou) |

---

## Stack Técnica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Orquestração | n8n self-hosted (Docker) | Agendamento, retry, logs visuais |
| Automação browser | Playwright + playwright-extra-plugin-stealth | Evade detecção headless |
| Classificação IA | Claude Sonnet 4.6 API | JSON structured output, custo controlado |
| Geração planilha | Python + openpyxl | Formato .xls exato do SCI |
| Parsers bancários | Python + pandas | Itaú, Bradesco, Santander Excel/PDF |
| Banco/logs | Supabase | Histórico, fila revisão, auditoria |
| Infraestrutura | VPS DigitalOcean $12/mês | Ubuntu 22.04, Docker, 2GB RAM |
| Alertas | n8n → email/Slack | Falhas, conclusões, revisão manual |

---

## Formato da Planilha SCI (11 colunas)

```
DATA | DÉBITO | CRÉDITO | PART DÉB | PART CRED | VALOR | HISTÓRICO | COMPLEMENTO | DOCUMENTO | CENTRO CUSTO DÉB | CENTRO CUSTO CRED
```

- **DATA:** formato `YYYYMMDD` (ex: `20260401`)
- **DÉBITO / CRÉDITO:** código numérico do plano de contas (ex: `9` = Banco Bradesco)
- **PART DÉB / PART CRED:** código do participante quando `PARTICIPANTE = Sim` no De-para
- **VALOR:** numérico com 2 casas decimais
- **HISTÓRICO:** código numérico do plano de históricos (ex: `1961`)
- **COMPLEMENTO:** texto montado conforme regras do De-para (competência, nome, NF, etc.)

---

## Lógica de Classificação IA

Para cada transação extraída do extrato, o Claude recebe:

1. Descrição da transação (texto do extrato)
2. Valor e data
3. Tabela De-para completa (código → conta → histórico → regras)
4. Plano de históricos (código → texto)
5. Lista de participantes (quando necessário)

E retorna JSON:
```json
{
  "data": "20260401",
  "debito": 9,
  "credito": 293,
  "part_deb": null,
  "part_cred": null,
  "valor": 0.25,
  "historico": 1961,
  "complemento": "04/2026",
  "documento": null,
  "confianca": 0.95,
  "justificativa": "Rendimento de aplicação financeira identificado pela descrição 'rend aplic'"
}
```

Transações com `confianca < 0.85` vão para fila de revisão manual no Supabase.

---

## Estratégia Anti-Detecção

O sistema anterior foi bloqueado por:
- Fingerprint headless detectável
- Login feito a cada execução
- IP fixo do escritório
- Sem delays humanizados entre ações

A solução implementada:
- `playwright-extra-plugin-stealth` oculta fingerprint headless
- Sessão salva em `storageState.json` após login manual inicial
- Login automático só quando sessão expira (detectado por redirect)
- Delays aleatórios entre ações: `800ms + random(0-1200ms)`
- User-Agent de browser real (Windows 10 + Chrome)
- Viewport 1366x768, locale pt-BR, timezone America/Sao_Paulo

---

## Fluxo de Erro e Recuperação

```
Erro durante execução
  ├── SESSAO_EXPIRADA → relogin automático → retry
  ├── LAYOUT_MUDOU   → screenshot + alerta urgente (sem retry)
  ├── TIMEOUT        → retry 2x com backoff → alerta se persistir
  ├── PARSE_FALHOU   → fila revisão manual → continua próximo cliente
  └── CONFIANCA_BAIXA → fila revisão manual → continua próximo cliente
```

Todo erro gera:
- Screenshot da tela no momento da falha
- Log no Supabase com cliente, etapa, erro e timestamp
- Notificação email/Slack com screenshot anexo

---

## Roadmap 72h

### Bloco 1 — 0 a 24h: infraestrutura + motor IA
- [ ] VPS DigitalOcean criada e configurada
- [ ] Docker + n8n rodando
- [ ] Script motor IA validado com planilha real do SCI
- [ ] Supabase configurado (tabelas: execucoes, erros, revisao_manual)

### Bloco 2 — 24 a 48h: automação Gestta + parsers
- [ ] Playwright stealth configurado na VPS
- [ ] Sessão Gestta salva manualmente
- [ ] Leitura de tarefas "Abertas e com cobrança"
- [ ] Download de documentos por cliente
- [ ] Parser Itaú Excel funcionando
- [ ] Parser Bradesco Excel funcionando
- [ ] Parser Santander Excel funcionando

### Bloco 3 — 48 a 72h: LevelDrive + SCI + finalização
- [ ] Upload LevelDrive automatizado
- [ ] Importação SCI com checkpoints e screenshots
- [ ] Conclusão tarefa no Gestta
- [ ] n8n workflow completo agendado (dia 1 de cada mês)
- [ ] Teste end-to-end com cliente real
- [ ] Alertas email/Slack configurados

---

## Pendências para completar o sistema

- [ ] Modelo de mapeamento de transações típicas (prometido pela equipe)
- [ ] Acesso ao Gestta para inspeção dos seletores da interface
- [ ] Acesso ao SCI para mapeamento da tela de importação
- [ ] Extratos de exemplo dos bancos para calibrar parsers
- [ ] Confirmar formato de autenticação do LevelDrive

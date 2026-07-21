#!/usr/bin/env bash
# Tick horário de produção: extrai e processa docs COBRANÇA via API (sem browser).
# Cron: 5 * * * * /opt/lcr/scripts/tick_cobranca.sh
set -euo pipefail
cd /opt/lcr
mkdir -p outputs/orquestracao

COMP=$(date +%Y-%m)
LOG=outputs/orquestracao/tick-${COMP}.log
LOCK=/tmp/lcr-tick-cobranca.lock
PY=/opt/lcr/venv/bin/python3
LIMITE=${LIMITE:-10}
STATUS=${STATUS:-OPEN}

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] skip: outro tick em execução" >> "$LOG"
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] tick competencia=${COMP} limite=${LIMITE} status=${STATUS}" >> "$LOG"
env PYTHONUTF8=1 "$PY" src/orquestrar.py \
  --competencia "$COMP" \
  --via-api \
  --limite "$LIMITE" \
  --status "$STATUS" >> "$LOG" 2>&1 || rc=$?
rc=${rc:-0}
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fim rc=${rc}" >> "$LOG"
exit "$rc"

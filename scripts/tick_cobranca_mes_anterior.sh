#!/usr/bin/env bash
# Catch-up diário: processa pendências OPEN do mês anterior (até dia 25).
# Cron: 30 3 * * * /opt/lcr/scripts/tick_cobranca_mes_anterior.sh
set -euo pipefail
cd /opt/lcr
mkdir -p outputs/orquestracao

DIA=$(date +%d)
if [ "$DIA" -gt 25 ]; then
  exit 0
fi

COMP=$(date -d "last month" +%Y-%m)
LOG=outputs/orquestracao/tick-${COMP}.log
LOCK=/tmp/lcr-tick-cobranca-anterior.lock
PY=/opt/lcr/venv/bin/python3
LIMITE=${LIMITE:-5}

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] skip anterior: outro tick em execução" >> "$LOG"
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] tick-anterior competencia=${COMP} limite=${LIMITE}" >> "$LOG"
env PYTHONUTF8=1 "$PY" src/orquestrar.py \
  --competencia "$COMP" \
  --via-api \
  --limite "$LIMITE" \
  --status OPEN >> "$LOG" 2>&1 || rc=$?
rc=${rc:-0}
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fim-anterior rc=${rc}" >> "$LOG"
exit "$rc"

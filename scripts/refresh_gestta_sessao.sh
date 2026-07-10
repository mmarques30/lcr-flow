#!/usr/bin/env bash
# Refresh preventivo da sessão Gestta (headless). Cron sugerido: 0 */6 * * *
set -euo pipefail
cd /opt/lcr
LOG=outputs/orquestracao/gestta-refresh.log
mkdir -p outputs/orquestracao
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh gestta" >> "$LOG"
if node src/gestta/autoLogin.js >> "$LOG" 2>&1; then
  PYTHONUTF8=1 /opt/lcr/venv/bin/python3 -c "
import sys
sys.path.insert(0, 'src')
from orquestrar import ping_gestta_api
print('api_ok=', ping_gestta_api())
" >> "$LOG" 2>&1
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] OK" >> "$LOG"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FALHOU rc=$?" >> "$LOG"
  exit 1
fi

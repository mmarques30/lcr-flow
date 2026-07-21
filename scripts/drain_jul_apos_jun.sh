#!/usr/bin/env bash
# Aguarda o drain de jun/2026 terminar e inicia jul/2026.
set -euo pipefail
cd /opt/lcr
LOG=outputs/orquestracao/drain-jul-apos-jun.log
exec >>"$LOG" 2>&1
echo "aguardando drain 2026-06... $(date -u +%Y-%m-%dT%H:%M:%SZ)"
while pgrep -f "drain_backlog.py --competencia 2026-06" >/dev/null 2>&1; do
  sleep 60
done
echo "iniciando drain 2026-07 $(date -u +%Y-%m-%dT%H:%M:%SZ)"
env PYTHONUTF8=1 venv/bin/python3 scripts/drain_backlog.py \
  --competencia 2026-07 \
  --via-api \
  --status "OPEN,DONE" \
  --limite 8 \
  --pausa 20 \
  --max-lotes 200
echo "fim jul $(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Não reativa tick aqui — jun retoma via drain_jun_apos_jul.sh
if [ -x scripts/drain_jun_apos_jul.sh ]; then
  setsid nohup bash scripts/drain_jun_apos_jul.sh > /dev/null 2>&1 < /dev/null &
  echo "waiter jun agendado"
fi

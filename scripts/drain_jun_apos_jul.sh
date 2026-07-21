#!/usr/bin/env bash
# Aguarda o drain de jul/2026 terminar e retoma jun/2026 (190 pendentes).
set -euo pipefail
cd /opt/lcr
LOG=outputs/orquestracao/drain-jun-apos-jul.log
exec >>"$LOG" 2>&1
echo "aguardando drain 2026-07... $(date -u +%Y-%m-%dT%H:%M:%SZ)"
while pgrep -f "drain_backlog.py --competencia 2026-07" >/dev/null 2>&1; do
  sleep 60
done
echo "iniciando drain 2026-06 $(date -u +%Y-%m-%dT%H:%M:%SZ)"
env PYTHONUTF8=1 venv/bin/python3 scripts/drain_backlog.py \
  --competencia 2026-06 \
  --via-api \
  --status "OPEN,DONE" \
  --limite 8 \
  --pausa 20 \
  --max-lotes 200
echo "fim jun $(date -u +%Y-%m-%dT%H:%M:%SZ)"
(crontab -l 2>/dev/null | grep -v tick_cobranca; echo "5 * * * * /opt/lcr/scripts/tick_cobranca.sh") | crontab -
echo "tick horario reativado"

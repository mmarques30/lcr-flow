#!/usr/bin/env bash
# Esvazia backlog jun/2026 e jul/2026 (OPEN+DONE, via API).
set -euo pipefail
cd /opt/lcr
LOG=outputs/orquestracao/drain-jun-jul-$(date +%Y%m%d).log
mkdir -p outputs/orquestracao
exec >>"$LOG" 2>&1
echo "=== INICIO $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

for COMP in 2026-06 2026-07; do
  echo "--- drain competencia=${COMP} ---"
  env PYTHONUTF8=1 venv/bin/python3 scripts/drain_backlog.py \
    --competencia "$COMP" \
    --via-api \
    --status "OPEN,DONE" \
    --limite 8 \
    --pausa 20 \
    --max-lotes 200
done

echo "=== FIM $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Reativa tick horário após esvaziar backlog
(crontab -l 2>/dev/null | grep -v tick_cobranca; echo "5 * * * * /opt/lcr/scripts/tick_cobranca.sh") | crontab -
echo "tick_cobranca.sh recolocado no crontab"

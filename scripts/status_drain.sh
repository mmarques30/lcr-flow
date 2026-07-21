#!/usr/bin/env bash
# Snapshot de status do drain jun/jul para monitoramento.
set -euo pipefail
cd /opt/lcr
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LEDGER_JUN=$(grep -c ':2026-06":' outputs/orquestracao/processadas.json 2>/dev/null || true)
LEDGER_JUL=$(grep -c ':2026-07":' outputs/orquestracao/processadas.json 2>/dev/null || true)
LEDGER_JUN=${LEDGER_JUN:-0}
LEDGER_JUL=${LEDGER_JUL:-0}

DRAIN_JUN=$(pgrep -f "drain_backlog.py --competencia 2026-06" >/dev/null && echo SIM || echo NAO)
DRAIN_JUL=$(pgrep -f "drain_backlog.py --competencia 2026-07" >/dev/null && echo SIM || echo NAO)
ORQ=$(pgrep -af "src/orquestrar.py" 2>/dev/null | grep python | head -1 | sed 's/.*--competencia /comp=/' | cut -d' ' -f1 || true)
ORQ=${ORQ:-parado}
WAITER=$(pgrep -f drain_jul_apos_jun >/dev/null && echo SIM || echo NAO)

ACUM=""
if [ -f outputs/orquestracao/drain-jun-jul-20260713.log ]; then
  ACUM=$(grep 'acumulado:' outputs/orquestracao/drain-jun-jul-20260713.log 2>/dev/null | tail -1 | sed 's/.*acumulado: //' || true)
fi
if [ -z "$ACUM" ] && [ -f outputs/orquestracao/drain-jul-apos-jun.log ]; then
  ACUM=$(grep 'acumulado:' outputs/orquestracao/drain-jul-apos-jun.log 2>/dev/null | tail -1 | sed 's/.*acumulado: //' || true)
fi

RESUMO=""
for f in outputs/orquestracao/drain-jun-jul-20260713.log outputs/orquestracao/drain-jul-apos-jun.log; do
  if [ -f "$f" ]; then
    R=$(grep 'RESUMO FINAL' "$f" 2>/dev/null | tail -1 || true)
    [ -n "$R" ] && RESUMO="$R"
  fi
done

echo "[$TS] drain_jun=$DRAIN_JUN drain_jul=$DRAIN_JUL orquestrar=$ORQ waiter_jul=$WAITER ledger_jun=$LEDGER_JUN ledger_jul=$LEDGER_JUL acumulado=${ACUM:-n/a}"
[ -n "$RESUMO" ] && echo "  $RESUMO" || true

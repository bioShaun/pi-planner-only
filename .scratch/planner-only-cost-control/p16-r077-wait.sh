#!/bin/bash
# Poll the executor pane until it has been idle/done for 3 consecutive checks.
# Lightweight (one herdr RPC every 30s); no slot needed.
streak=0
for i in $(seq 1 200); do
  st=$(herdr agent get w2E:pE 2>/dev/null | grep -o '"agent_status":"[a-z]*"' | head -1 | cut -d'"' -f4)
  if [ "$st" = "idle" ] || [ "$st" = "done" ]; then streak=$((streak+1)); else streak=0; fi
  echo "$(date +%H:%M:%S) status=$st streak=$streak"
  if [ "$streak" -ge 3 ]; then echo "EXECUTOR-QUIET"; exit 0; fi
  sleep 30
done
echo "TIMEOUT"

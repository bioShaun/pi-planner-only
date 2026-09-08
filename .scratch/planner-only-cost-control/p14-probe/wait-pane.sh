#!/bin/bash
# Quiet = 3 consecutive samples with status idle/done/blocked and no "generating"/"Working" on screen.
pane="$1"; deadline=$((SECONDS + 2400)); quiet=0
while [ $SECONDS -lt $deadline ]; do
  sleep 20
  st=$(herdr agent get "$pane" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["agent"]["agent_status"])' 2>/dev/null)
  scr=$(herdr agent read "$pane" --source visible 2>/dev/null | tail -6)
  ok=0
  case "$st" in idle|done|blocked) ok=1;; esac
  case "$scr" in *generating*|*Working*|*Thinking*) ok=0;; esac
  if [ $ok -eq 1 ]; then quiet=$((quiet+1)); else quiet=0; fi
  if [ $quiet -ge 3 ]; then echo "QUIET status=$st"; exit 0; fi
done
echo "TIMEOUT"; exit 1

#!/usr/bin/env bash
# Real round trip: Root (default model) -> delegate(worker) -> pi-subagents -> git_audit.
# Loads only pi-subagents and this checkout, so the installed legacy copy stays out.
set -euo pipefail
PLUGIN=/home/tcuni-claw/pi/pi-planner-only
SUBAGENTS=$HOME/.pi/agent/npm/node_modules/pi-subagents
OUT=$PLUGIN/.scratch/lite-smoke
REPO=/project/tmp/ppo-smoke-repo
rm -rf "$REPO" && mkdir -p "$REPO" && cd "$REPO"
git init -q && git config user.email s@example.com && git config user.name smoke
printf 'def add(a, b):\n    return a - b\n' > calc.py
printf 'from calc import add\nassert add(2, 3) == 5\nprint("ok")\n' > test_calc.py
git add -A && git commit -qm init

PI_PLANNER_ONLY=1 timeout 600 pi -ne -e "$SUBAGENTS" -e "$PLUGIN/index.ts" --no-session --mode json -p \
  "calc.py has a bug: test_calc.py fails. Use the delegate tool with role worker to fix it (the worker must run 'python3 test_calc.py'). Then call git_audit with operation diff to check the change. Do not commit. Reply with one line: FIXED or NOT FIXED." \
  </dev/null > "$OUT/run.jsonl" 2> "$OUT/run.stderr"
echo "exit=$?"
git -C "$REPO" diff --stat
python3 "$REPO/test_calc.py"

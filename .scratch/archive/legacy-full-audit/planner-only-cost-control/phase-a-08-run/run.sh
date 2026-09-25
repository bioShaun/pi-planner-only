#!/usr/bin/env bash
# Phase A issue 08: same-ticket real rerun. Do not invoke directly; slot cpu wraps this.
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run
cd "$WT"
export PI_CODING_AGENT_DIR="$WT/.agent-dir"
export PI_PLANNER_ONLY=1
export PI_PLANNER_ONLY_REQUIRE_CONTRACT=0
date -Iseconds | tee "$RUN/start.txt"
printf '%s\n' "cwd=$(pwd)" "pi=$(command -v pi)" "PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR" | tee "$RUN/env.txt"
# Same CLI shape as .scratch/kimi-timing-probe/run-2026-09-07.md §1.3
# Isolated agent dir so the loaded plugin is the 01–07 working tree, not github 9027d8f.
set +e
pi -p --approve --name phase-a-08-rerun \
  --model kimi-coding/k3-256k --thinking high \
  --session-dir "$WT/.scratch/phase-a-08-session" \
  @.scratch/oracle-status-line/root-prompt.md \
  >"$RUN/pi-stdout.log" 2>"$RUN/pi-stderr.log"
code=$?
set -e
date -Iseconds | tee "$RUN/end.txt"
echo "exit_code=$code" | tee "$RUN/exit.txt"
exit "$code"

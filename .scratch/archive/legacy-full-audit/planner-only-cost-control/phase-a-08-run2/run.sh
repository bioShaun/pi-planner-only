#!/usr/bin/env bash
# Phase A issue 08 second rerun (after tickets 20+21). Do not invoke directly; slot cpu wraps this.
# Keep the failed first tree at pi-planner-only-phase-a-08. This tree starts at 9027d8f again.
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run2
cd "$WT"
export PI_CODING_AGENT_DIR="$WT/.agent-dir"
export PI_PLANNER_ONLY=1
export PI_PLANNER_ONLY_REQUIRE_CONTRACT=0
date -Iseconds | tee "$RUN/start.txt"
printf '%s\n' "cwd=$(pwd)" "pi=$(command -v pi)" "PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR" "HEAD=$(git rev-parse HEAD)" "branch=$(git rev-parse --abbrev-ref HEAD)" | tee "$RUN/env.txt"
set +e
pi -p --approve --name phase-a-08-rerun-2 \
  --model kimi-coding/k3-256k --thinking high \
  --session-dir "$WT/.scratch/phase-a-08-session" \
  @.scratch/oracle-status-line/root-prompt.md \
  >"$RUN/pi-stdout.log" 2>"$RUN/pi-stderr.log"
code=$?
set -e
date -Iseconds | tee "$RUN/end.txt"
echo "exit_code=$code" | tee "$RUN/exit.txt"
exit "$code"

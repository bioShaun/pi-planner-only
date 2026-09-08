#!/usr/bin/env bash
# Phase A issue 08 sixth rerun. Same ticket / Root prompt / model as r3-r5
# (root-prompt.md is byte-identical to r5, including its stale branch name).
# Plugin is the main tree at commit 0158a1b (tickets 01-30, 33-35 landed;
# the four r5 blockers 27/28/29/30 plus 33/34/35 are all closed).
# Do not invoke directly; slot cpu wraps this.
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r6
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run6
cd "$WT"
export PI_CODING_AGENT_DIR="$WT/.agent-dir"
export PI_PLANNER_ONLY=1
export PI_PLANNER_ONLY_REQUIRE_CONTRACT=0
export PI_PLANNER_ONLY_REQUIRE_REVIEW=1
date -Iseconds | tee "$RUN/start.txt"
printf '%s\n' "cwd=$(pwd)" "pi=$(command -v pi)" "PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR" "PI_PLANNER_ONLY=$PI_PLANNER_ONLY" "PI_PLANNER_ONLY_REQUIRE_CONTRACT=$PI_PLANNER_ONLY_REQUIRE_CONTRACT" "PI_PLANNER_ONLY_REQUIRE_REVIEW=$PI_PLANNER_ONLY_REQUIRE_REVIEW" "HEAD=$(git rev-parse HEAD)" "branch=$(git rev-parse --abbrev-ref HEAD)" "CLI_MODEL=kimi-coding/kimi-for-coding" "PLUGIN=/home/tcuni-claw/pi/pi-planner-only" "PLUGIN_HEAD=$(git -C /home/tcuni-claw/pi/pi-planner-only rev-parse HEAD)" | tee "$RUN/env.txt"
set +e
pi -p --approve --name phase-a-08-rerun-6 \
  --model kimi-coding/kimi-for-coding --thinking high \
  --session-dir "$WT/.scratch/phase-a-08-session" \
  @.scratch/oracle-status-line/root-prompt.md \
  >"$RUN/pi-stdout.log" 2>"$RUN/pi-stderr.log"
code=$?
set -e
date -Iseconds | tee "$RUN/end.txt"
echo "exit_code=$code" | tee "$RUN/exit.txt"
exit "$code"

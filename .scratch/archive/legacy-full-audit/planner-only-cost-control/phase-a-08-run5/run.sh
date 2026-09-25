#!/usr/bin/env bash
# Phase A issue 08 fifth rerun. Same ticket/prompt/model as r3 and r4.
# Plugin is the main tree at commit 0fe04df (tickets 01-24 landed).
# New in r5: PI_PLANNER_ONLY_REQUIRE_REVIEW=1 (ticket 22 strict mode).
# Do not invoke directly; slot cpu wraps this.
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r5
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run5
cd "$WT"
export PI_CODING_AGENT_DIR="$WT/.agent-dir"
export PI_PLANNER_ONLY=1
export PI_PLANNER_ONLY_REQUIRE_CONTRACT=0
export PI_PLANNER_ONLY_REQUIRE_REVIEW=1
date -Iseconds | tee "$RUN/start.txt"
printf '%s\n' "cwd=$(pwd)" "pi=$(command -v pi)" "PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR" "PI_PLANNER_ONLY=$PI_PLANNER_ONLY" "PI_PLANNER_ONLY_REQUIRE_CONTRACT=$PI_PLANNER_ONLY_REQUIRE_CONTRACT" "PI_PLANNER_ONLY_REQUIRE_REVIEW=$PI_PLANNER_ONLY_REQUIRE_REVIEW" "HEAD=$(git rev-parse HEAD)" "branch=$(git rev-parse --abbrev-ref HEAD)" "CLI_MODEL=kimi-coding/kimi-for-coding" "PLUGIN=/home/tcuni-claw/pi/pi-planner-only" "PLUGIN_HEAD=$(git -C /home/tcuni-claw/pi/pi-planner-only rev-parse HEAD)" | tee "$RUN/env.txt"
set +e
pi -p --approve --name phase-a-08-rerun-5 \
  --model kimi-coding/kimi-for-coding --thinking high \
  --session-dir "$WT/.scratch/phase-a-08-session" \
  @.scratch/oracle-status-line/root-prompt.md \
  >"$RUN/pi-stdout.log" 2>"$RUN/pi-stderr.log"
code=$?
set -e
date -Iseconds | tee "$RUN/end.txt"
echo "exit_code=$code" | tee "$RUN/exit.txt"
exit "$code"

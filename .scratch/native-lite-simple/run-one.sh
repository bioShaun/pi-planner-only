#!/usr/bin/env bash
# Usage: run-one.sh MODE REP BATCH_DIR   (MODE = native | lite)
set -uo pipefail
MODE=${1:?mode}; REP=${2:?rep}; BATCH_DIR=${3:?batch dir}
case "$MODE" in native|lite) ;; *) echo "run-one: MODE must be native or lite" >&2; exit 2 ;; esac
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_REPO=$(cd "$HERE/../.." && pwd)
PI_BIN=${PI_BIN:-/home/tcuni-claw/.local/bin/pi}
PI_SUBAGENTS=${PI_SUBAGENTS_EXT:-/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js}
ROOT_MODEL=${ROOT_MODEL:-tcuni/gpt-6.1-terra}
TIMEOUT=${RUN_TIMEOUT_SEC:-1800}
BATCH_DIR=$(mkdir -p "$BATCH_DIR" && cd "$BATCH_DIR" && pwd)
RUN=$BATCH_DIR/runs/$MODE-$REP
[ -e "$RUN" ] && { echo "run-one: $RUN already exists" >&2; exit 2; }
mkdir -p "$RUN/session" "$RUN/tmp"
export TMPDIR=$RUN/tmp TMP=$RUN/tmp TEMP=$RUN/tmp

cp -r "$HERE/fixture" "$RUN/repo"
g() { git -C "$RUN/repo" "$@"; }
g init -q -b main && g config user.name ab-test && g config user.email ab-test@local && g config commit.gpgsign false \
  && g add -A && g commit -q -m "initial fixture" || { echo "run-one: fixture git setup failed" >&2; exit 2; }

PROMPT=$(cat "$HERE/task.md")
start_ms=$(date +%s%3N); start_iso=$(date -Iseconds)
echo "run-one: $MODE-$REP start $start_iso (timeout ${TIMEOUT}s) -> $RUN"
(
  cd "$RUN/repo" || exit 127
  exec env -u PI_OFFLINE -u PI_SUBAGENT_CHILD -u PI_SUBAGENT_PARENT_SESSION -u PI_SUBAGENT_RUNNER_PID \
    -u PI_ASYNC_NATIVE_RUNNER -u PI_PROVIDER -u PI_MODEL -u PI_REASONING_LEVEL -u PI_SESSION_ID -u PI_SESSION_FILE \
    -u PI_CODING_AGENT -u PI_PACKAGE_DIR -u PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT -u PI_MANAGED_INSTALL_ROOT \
    -u PI_PLANNER_ONLY_STRICT \
    PI_PLANNER_ONLY_MODE="$MODE" PI_PLANNER_ONLY_HANDOFF=off PI_TELEMETRY=0 PI_SUBAGENTS_TEMP_ROOT="$RUN/tmp" \
    setsid "$PI_BIN" --approve -p --mode json --session-dir "$RUN/session" --model "$ROOT_MODEL" --thinking high \
      --no-extensions --no-mcp -e "$PI_SUBAGENTS" -e "$PLUGIN_REPO/index.ts" "$PROMPT" \
    >"$RUN/stdout.jsonl" 2>"$RUN/stderr.log" </dev/null
) &
pid=$!

# A finished-but-unreaped child still answers kill -0, so check for the zombie state explicitly.
alive() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) || return 1; [[ $s != Z* ]]; }
timed_out=false
while alive "$pid"; do
  if (( ($(date +%s%3N) - start_ms) / 1000 >= TIMEOUT )); then
    timed_out=true
    echo "run-one: timeout after ${TIMEOUT}s, TERM process group $pid" >&2
    kill -TERM -- "-$pid" 2>/dev/null
    for _ in $(seq 15); do alive "$pid" || break; sleep 1; done
    break
  fi
  sleep 1
done
leftover=$(CLK_TCK=$(getconf CLK_TCK) node "$HERE/sweep.mjs" "$RUN" "$pid" "$((start_ms / 1000))")
kill -KILL -- "-$pid" 2>/dev/null
wait "$pid"; exit_code=$?
end_ms=$(date +%s%3N)
[ "${leftover:-0}" -gt 0 ] 2>/dev/null && echo "run-one: killed $leftover leftover process(es)" >&2

AB_MODE=$MODE AB_REP=$REP AB_START=$start_iso AB_END=$(date -Iseconds) AB_WALL_MS=$((end_ms - start_ms)) \
AB_EXIT=$exit_code AB_TIMEDOUT=$timed_out AB_LEFTOVER=${leftover:-null} AB_TIMEOUT=$TIMEOUT \
AB_HEAD=$(git -C "$PLUGIN_REPO" rev-parse HEAD 2>/dev/null || echo unknown) \
AB_DIRTY=$(git -C "$PLUGIN_REPO" status --porcelain --untracked-files=no 2>/dev/null | wc -l) \
AB_PI=$("$PI_BIN" --version 2>/dev/null | head -n1) AB_PI_BIN=$PI_BIN AB_MODEL=$ROOT_MODEL \
node -e 'const e = process.env; console.log(JSON.stringify({ mode: e.AB_MODE, rep: Number(e.AB_REP), start: e.AB_START,
  end: e.AB_END, wallclockSec: Number(e.AB_WALL_MS) / 1000, exitCode: Number(e.AB_EXIT), timedOut: e.AB_TIMEDOUT === "true",
  timeoutSec: Number(e.AB_TIMEOUT), leftoverKilled: Number(e.AB_LEFTOVER), pluginHead: e.AB_HEAD,
  pluginTrackedChanges: Number(e.AB_DIRTY), piVersion: e.AB_PI, piBin: e.AB_PI_BIN, rootModel: e.AB_MODEL }, null, 2))' \
  >"$RUN/meta.json"
echo "run-one: $MODE-$REP exit=$exit_code timedOut=$timed_out wall=$(( (end_ms - start_ms) / 1000 ))s leftover=$leftover"
node "$HERE/score.mjs" "$RUN"

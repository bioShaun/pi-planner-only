#!/usr/bin/env bash
set -euo pipefail

if [[ ${CAP_USD+x} ]]; then
  echo "CAP_USD is hard-coded to 0.10; environment override is forbidden" >&2
  exit 1
fi
CAP_USD=0.10
readonly CAP_USD

ROOT_MODEL=${ROOT_MODEL:-tcuni/gpt-5.6-luna}
WT=/home/tcuni-claw/pi/pi-planner-only-p19-experiment
# Accounting root is a subdirectory so probe leftovers and logs cannot look
# like host transcripts. spend.py walks every session-* under this path.
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/p19-experiment/runs
PRICING=/home/tcuni-claw/.pi/agent/planner-only/pricing.json
SUBAGENTS=/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.ts
SPEND=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/p18-contract-run/spend.py
DRIVER=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/p19-experiment
mkdir -p "$RUN"

spend_total() { python3 "$SPEND" "$RUN"; }

link_agent_dir() {
  local dest=$1
  mkdir -p "$dest"
  local f
  for f in models.json models-store.json auth.json; do
    if [[ -e "$HOME/.pi/agent/$f" && ! -e "$dest/$f" ]]; then
      ln -s "$HOME/.pi/agent/$f" "$dest/$f"
    fi
  done
}

run_group() {
  local group=$1 prompt=$2 worker=$3
  shift 3
  local before
  before=$(spend_total)
  if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < float(sys.argv[2]) else 1)' "$before" "$CAP_USD"; then
    :
  else
    echo "SPEND GATE: \$$before >= cap \$$CAP_USD; refusing to start group $group" | tee -a "$RUN/gate.log"
    exit 1
  fi

  local ad="$WT/.agent-dir-$group"
  link_agent_dir "$ad"
  mkdir -p "$RUN"
  if [[ -d "$WT" ]]; then
    cd "$WT"
  fi
  set +e
  env \
    PI_CODING_AGENT_DIR="$ad" \
    PI_PLANNER_ONLY=1 \
    PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 \
    PI_PLANNER_ONLY_REQUIRE_REVIEW=0 \
    PI_PLANNER_ONLY_ROLE_MODELS=1 \
    PI_PLANNER_ONLY_MODEL_WORKER="$worker" \
    PI_PLANNER_ONLY_THINKING_WORKER=low \
    PI_PLANNER_ONLY_THINKING_ROOT=low \
    PI_PLANNER_ONLY_MODEL_ROOT="$ROOT_MODEL" \
    PI_PLANNER_ONLY_PRICING="$PRICING" \
    "$@" \
    pi -p --approve --name "planner-only-$group" \
      --model "$ROOT_MODEL" --thinking low \
      -ne -e "$WT/index.ts" -e "$SUBAGENTS" \
      --session-dir "$RUN/session-$group" \
      "@$prompt" \
      >"$RUN/$group-stdout.log" 2>"$RUN/$group-stderr.log"
  local code=$?
  set -e
  python3 "$SPEND" --require "$RUN/session-$group" >"$RUN/$group-spend.log"
  local after
  after=$(spend_total)
  echo "group=$group exit=$code spend_before=$before spend_after=$after"
  return "$code"
}

if [[ $# -eq 0 ]]; then
  echo "no group supplied; expected SMOKE, ISO-38, ISO-39, SPLIT-38, or SPLIT-39" >&2
  exit 2
fi

for group in "$@"; do
  case "$group" in
    SMOKE)
      run_group SMOKE "$DRIVER/root-prompt-smoke.md" "${ROOT_MODEL}"
      ;;
    ISO-39)
      run_group ISO-39 "$DRIVER/prompt-39-isolated-baseline.md" tcuni/gpt-5.6-luna
      ;;
    SPLIT-39)
      run_group SPLIT-39 "$DRIVER/prompt-39-role-split.md" qwen-local/qwen3.8-27b
      ;;
    ISO-38|SPLIT-38)
      echo "group $group is not armed: ticket prompt is not installed" >&2
      exit 2
      ;;
    *) echo "unknown group: $group" >&2; exit 2 ;;
  esac
done

echo "total_spend_usd=$(spend_total)"

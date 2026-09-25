#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TASK_ID=${1:?usage: bench/run.sh <task-id> <arm-name> <rep>}
ARM_NAME=${2:?}
REP=${3:?}
: "${BENCH_OUT:?BENCH_OUT must name the campaign output directory}"
# Retry protocol: a failed attempt below BENCH_MAX_ATTEMPTS logs to RETRY and exits 5 (caller retries);
# only the last attempt writes STOP. Default 1 attempt keeps the old fail-fast behaviour.
ATTEMPT=${BENCH_ATTEMPT:-1} MAX_ATTEMPTS=${BENCH_MAX_ATTEMPTS:-1}
[[ $ATTEMPT =~ ^[1-9][0-9]*$ && $MAX_ATTEMPTS =~ ^[1-9][0-9]*$ ]] || { echo "BENCH_ATTEMPT/BENCH_MAX_ATTEMPTS must be positive integers" >&2; exit 2; }
# Record a failure: RETRY + exit 5 while attempts remain, else STOP + the given exit code.
fail_run() {
  local code=$1 msg=$2
  if (( ATTEMPT < MAX_ATTEMPTS )); then
    printf '%s %s attempt=%s/%s %s\n' "$(date -Is)" "$ID" "$ATTEMPT" "$MAX_ATTEMPTS" "$msg" >>"$BENCH_OUT/RETRY"
    exit 5
  fi
  printf '%s %s %s\n' "$(date -Is)" "$ID" "$msg" >>"$BENCH_OUT/STOP"
  exit "$code"
}
TASK_FILE=$ROOT/bench/tasks/$TASK_ID.json
ARM_FILE=$ROOT/bench/arms/$ARM_NAME.json
[[ -f $TASK_FILE && -f $ARM_FILE ]] || { echo "missing task or arm config" >&2; exit 2; }

# Secrets are loaded for slot-launched runs that do not inherit the caller environment.
source "$HOME/.config/pi/secrets.zsh"
readarray -t CONFIG < <(python3 - "$TASK_FILE" "$ARM_FILE" <<'PY'
import json, sys
T=json.load(open(sys.argv[1])); A=json.load(open(sys.argv[2]))
for value in (T['id'],T['repo'],T['target'],T['parent'],T['python'],T['prompt'],T['baseline'],json.dumps(T['tests']),A['name'],A['mode'],A['rootModel'],A['pluginRef'],A['promptPrefix'],json.dumps(A.get('env',{}))):
 print(value)
PY
)
TASK=${CONFIG[0]} REPO=${CONFIG[1]} TARGET=${CONFIG[2]} PARENT=${CONFIG[3]}
PYTHON=${CONFIG[4]} PROMPT_FILE=$ROOT/bench/tasks/${CONFIG[5]} BASELINE=$ROOT/bench/tasks/${CONFIG[6]}
TESTS_JSON=${CONFIG[7]} ARM=${CONFIG[8]} MODE=${CONFIG[9]} ROOT_MODEL=${CONFIG[10]} PLUGIN_REF=${BENCH_PLUGIN_REF:-${CONFIG[11]}} PREFIX=${CONFIG[12]}
# Optional arm "env": extra environment variables for the pi process (e.g. PI_PLANNER_ONLY_STRICT).
ARM_ENV=(); mapfile -t ARM_ENV < <(python3 -c 'import json,sys; [print(f"{k}={v}") for k,v in json.loads(sys.argv[1]).items()]' "${CONFIG[13]}")
TESTS=(); mapfile -t TESTS < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])))' "$TESTS_JSON")
ID=$TASK-$ARM-$REP
RUNS=$BENCH_OUT/runs
CLONE_ROOT=/project/tmp/ppo-bench/clones
CLONE=$CLONE_ROOT/$(basename "$BENCH_OUT")-$ID
PLUGIN_SHA= WORKTREE_DIRTY=false

# Validate all run paths before creating them.
[[ -d $(dirname "$BENCH_OUT") || -d $BENCH_OUT ]] || { echo "BENCH_OUT parent must already exist" >&2; exit 2; }
mkdir -p "$RUNS"
mkdir -p /project/tmp/ppo-bench

MODELS=$(pi --list-models 2>&1) || { echo "BLOCKED pi --list-models failed"; exit 3; }
model_present() { awk -v want="$1" 'NF >= 2 && $1 "/" $2 == want {found=1} END {exit !found}' <<<"$MODELS"; }
model_present "$ROOT_MODEL" || { echo "BLOCKED $ROOT_MODEL"; exit 3; }
# Child models: whatever pi-subagents is configured to use for the roles the plugin launches.
CHILD_MODELS=$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])).get("subagents",{}); o=s.get("agentOverrides",{}); print("\n".join(sorted({(o.get(a) or {}).get("model") or s.get("defaultModel","") for a in ("worker","scout","oracle","reviewer")} - {""})))' "$HOME/.pi/agent/settings.json")
for m in $CHILD_MODELS; do model_present "$m" || { echo "BLOCKED child model $m"; exit 3; }; done

if [[ ${BENCH_SKIP_HEALTH:-0} == 1 ]]; then
  echo "health: skipped"
elif [[ ${BENCH_DRY_RUN:-0} == 1 ]]; then
  echo "health: skipped (dry-run)"
  declare -A shown_models=()
  for m in "$ROOT_MODEL" $CHILD_MODELS; do
    [[ -n ${shown_models[$m]:-} ]] && continue
    shown_models[$m]=1
    printf 'health command: timeout 120 pi -ne --no-session --model %q -p %q </dev/null\n' "$m" 'reply OK'
  done
else
  declare -A checked_models=()
  for m in "$ROOT_MODEL" $CHILD_MODELS; do
    [[ -n ${checked_models[$m]:-} ]] && continue
    checked_models[$m]=1
    health_err=$(mktemp -p /project/tmp/ppo-bench health.XXXXXX)
    # Judge stdout only: provider errors on stderr can contain "ok" (e.g. "token").
    health_out=$(timeout 120 pi -ne --no-session --model "$m" -p "reply OK" </dev/null 2>"$health_err"); health_rc=$?
    health_msg=$(tail -n 1 "$health_err"); rm -f "$health_err"
    if (( health_rc != 0 )) || ! grep -Eqiw 'ok' <<<"$health_out"; then
      last_line=$(tail -n 1 <<<"${health_msg:-$health_out}")
      line="BLOCKED health $m: ${last_line:-exit $health_rc}"
      echo "$line" >&2
      fail_run 3 "$line"
    fi
  done
fi

if [[ $MODE == lite ]]; then
  if [[ $PLUGIN_REF == WORKTREE ]]; then
    PLUGIN_SHA=$(git -C "$ROOT" rev-parse HEAD)
    # Any uncommitted change to a shipped plugin source counts as dirty.
    if ! git -C "$ROOT" diff --quiet HEAD -- index.ts delegate.ts git.ts subagent-delegation-contract.ts; then WORKTREE_DIRTY=true; fi
    PLUGIN=$ROOT/index.ts
  else
    PLUGIN_SHA=$(git -C "$ROOT" rev-parse "$PLUGIN_REF^{commit}") || { echo "invalid plugin ref: $PLUGIN_REF" >&2; exit 2; }
    PLUGIN_DIR=/project/tmp/ppo-bench/plugins/$PLUGIN_SHA
    if [[ ! -f $PLUGIN_DIR/index.ts ]]; then
      [[ -d /project/tmp/ppo-bench/plugins ]] || mkdir -p /project/tmp/ppo-bench/plugins
      mkdir -p "$PLUGIN_DIR"
      git -C "$ROOT" archive "$PLUGIN_SHA" | tar -x -C "$PLUGIN_DIR" || exit 2
    fi
    if [[ ! -e $PLUGIN_DIR/node_modules ]]; then ln -s "$ROOT/node_modules" "$PLUGIN_DIR/node_modules"; fi
    PLUGIN=$PLUGIN_DIR/index.ts
  fi
fi

SUBAGENTS=$HOME/.pi/agent/npm/node_modules/pi-subagents
PI_VERSION=$(pi --version 2>&1 | head -n 1)
SUBAGENTS_VERSION=$(node -p "require('$SUBAGENTS/package.json').version" 2>/dev/null || printf unknown)
START=$(date -Is)
python3 - "$RUNS/$ID.meta.json" "$TASK_FILE" "$ARM_FILE" "$REP" "$PLUGIN_SHA" "$WORKTREE_DIRTY" "$PI_VERSION" "$SUBAGENTS_VERSION" "$HOME/.pi/agent/settings.json" "$START" "$PLUGIN_REF" <<'PY'
import json, socket, sys
out,tf,af,rep,sha,dirty,pi,sub,settings,start,plugin_ref=sys.argv[1:]
try: overrides=json.load(open(settings)).get('subagents',{}).get('agentOverrides',{})
except (OSError,ValueError): overrides={}
arm=json.load(open(af)); arm['pluginRef']=plugin_ref
json.dump({'task':json.load(open(tf)),'arm':arm,'rep':rep,'pluginSha':sha or None,'dirty':dirty=='true','piVersion':pi,'piSubagentsVersion':sub,'childOverrides':overrides,'start':start,'hostname':socket.gethostname()},open(out,'w'),indent=2)
PY

BODY=$(<"$PROMPT_FILE")
if [[ -n $PREFIX ]]; then PROMPT="$PREFIX

$BODY"; else PROMPT=$BODY; fi
PI_ARGS=(-ne --model "$ROOT_MODEL" --no-session --mode json -p "$PROMPT")
if [[ $MODE == lite ]]; then PI_ARGS=(-ne -e "$SUBAGENTS" -e "$PLUGIN" --model "$ROOT_MODEL" --no-session --mode json -p "$PROMPT"); fi
if [[ ${BENCH_DRY_RUN:-0} == 1 ]]; then
  (( ${#ARM_ENV[@]} )) && echo "arm env: ${ARM_ENV[*]}"
  python3 - "${PI_ARGS[@]}" "$PROMPT" <<'PY'
import sys
args=sys.argv[1:-1]; prompt=sys.argv[-1]
for i,a in enumerate(args):
 if a==prompt: args[i]=f'<prompt {len(prompt)} chars>'
print('timeout 3600 pi '+' '.join(__import__('shlex').quote(x) for x in args))
PY
  exit 0
fi

source "$HOME/.config/pi/secrets.zsh"
[[ -d $CLONE_ROOT ]] || mkdir -p "$CLONE_ROOT"
rm -rf "$CLONE"
BASE_LINE=$("$ROOT/bench/prepare-clone.sh" "$TASK" "$CLONE") || exit 2
cd "$CLONE" || exit 2
BASE=${BASE_LINE#BASE=}
echo "base=$BASE clone=$CLONE"
T_START=$(date +%s)
if [[ $MODE == lite ]]; then env "${ARM_ENV[@]}" PI_PLANNER_ONLY=1 timeout 3600 pi "${PI_ARGS[@]}" </dev/null >"$RUNS/$ID.jsonl" 2>"$RUNS/$ID.stderr"; else env "${ARM_ENV[@]}" timeout 3600 pi "${PI_ARGS[@]}" </dev/null >"$RUNS/$ID.jsonl" 2>"$RUNS/$ID.stderr"; fi
PI_EXIT=$?
echo $(($(date +%s)-T_START)) >"$RUNS/$ID.wall"
echo "$PI_EXIT" >"$RUNS/$ID.exit"
cd "$CLONE" || exit 2
ARM="$ARM" ID="$ID" "$ROOT/bench/evaluate.sh" "$TASK" "$CLONE" "$BASE" "$RUNS/$ID" || exit 2
CHECK=$(python3 "$ROOT/bench/runcheck.py" "$RUNS/$ID.jsonl")
CHECK_EXIT=$?
CHECK="$CHECK" RUNS="$RUNS" ID="$ID" python3 - <<'PY'
import json, os
p=os.path.join(os.environ['RUNS'],os.environ['ID']+'.eval.json')
ev=json.load(open(p)); result=json.loads(os.environ['CHECK'])
ev['valid']=result['valid']; ev['invalid_reasons']=result['reasons']
json.dump(ev,open(p,'w'),indent=2)
PY
if [[ ${BENCH_KEEP_CLONE:-0} != 1 ]]; then rm -rf "$CLONE"; fi
echo "run_done $ID pi_exit=$PI_EXIT"
if (( CHECK_EXIT != 0 )); then
  reasons=$(python3 -c 'import json,sys; print("; ".join(json.loads(sys.argv[1])["reasons"]))' "$CHECK")
  fail_run 4 "$reasons"
fi

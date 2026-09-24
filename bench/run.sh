#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TASK_ID=${1:?usage: bench/run.sh <task-id> <arm-name> <rep>}
ARM_NAME=${2:?}
REP=${3:?}
: "${BENCH_OUT:?BENCH_OUT must name the campaign output directory}"
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
model_present tcuni-luna/gpt-6-luna || { echo "BLOCKED tcuni-luna/gpt-6-luna"; exit 3; }

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
git clone -q "$REPO" "$CLONE" || exit 2
cd "$CLONE" || exit 2
git config user.email bench@example.com && git config user.name bench
git checkout -q "$PARENT" || exit 2
git checkout -q "$TARGET" -- "${TESTS[@]}" || exit 2
git add -A && git commit -qm 'bench: target tests' || exit 2
BASE=$(git rev-parse HEAD)
echo "base=$BASE clone=$CLONE"
T_START=$(date +%s)
if [[ $MODE == lite ]]; then env "${ARM_ENV[@]}" PI_PLANNER_ONLY=1 timeout 3600 pi "${PI_ARGS[@]}" </dev/null >"$RUNS/$ID.jsonl" 2>"$RUNS/$ID.stderr"; else env "${ARM_ENV[@]}" timeout 3600 pi "${PI_ARGS[@]}" </dev/null >"$RUNS/$ID.jsonl" 2>"$RUNS/$ID.stderr"; fi
PI_EXIT=$?
echo $(($(date +%s)-T_START)) >"$RUNS/$ID.wall"
echo "$PI_EXIT" >"$RUNS/$ID.exit"
cd "$CLONE" || exit 2
git checkout "$BASE" -- "${TESTS[@]}" 2>/dev/null
PYTHONPATH=src "$PYTHON" -m pytest "${TESTS[@]}" >"$RUNS/$ID.eval-target.log" 2>&1; T_EXIT=$?
IGN=(); for t in "${TESTS[@]}"; do IGN+=(--ignore "$t"); done
PYTHONPATH=src "$PYTHON" -m pytest "${IGN[@]}" >"$RUNS/$ID.eval-suite.log" 2>&1; S_EXIT=$?
TASK="$TASK" ARM="$ARM" ID="$ID" CLONE="$CLONE" BASE="$BASE" TESTS_JSON="$TESTS_JSON" T_EXIT="$T_EXIT" S_EXIT="$S_EXIT" BASELINE="$BASELINE" RUNS="$RUNS" python3 - <<'PY'
import json,os,re,subprocess
rid=os.environ['ID']; clone=os.environ['CLONE']; base=os.environ['BASE']
def failures(path):
 try:
  return {m.group(1) for line in open(path) if (m:=re.match(r'^(?:FAILED|ERROR) (\S+)',line))}
 except OSError: return set()
target=sorted(failures(os.path.join(os.environ['RUNS'],rid+'.eval-target.log')))
suite=failures(os.path.join(os.environ['RUNS'],rid+'.eval-suite.log'))
baseline={x.strip() for x in open(os.environ['BASELINE']) if x.strip() and not x.startswith('#')}
tracked=subprocess.run(['git','-C',clone,'diff','--name-only',base],capture_output=True,text=True).stdout.split()
untracked=subprocess.run(['git','-C',clone,'ls-files','--others','--exclude-standard'],capture_output=True,text=True).stdout.split()
changed=set(tracked)|set(untracked); targets=set(json.loads(os.environ['TESTS_JSON']))
out={'task':os.environ['TASK'],'arm':os.environ['ARM'],'id':rid,'pass':not target and not(suite-baseline),'target_failed':target,'new_failures':sorted(suite-baseline),'files_changed':len(changed),'non_target_tests_changed':sorted(p for p in changed if p.startswith('tests/') and p not in targets),'target_test_exit':int(os.environ['T_EXIT']),'suite_exit':int(os.environ['S_EXIT']),'eval_semantics':'masked-suite (baseline and eval both --ignore target tests)'}
json.dump(out,open(os.path.join(os.environ['RUNS'],rid+'.eval.json'),'w'),indent=2); print(json.dumps(out))
PY
if [[ ${BENCH_KEEP_CLONE:-0} != 1 ]]; then rm -rf "$CLONE"; fi
echo "run_done $ID pi_exit=$PI_EXIT"

#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TASK=${1:?usage: bench/evaluate.sh <task-id> <clone> <base> <out-prefix>}
CLONE=${2:?}
BASE=${3:?}
OUT_PREFIX=${4:?}
TASK_FILE=$ROOT/bench/tasks/$TASK.json
readarray -t CONFIG < <(python3 - "$TASK_FILE" <<'PY'
import json,sys
t=json.load(open(sys.argv[1]))
for value in (t['python'], t['baseline'], json.dumps(t['tests'])): print(value)
PY
)
PYTHON=${CONFIG[0]} BASELINE=$ROOT/bench/tasks/${CONFIG[1]} TESTS_JSON=${CONFIG[2]}
ARM=${ARM:-gold}
ID=${ID:-$(basename "$OUT_PREFIX")}
TESTS=(); mapfile -t TESTS < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])))' "$TESTS_JSON")
cd "$CLONE" || exit 2
git checkout "$BASE" -- "${TESTS[@]}" 2>/dev/null
PYTHONPATH=src "$PYTHON" -m pytest "${TESTS[@]}" >"$OUT_PREFIX.eval-target.log" 2>&1; T_EXIT=$?
IGN=(); for t in "${TESTS[@]}"; do IGN+=(--ignore "$t"); done
PYTHONPATH=src "$PYTHON" -m pytest "${IGN[@]}" >"$OUT_PREFIX.eval-suite.log" 2>&1; S_EXIT=$?
TASK="$TASK" ARM="$ARM" ID="$ID" CLONE="$CLONE" BASE="$BASE" TESTS_JSON="$TESTS_JSON" T_EXIT="$T_EXIT" S_EXIT="$S_EXIT" BASELINE="$BASELINE" OUT_PREFIX="$OUT_PREFIX" python3 - <<'PY'
import json,os,re,subprocess
rid=os.environ['ID']; clone=os.environ['CLONE']; base=os.environ['BASE']
def failures(path):
 try:
  return {m.group(1) for line in open(path) if (m:=re.match(r'^(?:FAILED|ERROR) (\S+)',line))}
 except OSError: return set()
target=sorted(failures(os.environ['OUT_PREFIX']+'.eval-target.log'))
suite=failures(os.environ['OUT_PREFIX']+'.eval-suite.log')
baseline={x.strip() for x in open(os.environ['BASELINE']) if x.strip() and not x.startswith('#')}
tracked=subprocess.run(['git','-C',clone,'diff','--name-only',base],capture_output=True,text=True).stdout.split()
untracked=subprocess.run(['git','-C',clone,'ls-files','--others','--exclude-standard'],capture_output=True,text=True).stdout.split()
changed=set(tracked)|set(untracked); targets=set(json.loads(os.environ['TESTS_JSON']))
out={'task':os.environ['TASK'],'arm':os.environ['ARM'],'id':rid,'pass':not target and not(suite-baseline),'target_failed':target,'new_failures':sorted(suite-baseline),'files_changed':len(changed),'non_target_tests_changed':sorted(p for p in changed if p.startswith('tests/') and p not in targets),'target_test_exit':int(os.environ['T_EXIT']),'suite_exit':int(os.environ['S_EXIT']),'eval_semantics':'masked-suite (baseline and eval both --ignore target tests)'}
json.dump(out,open(os.environ['OUT_PREFIX']+'.eval.json','w'),indent=2); print(json.dumps(out))
PY

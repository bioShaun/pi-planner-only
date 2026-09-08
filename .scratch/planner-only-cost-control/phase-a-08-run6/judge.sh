#!/usr/bin/env bash
# Ticket 08 acceptance, r6. Prints each clause's literal command and its real output.
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run6
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r6
LOG="$RUN/artifacts/root-session.jsonl"
SA="$RUN/artifacts/subagent-artifacts"
LEDGER="$RUN/artifacts/usage.jsonl"

hdr() { printf '\n===== %s =====\n' "$*"; }
run() { printf '$ %s\n' "$*"; eval "$@"; printf '[exit=%s]\n' "$?"; }

hdr "C1 strict mode + review mode"
run "cat '$RUN/env.txt'"
run "grep -c 'review mode: root' '$LOG'"
run "grep -c 'review mode: fresh' '$LOG'"

hdr "C2 planner_verdict PASS / usage last state"
run "grep -o 'planner_verdict[^\"]*' '$LOG' | sort | uniq -c"
run "grep -o '\"verdict\":\"[a-z_]*\"' '$LOG' | sort | uniq -c"
run "python3 - <<'PY'
import json
for r in (json.loads(l) for l in open('$LEDGER') if l.strip()):
    print({k: r.get(k) for k in ('taskId','state','rounds','rootModel','finishedAt','incomplete','unattributed')})
PY"
run "cat '$RUN/exit.txt'"

hdr "C3 oracle ran"
run "python3 -c 'import json,glob,sys; print(sum(json.load(open(f)).get(\"agent\") in (\"oracle\",\"validator\") for f in glob.glob(sys.argv[1])))' '$SA/*_meta.json'"

hdr "C4 reviewer ran"
run "python3 -c 'import json,glob,sys; print(sum(json.load(open(f)).get(\"agent\") in (\"reviewer\",\"explorer\") for f in glob.glob(sys.argv[1])))' '$SA/*_meta.json'"

hdr "C5 ReviewResult produced by that reviewer's _output.md"
for m in $(python3 -c 'import json,glob,sys
for f in sorted(glob.glob(sys.argv[1])):
    if json.load(open(f)).get("agent") in ("reviewer","explorer"): print(f)' "$SA/*_meta.json" 2>/dev/null); do
  rid=$(basename "$m" | cut -d_ -f1)
  for o in $SA/${rid}_*_output.md; do
    [ -f "$o" ] || continue
    printf '\n--- %s ---\n' "$o"
    run "grep -c '\"verdict\"' '$o'"
    run "grep -c '\"findings\"' '$o'"
    run "head -60 '$o'"
  done
done

hdr "C6 evidence attribution > 0"
run "grep -o 'attributed [0-9]* path' '$LOG' | tail -1"
run "grep -o 'attributed [0-9]* path' '$LOG' | sort | uniq -c"

hdr "C7 no placeholder task"
run "grep -c 'Placeholder task' '$LOG'"

hdr "C8 no WorkerReport parse error"
run "grep -c 'not a valid WorkerReport' '$LOG'"

hdr "C9 validator delegated at most once / async waits"
run "grep -o '\"agent\": \"[a-z]*\"' $SA/*_meta.json | sed 's#.*/##' | cut -d: -f2- | sort | uniq -c"
# The receipt reads "Async delegation for task <id> has started (runId: ...)";
# the old literal 'Async delegation has started' never matches (r6: false 0).
run "grep -o 'Async delegation for task [^ ]* has started' '$LOG' | sort | uniq -c"
run "grep -o 'bg_wait id=[0-9a-f-]*' '$LOG' | sort | uniq -c"
run "grep -o 'bg_wait[^\"]\\{0,60\\}' '$LOG' | head -20"

hdr "C10 worktree clean"
run "git -C '$WT' status --porcelain"

hdr "C11 turns per delegation"
run "python3 - <<'PY'
import json,glob,os
for m in sorted(glob.glob('$SA/*_meta.json')):
    d=json.load(open(m))
    u=d.get('usage',{})
    print(os.path.basename(m), d.get('agent'), 'turns=%s'%u.get('turns'), 'cost=%s'%u.get('cost'), 'exit=%s'%d.get('exitCode'), 'error' if 'error' in d else '')
PY"

hdr "C12 comparison.md exists"
run "test -f '$RUN/comparison.md'; echo present=\$?"

hdr "C13 slot preflight recorded"
run "head -20 '$RUN/slot-preflight.txt'"

hdr "C14 ledger consistency"
run "python3 - <<'PY'
import json,glob,os
rows=[json.loads(l) for l in open('$LEDGER') if l.strip()]
# Ticket 35 shutdown flush can add a second (unattributed) row; the ledger is
# the union of every row's children, not just the last line's.
ledger={c.get('runId') for r in rows for c in r.get('children',[]) if c.get('runId')}
metas={}
for m in glob.glob('$SA/*_meta.json'):
    d=json.load(open(m)); metas[d['runId']]=(d.get('agent'), d.get('usage',{}).get('cost'))
mset=set(metas)
print('ledger runIds (%d):'%len(ledger)); [print('  ',r) for r in sorted(ledger)]
print('meta runIds (%d):'%len(mset)); [print('  ',r,metas[r]) for r in sorted(mset)]
print('meta - ledger:', sorted(mset-ledger))
print('ledger - meta:', sorted(ledger-mset))
print('EQUAL:', mset==ledger)
missing=sum(metas[r][1] or 0 for r in (mset-ledger))
print('unrecorded cost: %.8f'%missing)
for r in rows:
    print('row', r['taskId'], 'state=', r.get('state'), 'incomplete=', r.get('incomplete'),
          'unattributed=', r.get('unattributed'), 'rootCostUsd=', r.get('root',{}).get('costUsd'),
          'children=', [(c.get('agent'), c.get('costUsd')) for c in r.get('children',[])])
total=sum(r.get('root',{}).get('costUsd') or 0 for r in rows)+sum(c.get('costUsd') or 0 for r in rows for c in r.get('children',[]))
print('ledger total cost: %.8f'%total)
PY"

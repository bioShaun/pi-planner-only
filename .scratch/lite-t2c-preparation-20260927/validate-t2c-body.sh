#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/tcuni-claw/pi/pi-planner-only
EFFORT=$ROOT/.scratch/lite-t2c-preparation-20260927
RUN=${1:?pass a fresh validation directory}
[[ $RUN == "$EFFORT"/validation.* && -d $RUN ]] || exit 2
SOURCE=$EFFORT/task-source
PARENT=a131527abe53dc8a55a45e3ccb88f8ad7ef24a4b
ORIGINAL=46d408a34211bf39558430342abc97bc71e655f8
TARGET=c3dd01696b2757cbcb2055d26c1c5e4b38028c5d
PYTHON=/public/scripts/tc-probe-design-v2/.venv/bin/python
TESTS=(tests/contracts/test_ref_alt_stage_fold_to_long.py tests/contracts/test_allele_pair_empty_source_schema.py)
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src
: "${TMPDIR:?guard must set external TMPDIR}"
[[ $TMPDIR == /project/tmp/* && -d $TMPDIR ]]
for ref in "$PARENT" "$ORIGINAL" "$TARGET"; do
  git -C "$SOURCE" cat-file -e "$ref^{commit}"
done
git -C "$SOURCE" bundle verify "$EFFORT/task-source.bundle" > "$RUN/bundle-verify.log" 2>&1
git init -q "$RUN/reconstructed"
git -C "$RUN/reconstructed" fetch -q --no-tags "$EFFORT/task-source.bundle" refs/heads/t2c-parent:refs/heads/t2c-parent refs/heads/t2c-original:refs/heads/t2c-original refs/heads/t2c-target:refs/heads/t2c-target
for ref in t2c-parent t2c-original t2c-target; do git -C "$RUN/reconstructed" rev-parse "refs/heads/$ref"; done > "$RUN/reconstructed-refs.log"
diff -u <(printf '%s\n' "$PARENT" "$ORIGINAL" "$TARGET") "$RUN/reconstructed-refs.log"

"$ROOT/bench/prepare-clone.sh" T2c "$RUN/candidate" > "$RUN/prepare.log" 2>&1
BASE=$(sed -n 's/^BASE=//p' "$RUN/prepare.log")
[[ $BASE =~ ^[0-9a-f]{40}$ ]]
[[ -z $(git -C "$RUN/candidate" remote) ]]
if git -C "$RUN/candidate" show-ref > "$RUN/candidate-refs.log" 2>&1; then echo 'Unexpected refs' >&2; exit 1; fi
git -C "$RUN/candidate" cat-file -e "$PARENT^{commit}"
for ref in "$ORIGINAL" "$TARGET"; do
  if git -C "$RUN/candidate" cat-file -e "$ref^{commit}" 2>/dev/null; then echo "Unexpected reachable source commit: $ref" >&2; exit 1; fi
  if git -C "$RUN/candidate" cat-file -e "${ref:0:7}^{commit}" 2>/dev/null; then echo "Unexpected reachable source short ref: ${ref:0:7}" >&2; exit 1; fi
  if git -C "$RUN/candidate" cat-file -e "${ref:0:12}^{commit}" 2>/dev/null; then echo "Unexpected reachable source short ref: ${ref:0:12}" >&2; exit 1; fi
done
for test in "${TESTS[@]}"; do
  cmp "$RUN/candidate/$test" "$SOURCE/$test"
done
git -C "$SOURCE" show "$ORIGINAL:${TESTS[0]}" | cmp - "$RUN/candidate/${TESTS[0]}"
git -C "$RUN/reconstructed" show "refs/heads/t2c-target:${TESTS[0]}" | cmp - "$RUN/candidate/${TESTS[0]}"
git -C "$RUN/reconstructed" show "refs/heads/t2c-target:${TESTS[1]}" | cmp - "$RUN/candidate/${TESTS[1]}"
git init -q "$RUN/reconstructed-candidate"
git -C "$RUN/reconstructed-candidate" fetch -q --no-tags "file://$RUN/reconstructed" "$PARENT"
git -C "$RUN/reconstructed-candidate" checkout -q --detach FETCH_HEAD
for test in "${TESTS[@]}"; do
  mkdir -p "$RUN/reconstructed-candidate/$(dirname "$test")"
  git -C "$RUN/reconstructed" show "refs/heads/t2c-target:$test" > "$RUN/reconstructed-candidate/$test"
  cmp "$RUN/reconstructed-candidate/$test" "$RUN/candidate/$test"
done
git -C "$RUN/reconstructed-candidate" add -A
git -C "$RUN/reconstructed-candidate" config user.email bench@example.com
git -C "$RUN/reconstructed-candidate" config user.name bench
git -C "$RUN/reconstructed-candidate" commit -qm 'bench: target tests'
[[ $(git -C "$RUN/reconstructed-candidate" rev-parse HEAD^{tree}) == $(git -C "$RUN/candidate" rev-parse HEAD^{tree}) ]]
printf 'candidate BASE=%s; both target tests byte-identical; no source refs/remotes reachable\n' "$BASE" > "$RUN/isolation.log"

set +e
(cd "$RUN/candidate" && "$PYTHON" -m pytest -q -p no:cacheprovider "${TESTS[@]}") > "$RUN/parent-target-red.log" 2>&1
RED=$?
set -e
printf 'parent-target exit=%s\n' "$RED" >> "$RUN/exits.log"
[[ $RED -ne 0 ]] && rg -q 'ModuleNotFoundError: No module named .tc_probe_design.orchestration._allele_pair_stage.' "$RUN/parent-target-red.log"

(cd "$RUN/candidate" && "$PYTHON" -m pytest -q -p no:cacheprovider --ignore "${TESTS[0]}" --ignore "${TESTS[1]}") > "$RUN/parent-masked-suite.log" 2>&1
printf 'parent-masked-suite exit=0\n' >> "$RUN/exits.log"
rg -q '(^|[^0-9])2652 passed\b' "$RUN/parent-masked-suite.log"

git -C "$SOURCE" diff --binary "$PARENT" "$TARGET" -- . ':(exclude)tests' | git -C "$RUN/candidate" apply --index
ARM=gold ID=t2c-gold "$ROOT/bench/evaluate.sh" T2c "$RUN/candidate" "$BASE" "$RUN/gold" > "$RUN/evaluate.stdout.log" 2>&1
printf 'evaluate exit=0\n' >> "$RUN/exits.log"
python3 - "$RUN/gold.eval.json" "$RUN/gold.eval-target.log" "$RUN/gold.eval-suite.log" <<'PY'
import json
import re
import sys
from pathlib import Path

result = json.loads(Path(sys.argv[1]).read_text())
target = Path(sys.argv[2]).read_text()
suite = Path(sys.argv[3]).read_text()
assert result['target_test_exit'] == result['suite_exit'] == 0, result
assert result['target_failed'] == result['new_failures'] == [], result
assert result['non_target_tests_changed'] == [], result
assert re.search(r'54 passed\b', target), target[-1000:]
assert re.search(r'\b2652 passed\b', suite), suite[-1000:]
print('target=54 passed; suite=zero failures; target_exit=0; suite_exit=0')
PY
printf 'PASSED complete validation evidence=%s\n' "$RUN"

#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/tcuni-claw/pi/pi-planner-only
EFFORT=$ROOT/.scratch/lite-short-temp-20260927
ORIGINAL=/project/tmp/ppo-bench/clones/opus-cross-task-t1-t2c-20260927-T1-native-opus-calibration-1
ARCHIVE=$ROOT/.scratch/lite-t2c-preparation-20260927/execution/evidence/T1-native-opus-calibration-1
BASE=4aab15597bf291bec38ce0d6248623c17f810ab6
PY=/public/scripts/tc-probe-design-v2/.venv/bin/python
mkdir -p "$EFFORT/matrix"
hash_preserved() {
  "$PY" - "$EFFORT/preserve.sha256.json" "$1" <<'PY'
import hashlib, json, sys
listed = json.load(open(sys.argv[1]))
actual = {p: hashlib.sha256(open(p, 'rb').read()).hexdigest() for p in listed}
diff = sorted(p for p in listed if actual[p] != listed[p])
json.dump({'preserved': len(listed), 'changed': diff}, open(sys.argv[2], 'w'), indent=2)
assert not diff, diff
PY
}
hash_preserved "$EFFORT/matrix/preserve-before.json"
for source in baseline changed; do
  for length in long short; do
    name="$source-$length"
    case_dir="$EFFORT/matrix/$name"
    clone="$case_dir/clone"
    mkdir -p "$case_dir"
    if [[ "$length" == long ]]; then
      # Prefix length 21 + 62 characters = exactly 83 physical path bytes.
      suffix="${name}$(printf '%*s' "$((62-${#name}))" '' | tr ' ' x)"
      temp="/project/tmp/ls-long-$suffix"
    else
      temp="/project/tmp/ls-72927a/$name"
    fi
    mkdir -p "$temp"
    [[ ${#temp} -eq 83 && "$length" == long || "$length" == short && ${#temp} -lt 50 ]]
    [[ $(realpath "$temp") == "$temp" ]]
    printf 'source=%s path_length=%s temp=%s\n' "$source" "${#temp}" "$temp" > "$case_dir/config.log"
    git clone --no-local --quiet "$ORIGINAL" "$clone"
    git -C "$clone" checkout --quiet "$BASE"
    [[ $(git -C "$clone" rev-parse HEAD) == "$BASE" ]]
    if [[ "$source" == changed ]]; then
      git -C "$clone" apply "$ARCHIVE/changes.patch"
    fi
    "$PY" - "$ARCHIVE/manifest.json" "$clone" "$source" "$case_dir/source-verification.json" <<'PY'
import hashlib, json, pathlib, sys
manifest = json.load(open(sys.argv[1]))
clone = pathlib.Path(sys.argv[2])
source = sys.argv[3]
result = {}
for entry in manifest['files']:
    expected = entry[f'{"after" if source == "changed" else "before"}_sha256']
    actual = hashlib.sha256((clone / entry['path']).read_bytes()).hexdigest()
    result[entry['path']] = {'expected': expected, 'actual': actual, 'match': actual == expected}
json.dump(result, open(sys.argv[4], 'w'), indent=2)
assert all(r['match'] for r in result.values()), [k for k, v in result.items() if not v['match']]
PY
    git -C "$clone" status --short > "$case_dir/status-before.log"
    env TMPDIR="$temp" TMP="$temp" TEMP="$temp" PYTHONDONTWRITEBYTECODE=1 "$PY" "$EFFORT/guard-evaluate.py" T1 "$clone" "$BASE" "$case_dir/result" > "$case_dir/evaluator.stdout.log" 2> "$case_dir/evaluator.stderr.log"
    printf 'eval_shell_exit=0\n' >> "$case_dir/config.log"
    git -C "$clone" status --short > "$case_dir/status-after.log"
    "$PY" - "$case_dir/result.eval-target.log" "$case_dir/result.eval-suite.log" "$case_dir/result.eval.json" "$case_dir/summary.json" <<'PY'
import json, re, sys
target = open(sys.argv[1]).read()
suite = open(sys.argv[2]).read()
evaluation = json.load(open(sys.argv[3]))
def counts(text):
    lines = [s for s in text.splitlines() if re.search(r'\b(?:passed|failed|error|errors|skipped)\b', s) and ' in ' in s]
    return lines[-1] if lines else 'NO SUMMARY'
json.dump({'target': counts(target), 'suite': counts(suite), 'target_exit': evaluation['target_test_exit'], 'suite_exit': evaluation['suite_exit'], 'target_failures': evaluation['target_failed'], 'new_failures': evaluation['new_failures'], 'pass': evaluation['pass']}, open(sys.argv[4], 'w'), indent=2)
print(sys.argv[4], counts(target), counts(suite), flush=True)
PY
  done
done
hash_preserved "$EFFORT/matrix/preserve-after.json"

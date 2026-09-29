#!/usr/bin/env bash
# Controlled check: does the thinking level reach tcuni/gpt-6-luna? Same prompt, low vs high, 2 runs each.
set -euo pipefail
OUT=/project/tmp/rdt/effort
mkdir -p "$OUT"
cd "$OUT"
export TMPDIR=/project/tmp/rdt/tmp; mkdir -p "$TMPDIR"
PROMPT='A function merges overlapping integer intervals [a,b] (inclusive). Inputs may be unsorted, may touch (e.g. [1,2] and [3,4] are adjacent but not overlapping), may contain a<b violations, and may be empty. List the minimal set of test cases that distinguishes a correct implementation from the three most likely buggy ones, and for each bug name the case that exposes it. Answer in at most 12 lines. Do not use tools.'
for level in low high; do
  for i in 1 2; do
    start=$(date +%s)
    timeout 300 pi --no-extensions --no-session --mode json --model tcuni/gpt-6-luna --thinking "$level" -p "$PROMPT" > "$level-$i.jsonl" 2> "$level-$i.err" || echo "exit $? for $level-$i"
    echo "$level-$i wall=$(( $(date +%s) - start ))s"
  done
done
python3 - <<'EOF'
import json,glob,os
for f in sorted(glob.glob('*.jsonl')):
    u=None
    for l in open(f):
        try: e=json.loads(l)
        except Exception: continue
        m=e.get('message') if isinstance(e,dict) else None
        if isinstance(m,dict) and m.get('role')=='assistant' and m.get('usage'): u=m['usage']
    print(f, {k:(u or {}).get(k) for k in ('input','output','reasoning','totalTokens')})
EOF

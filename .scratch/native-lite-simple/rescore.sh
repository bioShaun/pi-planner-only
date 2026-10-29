#!/usr/bin/env bash
# Usage: rescore.sh BATCH_DIR   re-runs score.mjs on every finished run, then summarize.mjs.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
B=$(cd "${1:?usage: rescore.sh BATCH_DIR}" 2>/dev/null && pwd) || { echo "rescore: no such batch dir: $1" >&2; exit 2; }
[ -f "$B/results.md" ] || { echo "rescore: $B has no results.md yet; the batch has not finished" >&2; exit 2; }
# Program text avoids the literal script name so awk does not match its own command line.
active=$(ps -eo pid=,args= | B="$B" awk 'index($0, "run-all" ".sh") && (index($0 " ", ENVIRON["B"] " ") || index($0, ENVIRON["B"] "/")) { print $1 }')
[ -z "$active" ] || { echo "rescore: run-all is still active for $B (pid $(echo $active))" >&2; exit 2; }
shopt -s nullglob
runs=("$B"/runs/*/)
(( ${#runs[@]} )) || { echo "rescore: no runs under $B/runs" >&2; exit 2; }
for r in "${runs[@]}"; do [ -f "$r/meta.json" ] || { echo "rescore: ${r%/} has no meta.json" >&2; exit 2; }; done
mkdir -p "$B/tmp"; export TMPDIR=$B/tmp TMP=$B/tmp TEMP=$B/tmp
status=0
for r in "${runs[@]}"; do node "$HERE/score.mjs" "${r%/}" || { echo "rescore: scoring ${r%/} failed" >&2; status=1; }; done
node "$HERE/summarize.mjs" "$B" >/dev/null || status=1
echo "rescore: ${#runs[@]} run(s) rescored; results in $B/results.md"
exit $status

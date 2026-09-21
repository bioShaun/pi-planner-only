#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd -- "$here/../../.." && pwd)"
test -d "$here"
test -d /project/tmp
action="${1:?release|focused|host|strict|cli-probe}"
run_dir="$(mktemp -d "$here/$action-XXXXXX")"
tmp_root="$(mktemp -d /project/tmp/runaway-validation-XXXXXX)"
export TMPDIR="$tmp_root" TMP="$tmp_root" TEMP="$tmp_root"
export npm_config_cache="$run_dir/npm-cache"
export PYTHONDONTWRITEBYTECODE=1
mkdir "$npm_config_cache"
cd "$repo"
date -u +%FT%TZ > "$run_dir/started-at.txt"
printf '%s\n' "$tmp_root" > "$run_dir/tmp-root.txt"
sha256sum ./*.ts ./*.test.mjs package.json > "$run_dir/source-before.sha256"
case "$action" in
 release) command=(timeout --kill-after=10 300 npm run test:release);;
 focused) command=(timeout --kill-after=10 180 node --experimental-strip-types delegate.test.mjs);;
 host) command=(timeout --kill-after=10 320 node "$here/host-acceptance.mjs");;
 cli-probe) command=(timeout --kill-after=5 45 env RUST_LOG=codex_core=info,codex_exec=info codex exec --sandbox read-only --json "Return exactly READY. Do not call tools.");;
 strict) test -f "$here/ReviewRequest.md"; command=(bash /home/tcuni-claw/.codex/review-readonly.sh "$here/ReviewRequest.md");;
 *) exit 2;;
esac
printf '%q ' "${command[@]}" > "$run_dir/command.txt"
slot audit > "$run_dir/slot-audit.txt" 2> "$run_dir/slot-audit.stderr"
slot status > "$run_dir/slot-status.txt" 2>&1
node .scratch/stability-next-20260920/slot-audit-gate.mjs "$run_dir/slot-audit.txt" "$run_dir/slot-audit.stderr"
set +e
slot cpu -- "${command[@]}" > "$run_dir/stdout.log" 2> "$run_dir/stderr.log"
status=$?
set -e
printf '%s\n' "$status" > "$run_dir/exit-code.txt"
date -u +%FT%TZ > "$run_dir/finished-at.txt"
sha256sum ./*.ts ./*.test.mjs package.json > "$run_dir/source-after.sha256"
cmp "$run_dir/source-before.sha256" "$run_dir/source-after.sha256"
printf '%s exit=%s evidence=%s\n' "$action" "$status" "$run_dir"
tail -n 12 "$run_dir/stdout.log"
tail -n 12 "$run_dir/stderr.log"
exit "$status"


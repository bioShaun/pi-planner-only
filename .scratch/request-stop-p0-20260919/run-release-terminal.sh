#!/usr/bin/env bash
# Run from an ordinary terminal or CI, never a sandboxed agent executor.
set -euo pipefail
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$task_dir/../.." && pwd)"
test -d "$task_dir"
cd -- "$repo_dir"
run_dir="$(mktemp -d "$task_dir/release-run-XXXXXX")"
mkdir -- "$run_dir/npm-cache"
# evidence.test.mjs asserts that a fresh tmpdir() directory is NOT inside any Git
# repository, so the temp root must live outside this worktree. /project/tmp is
# the sanctioned local (non-NFS, non-tmpfs) scratch area; never /tmp.
test -d /project/tmp
if git -C /project/tmp rev-parse --git-dir >/dev/null 2>&1; then
  echo "refusing: /project/tmp is inside a Git repository" >&2; exit 3
fi
tmp_root="$(mktemp -d /project/tmp/pi-planner-only-release-XXXXXX)"
printf '%s\n' "$tmp_root" > "$run_dir/tmp-root.txt"
export TMPDIR="$tmp_root" TMP="$tmp_root" TEMP="$tmp_root"
export npm_config_cache="$run_dir/npm-cache"
date -u +%FT%TZ > "$run_dir/started-at.txt"
git status --short > "$run_dir/status-before.txt"
git diff --binary > "$run_dir/tracked.patch"
sha256sum ./*.ts ./*.test.mjs package.json > "$run_dir/source-before.sha256"
node --version > "$run_dir/node-version.txt"
npm --version > "$run_dir/npm-version.txt"
slot audit > "$run_dir/slot-audit.txt" 2>&1
slot status > "$run_dir/slot-status.txt" 2>&1
cat "$run_dir/slot-audit.txt" "$run_dir/slot-status.txt"
# A single job respects the shared pool; never change capacity or kill others.
set +e
slot cpu -- npm run test:release 2>&1 | tee "$run_dir/test-release.log"
release_status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$release_status" > "$run_dir/exit-code.txt"
git status --short > "$run_dir/status-after.txt"
sha256sum ./*.ts ./*.test.mjs package.json > "$run_dir/source-after.sha256"
cmp "$run_dir/source-before.sha256" "$run_dir/source-after.sha256"
printf 'Release exit: %s; evidence: %s\n' "$release_status" "$run_dir"
exit "$release_status"

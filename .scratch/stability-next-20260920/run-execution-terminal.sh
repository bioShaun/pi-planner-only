#!/usr/bin/env bash
# Ordinary host terminal/CI only. Each heavy child owns its slot preflight.
set -euo pipefail
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$task_dir/../.." && pwd)"
evidence_dir="$task_dir/execution-20260920"
test -d "$evidence_dir"
test -d /project/tmp
runtime_dir="$(mktemp -d /project/tmp/planner-execution-XXXXXX)"
export TMPDIR="$runtime_dir" TMP="$runtime_dir" TEMP="$runtime_dir"
export PYTHONDONTWRITEBYTECODE=1
export STUDY_ROOT_MODEL='tcuni-agy/gemini-3.8-flash-high'
export STUDY_CHILD_MODEL='tcuni-luna/gpt-5.6-luna'
export STUDY_THINKING=low
unset STUDY_ARM STUDY_CASE STUDY_TUI_SCENARIO
export npm_config_cache="$evidence_dir/npm-cache"
mkdir -p -- "$npm_config_cache"
cd -- "$repo_dir"
action="${1:?probe|tui|study|release|p1|strict|strict-summary|harness}"
case "$action" in
 probe) command=(node "$task_dir/run-report-only.mjs");;
 tui) scenario="${2:?queued|scheduled|combined}"; command=(node "$task_dir/run-study.mjs" --tui "--tui-scenario=$scenario");;
 study) export STUDY_REPEATS=3; command=(node "$task_dir/run-study.mjs");;
 release) command=(bash "$task_dir/run-release-terminal.sh");;
 p1) command=(npm run test:p1);;
 strict)
  case "${2:-code}" in
   code) review_request="$task_dir/ReviewRequest.md"; export REVIEW_READONLY_TIMEOUT=600;;
   evidence) review_request="$task_dir/ReviewEvidenceRequest.md"; export REVIEW_READONLY_TIMEOUT=600;;
   *) echo "invalid strict scope" >&2; exit 2;;
  esac
  command=(bash "$task_dir/run-strict-terminal.sh" "$review_request");;
 strict-summary)
  [[ "${2:-}" =~ ^strict-run-[A-Za-z0-9]+$ ]] || exit 2
  if [[ -f "$task_dir/$2/review-timeout.txt" ]]; then
   read -r REVIEW_READONLY_TIMEOUT < "$task_dir/$2/review-timeout.txt"
   export REVIEW_READONLY_TIMEOUT
  fi
  command=(node "$task_dir/issue06/summarize-run.mjs" "$task_dir/$2");;
 harness) command=(node "$task_dir/check-harness.mjs");;
 *) echo "invalid action" >&2; exit 2;;
esac
log_prefix="$evidence_dir/$action-${2:-run}-$(date -u +%Y%m%dT%H%M%SZ)"
printf '%s\n' "$runtime_dir" > "$log_prefix.tmp-root.txt"
date -u +%FT%TZ > "$log_prefix.started-at.txt"
printf '%q ' "${command[@]}" > "$log_prefix.command.txt"
sha256sum ./*.ts ./*.test.mjs package.json > "$log_prefix.source-before.sha256"
sha256sum "$task_dir"/*.mjs "$task_dir"/*.ts "$task_dir"/*.py "$task_dir"/*.sh "$task_dir/issue06/summarize-run.mjs" > "$log_prefix.harness-before.sha256"
set +e
"${command[@]}" 2>&1 | tee "$log_prefix.log"
result=${PIPESTATUS[0]}
set -e
printf '%s\n' "$result" > "$log_prefix.exit-code.txt"
date -u +%FT%TZ > "$log_prefix.finished-at.txt"
sha256sum ./*.ts ./*.test.mjs package.json > "$log_prefix.source-after.sha256"
cmp "$log_prefix.source-before.sha256" "$log_prefix.source-after.sha256"
sha256sum "$task_dir"/*.mjs "$task_dir"/*.ts "$task_dir"/*.py "$task_dir"/*.sh "$task_dir/issue06/summarize-run.mjs" > "$log_prefix.harness-after.sha256"
cmp "$log_prefix.harness-before.sha256" "$log_prefix.harness-after.sha256"
printf 'Action %s exit %s; log: %s\n' "$action" "$result" "$log_prefix.log"
exit "$result"

#!/usr/bin/env bash
# Run a fresh Reviewer below a parent whose filesystem policy is read-only.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash %s REVIEW_REQUEST.md\n' "$0" >&2
  exit 2
fi
for dependency in codex python3; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf 'review-readonly: required command not found: %s\n' "$dependency" >&2
    exit 127
  fi
done
# The parent is a relay: probe, spawn, wait, relay. Its own reasoning latency is
# charged against the same 240-second deadline as the child's review, so it runs
# at low effort. The child keeps the effort fixed in its role file; verify from
# the child's turn_context, never from the parent's self-report.
parent_effort="${REVIEW_READONLY_PARENT_EFFORT:-low}"
set +e
{
  cat <<'PROMPT'
Run one independent review in the current project. You are a read-only Root.
Delegate the ReviewRequest below to agent_type astra_reviewer, task_name independent_review,
with fork_turns="none". Do not override the role model or effort. Use no other agents.
Provide the request as a self-contained task. The child must not delegate further.
Wait for the child to finish and return its verdict, evidence, and limitations faithfully.
Do not edit files or run implementation work. The entire run has a 240-second external deadline.
If the role cannot load, report BLOCKED with the actual error; do not impersonate it.
Confirm the parent and child actual runtime filesystem permissions with evidence. A role TOML
or behavioral refusal is not proof of read-only enforcement. Missing executable evidence is BLOCKED.
Budget: the deadline covers your own steps too. Prove your permission with one command, then
spawn at once. While waiting, only call wait; send no messages to the child. When the child
completes, relay its final message immediately in your final answer, without any further
command, verification, or message.

ReviewRequest:
PROMPT
  cat -- "$1"
} | python3 "$(dirname "$0")/run-bounded.py" --timeout 240 --grace 10 codex exec --sandbox read-only -c "model_reasoning_effort=\"$parent_effort\"" --json -
launcher_status=$?
set -e
case "$launcher_status" in
  0) printf 'review-readonly: session completed; inspect the emitted reviewer verdict and runtime-permission evidence\n' >&2 ;;
  124) printf 'review-readonly: 240-second deadline exceeded\n' >&2 ;;
  137) printf 'review-readonly: process killed after grace period; confirm no residual process before continuing\n' >&2 ;;
  *) printf 'review-readonly: launch/session failed (exit %s)\n' "$launcher_status" >&2 ;;
esac
exit "$launcher_status"

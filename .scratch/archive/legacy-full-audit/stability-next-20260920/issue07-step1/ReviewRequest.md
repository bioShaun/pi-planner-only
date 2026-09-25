# Issue 07 step one — ordinary review

Review only the implementation in `implementation.patch`, against the step-one requirements in `../issues/07-execution-duration-and-request-remaining.md`. No step-two envelope/reserve policy or P3 measurement is in scope. The actual diagnostics tool is `planner_tasks`, not `planner_status`.

Requirements: durable execution REQUEST outbound and launcher STARTED receipt timestamps, terminal end and monotonic duration with explicit basis excluding pre-launch Git; unknown remains unknown; structured original Request deadline, remaining milliseconds and observation time; Request closure cause/time attached without changing endedReason. No timer, allowance, repair or Writer hold changes. Cover normal, waiting, cancelled, late terminal, restored ledger, Request re-entry/history and wall-clock rollback.

Implementation report: worker completed six production modules (`types.ts`, `delegate.ts`, `request-control.ts`, `index.ts`, `orchestrate.ts`, `ledger-store.ts`), focused tests and README. Duration basis is REQUEST outbound to finalization including existing quiescence. Grace expiry without terminal retains unknown end/duration. Root additionally fixed the observation clock in an existing `index.test.mjs` complete-output equality test; all original assertions remain.

Evidence:
- `status-before.txt`, `baseline.patch`: pre-existing unrelated dirty changes, preserved.
- `implementation.patch`, `diff-stat.txt`, `review-source.sha256`: this review's frozen code and documentation scope, relative to HEAD (these files were clean at start).
- `focused-checks.txt`: worker checks and commands.
- `../release-run-LQKWmo/`: initial release exit 1, changing observation time broke existing complete-output equality test.
- `../release-run-kB3SJj/`: full ordinary-terminal `npm run test:release` exit 0 after fixing the fixture clock; full log, preflight slot audit/status, source hashes and exit code retained. Before/after source hashes match.
- `../execution-20260920/release-run-20260920T125712Z.*`: outer terminal command, output, exit and hashes.

Independently inspect code, requirements and executable evidence. Report PASS / REQUEST_CHANGES / BLOCKED, findings with location/impact/evidence/minimal correction, coverage and limitations. This is an ordinary review; do not claim strict runtime read-only isolation. No edits or child agents. Do not run tests that spawn subprocesses or full release from sandbox; existing terminal evidence is available. No temporary files under /tmp; authorized task intermediates only in verified project scratch or /project/tmp. Commands over one minute, over 2 GiB or heavy /data_0 IO require slot plus logged audit/status beforehand. Advisory review budget: assess at 5 minutes, return coverage or evidence gaps rather than broadening without bound.

# Fresh behavioral corrective review, round 2

Reviewer: native astra_reviewer, review_request_p0_corrections, fork_turns=none. Read-only behavioral review only; no runtime isolation claim. Root saved the returned report; reviewer ran no tests and wrote no files.

Verdict: REQUEST_CHANGES. Pending invocation resume finding is closed; provider/report terminal mappings and invalid/duplicate launch status mappings are present with the required precedence and event-adapter coverage. All63 frozen hashes matched.

Remaining finding (Medium, request-events.ts:50–61): confirmed launch_failure outcomes still fall into unknown-failure without a classifiable errorCode. delegate.ts deliberately types failed terminals with zero turns/duration as launch_failure and also uses that reason for plain launcher exceptions. This conflates a typed launch family with unrelated unknown events. Map reason launch_failure to an explicit launch family (existing contract:delegation:launch) after coded exception precedence; add a failed terminal with zero-use metadata regression.

Evidence assessment: typecheck and request-control passed. Expanded request-stop first reached old15s suite watchdog; retained retry with30s watchdog passed in18.4s. Full acceptance remains BLOCKED: strict launcher did not start, runtime isolation unproved; normal-terminal release/subprocess, real CLI/TUI/0.69 launcher, post-correction SDK run and natural-language/default calibration evidence were absent at review time. Root accepted the remaining typed-reason correction. The subsequent SDK run is recorded in review-r3; this report remains historical.

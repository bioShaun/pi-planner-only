# Fresh behavioral code review, round 1

Reviewer: native astra_reviewer, review_request_p0_code, fork_turns=none. This was an in-session behavioral review and is NOT the required strict gate. No review file writes or tests were performed by the reviewer; Root saved the returned report here.

Verdict: REQUEST_CHANGES.

1. High — request-control.ts:417 operator resume checks idle/executing/fault but omits pending claims with waitSettled=false. A reload with a committed unresolved claim can replenish the Request despite the approved requirement to wait for old invocations. request-control.test.mjs:165 codifies the opposite. Fix: reject current claims with !waitSettled and invert/add regression. This finding does not apply to an invocation already returned after cancel grace with waitSettled=true, stop=unconfirmed and a retained Writer hold.
2. Medium — request-events.ts:50 maps confirmed terminal provider failures to unknown-failure, although delegate.ts:89 already stamps provider_failure for failed/unavailable_context. Stable terminal reasons/statuses must map to the approved families before unknown fallback. Add request-level terminal response coverage.

Independent observations: every file matched source.sha256; reviewer inspected Request persistence/admission/dispatch sequencing, deadlines, causal resolution, trusted input, revalidation, Task ledger and affected tests; correlated round2 7/7 and retained round1 21/22 evidence. Release/subprocess tests, real CLI/TUI/0.69 launcher and natural-language/default calibration were absent. Separate strict launcher failed exit255 with zero events, so strict isolation was not proved. Root accepted both findings for a bounded correction round.

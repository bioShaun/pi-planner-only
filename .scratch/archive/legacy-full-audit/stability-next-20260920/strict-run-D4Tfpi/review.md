REQUEST_CHANGES (final)

Finding:

- High: [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:976) clears the existing `writerHold` and releases its reservations before the post-Git Request admission at [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:1122). A manual recovery attempted with `remainingMs <= 60000` therefore reaches `REQUEST_REMAINING_INSUFFICIENT` after the hold has already been removed. This violates the requirement that insufficient admission must not relax or consume Writer-hold state, and contradicts the refusal text at line 1163. The current insufficient-recovery test uses `worktreeDecision: "keep"` at [delegate.test.mjs](/home/tcuni-claw/pi/pi-planner-only/delegate.test.mjs:2392), so it does not exercise this path. Defer the hold release until Request admission succeeds, and add a regression case combining an existing hold, manual recovery, and insufficient remainder that asserts the hold and reservations remain intact.

Verified:

- Snapshot `issue07-step2-e8c535...` matches the SHA-256 of `source-manifest.json`; all 16 frozen path hashes match.
- `implementation.patch` matches the current scoped diff from baseline `a96559b`; SHA-256 is `0d8e358d...`.
- The ordinary-terminal `npm run test:release` evidence records exit `0`. Its before/after source manifests are identical, and every listed current executable/test file passes `sha256sum -c`.
- Focused evidence records successful typecheck, P1 delegation, Request-stop, ledger-store, and delegate syntax checks.
- The implementation otherwise places Request observation after `A_run`, preserves original/effective envelopes, applies token-only wall caps, records durable refusals, and leaves report-correction/recovery/revalidation grants unconsumed on the covered refusal paths.

Runtime permission evidence:

- `index.ts` is on `/dev/nvme0n1p2` mounted `ro`.
- `os.open("index.ts", os.O_WRONLY)` failed with errno `30 EROFS`.
- SHA-256 remained `11eb99181ed0c3a91d13a88b53a9b42eb9f21d037974dd4c2d247d2d53783dd5` before and after the probe.

Limitations:

- I did not rerun project tests or providers, as required by the TaskSpec.
- The independent parent’s separate permission probe remains for Root to verify alongside this child evidence.

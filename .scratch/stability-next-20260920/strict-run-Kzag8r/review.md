REQUEST_CHANGES (final)

Finding:

- High: [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:975) snapshots a manual Writer hold and reservations before asynchronous Git sampling, then [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:1207) swaps or restores that stale snapshot without re-reading the Task. Two concurrent manual-recovery calls can both pass initial validation. After the first clears the hold, the second can either restore the obsolete reservation following a conflict, permanently blocking the workspace without a matching `writerHold`, or launch after the first finishes and consume the same recovery decision again. The sequential regression at [delegate.test.mjs](/home/tcuni-claw/pi/pi-planner-only/delegate.test.mjs:2759) does not cover this race. Re-read and validate the current hold and recovery after admission, then synchronously snapshot and swap the current reservation; refuse if another invocation changed or consumed them. Add a coordinated concurrent regression.

Verified:

- Snapshot ID matches the SHA-256 of `source-manifest.json`; all 16 frozen path hashes match.
- `implementation.patch` reverse-applies cleanly to the current snapshot. Only `delegate.ts` and `delegate.test.mjs` changed since the prior review.
- The correction preserves the exact hold and reservation for the covered sequential insufficient-admission case.
- Ordinary-terminal `npm run test:release` records exit `0`; before/after source and status files match, and current executable/test hashes verify.
- The implementation otherwise performs admission after Git sampling, preserves original/effective envelopes, caps token-only envelopes, keeps Reviewer access to the reserve, records durable refusals, and avoids execution/correction/recovery consumption on covered refusal paths.

Runtime permission evidence:

- `index.ts` resides on `/dev/nvme0n1p2`, mounted `ro`.
- `os.open("index.ts", os.O_WRONLY)` failed with `errno 30 EROFS`.
- SHA-256 remained `11eb99181ed0c3a91d13a88b53a9b42eb9f21d037974dd4c2d247d2d53783dd5` before and after the probe.

Limitations:

- I did not run project tests or providers, as required.
- Root must independently verify the read-only parent probe and current launcher status.

Common execution contract: put sessions and reports under `/project/tmp/pi-native-lite-20261028T010659/results/reopen-a1/<pair>-<mode>/`, deriving the arm suffix from this worktree CWD `/project/tmp/pi-native-lite-20261028T010659/worktrees/<pair>-<mode>`; use that external directory as the session directory.

Root only scopes/decomposes this read-only brief, delegates the investigation to the child, and performs final evidence acceptance. Do not perform the investigation in Root. Children do not write files inside the candidate checkout; write the report only to the arm external results directory. Use only this arm's worktree/input and its external results directory. Do not inspect another arm, its results, this preparation record, or archived research.

S1 uses exactly one worker child. Investigate at baseline `f818cc91c98d6129a152fb28161e00d2f601e494` how Native records subagent usage, including usage data sources, how repeated/cumulative values are handled, and what coverage is missing or only a lower bound. Compare with Lite usage collection. Inspect product source and relevant tests only; do not edit files. Report concrete file and symbol locations, Root/child coverage, input/output/cache-read/cache-write coverage, duplicate-counting boundaries, missing cost/usage cases, and unknowns. Separate source semantics from actual runtime behavior and provider billing. Do not claim either mode is cheaper.

The worker report must be saved as `report.md` in this arm's external result directory. Root must wait for the worker terminal, read and assess the actual report, compute its byte SHA-256, and provide a `root-acceptance` fenced JSON object containing `accepted`, the actual `sessionId` and `attemptId`, and one child entry with role/agent `worker`, actual completed runId, same sessionId/attemptId, exact reportPath and reportSha256, `accepted:true`, `verdict:"accepted"`, and `reviewVerdict:"accepted"`. Do not claim acceptance before reviewing evidence. A refusal, missing report, invalid hash, or unresolved child is a failed arm.

The frozen `batchId` is `20261028T010659` and `attemptId` is `reopen-a1`. The Root session ID is `nl-${batchId}-${attemptId}-${pair}-${mode}`; replace each character outside `[A-Za-z0-9._-]` with `-`. For this arm that yields `nl-20261028T010659-reopen-a1-<pair>-<mode>`. Every `children[]` entry uses the same Root `sessionId` and `attemptId`; do not substitute a child session ID. Use this JSON shape, replacing placeholders only with values observed in this arm:

```json
{
  "accepted": true,
  "sessionId": "<actual Root session ID from the formula>",
  "attemptId": "reopen-a1",
  "children": [{
    "role": "worker",
    "agent": "worker",
    "runId": "<actual completed child run ID>",
    "sessionId": "<same actual Root session ID>",
    "attemptId": "reopen-a1",
    "reportPath": "/project/tmp/pi-native-lite-20261028T010659/results/reopen-a1/<pair>-<mode>/report.md",
    "reportSha256": "<actual report byte SHA-256>",
    "accepted": true,
    "verdict": "accepted",
    "reviewVerdict": "accepted"
  }]
}
```

For Lite, copy `requestId`, `ownerRunId`, and `nodeId` from the observer terminal receipt `native-lite-delegation-receipt` into that child entry; never infer or fabricate them. Native entries do not include `requestId`, `ownerRunId`, or `nodeId`.

Native read-only child launch must explicitly pass `options.acceptance: { level: "none", reason: "read-only report; Root performs evidence acceptance" }` (or the directly exposed `acceptance` field if the runtime schema uses it). Keep the child role `worker`. Lite uses `delegate` and plain-text reports; the adapter fixes child acceptance to false. Root acceptance remains mandatory in both modes.

Do not start any additional children or switch model/CLI. Record unknowns rather than infer runtime or billing behavior from source.

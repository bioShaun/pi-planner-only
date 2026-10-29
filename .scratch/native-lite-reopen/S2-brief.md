Common execution contract: put sessions and reports under `/project/tmp/pi-native-lite-20261028T010659/results/reopen-a1/<pair>-<mode>/`, deriving the arm suffix from this worktree CWD `/project/tmp/pi-native-lite-20261028T010659/worktrees/<pair>-<mode>`; use that external directory as the session directory.

Root only scopes/decomposes this read-only acceptance, delegates checks and independent review to children, and performs final evidence acceptance. Do not perform child checks or review in Root. Children do not write files inside the candidate checkout; each writes its report only to the arm external results directory. Use only this arm's worktree/input and its external results directory. Do not inspect another arm, its results, preparation records, or archived research.

The reviewer reads only this immutable, precomputed diff artifact: `/project/tmp/pi-native-lite-20261028T010659/common/S2-candidate.diff`.

S2 uses exactly one logical validator (actual agent `oracle`) to execute checks and one independent `reviewer` child without shell capability. The reviewer assesses the fixed diff only and must not run commands; the validator owns all shell commands.

Read-only independent acceptance of integration candidate `f818cc91c98d6129a152fb28161e00d2f601e494` against parent commits `3db1846aedb23a6b5552f69ffb70b552cdb94c7a` and `8168e126bed60d5a7f485718f17d7114d1322bfa`. Verify merge parents and ancestor relationships, inspect the complete net diff, and assess applicability of the historical 192-item source manifest and release evidence. Use only repository source, git history, and cited historical manifest/release records. Report exact commands, cwd, start/end, exit codes, relevant fingerprints and limitations; correctly distinguish source equivalence from dependency/runtime equivalence and do not infer release applicability without checking candidate binding. Do not modify files or run unrelated full release work.

The validator report must be `validator-report.md`, and the reviewer report must be `reviewer-report.md`, both in this arm's external result directory. Root must wait for both child terminals, inspect both reports and the actual candidate/diff evidence, compute byte SHA-256 for each report, and provide one `root-acceptance` fenced JSON object with actual `sessionId` and `attemptId`, and two entries: `role:"validator", agent:"oracle"` and `role:"reviewer", agent:"reviewer"`; each entry includes actual completed runId, same sessionId/attemptId, exact reportPath and reportSha256, `accepted:true`, `verdict:"accepted"`, and `reviewVerdict:"accepted"`. Do not claim acceptance before reviewing evidence. Any failed, missing, mismatched, or unresolved child invalidates the arm.

The frozen `batchId` is `20261028T010659` and `attemptId` is `reopen-a1`. The Root session ID is `nl-${batchId}-${attemptId}-${pair}-${mode}`; replace each character outside `[A-Za-z0-9._-]` with `-`. For this arm that yields `nl-20261028T010659-reopen-a1-<pair>-<mode>`. Every `children[]` entry uses the same Root `sessionId` and `attemptId`; do not substitute child session IDs. Use this JSON shape, replacing placeholders only with values observed in this arm:

```json
{
  "accepted": true,
  "sessionId": "<actual Root session ID from the formula>",
  "attemptId": "reopen-a1",
  "children": [
    {
      "role": "validator",
      "agent": "oracle",
      "runId": "<actual completed validator run ID>",
      "sessionId": "<same actual Root session ID>",
      "attemptId": "reopen-a1",
      "reportPath": "/project/tmp/pi-native-lite-20261028T010659/results/reopen-a1/<pair>-<mode>/validator-report.md",
      "reportSha256": "<actual report byte SHA-256>",
      "accepted": true,
      "verdict": "accepted",
      "reviewVerdict": "accepted"
    },
    {
      "role": "reviewer",
      "agent": "reviewer",
      "runId": "<actual completed reviewer run ID>",
      "sessionId": "<same actual Root session ID>",
      "attemptId": "reopen-a1",
      "reportPath": "/project/tmp/pi-native-lite-20261028T010659/results/reopen-a1/<pair>-<mode>/reviewer-report.md",
      "reportSha256": "<actual report byte SHA-256>",
      "accepted": true,
      "verdict": "accepted",
      "reviewVerdict": "accepted"
    }
  ]
}
```

For Lite, each child entry also includes `requestId`, `ownerRunId`, and `nodeId`, copied from that child's observer terminal receipt `native-lite-delegation-receipt`; never infer or fabricate these values. Native entries do not include `requestId`, `ownerRunId`, or `nodeId`.

Native read-only child launches must explicitly pass `options.acceptance: { level: "none", reason: "read-only report; Root performs evidence acceptance" }` (or directly exposed `acceptance` if the runtime schema uses that field). Preserve logical role `validator` mapped to actual agent `oracle`; reviewer remains `reviewer`. Lite uses `delegate` and plain-text reports; the adapter fixes child acceptance to false. Root acceptance remains mandatory in both modes.

Do not start additional children or switch model/CLI. Record unknowns rather than infer beyond collected evidence.

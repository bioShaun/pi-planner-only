Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Preparation template only. Replace the four `{{...}}` tokens during isolated preparation; they do not freeze or authorize a batch. Candidate: `f818cc91c98d6129a152fb28161e00d2f601e494`.

## Run Contract

Use `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/` for reports and sessions, and `{{BATCH_ROOT}}/worktrees/<pair>-<mode>` as the arm CWD; derive the actual suffix from the current CWD. Batch ID `{{BATCH_ID}}`; attempt `{{ATTEMPT_ID}}`. Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>`; sanitize batch ID by replacing each character outside `[A-Za-z0-9._-]` with `-`. Use only this arm's candidate worktree/input/results and the immutable common diff `{{BATCH_ROOT}}/common/S2-candidate.diff`, byte-identical to `input/S2-candidate.diff`. Do not inspect other arms/results, preparation records, old answers or archived research.

Root is `tcuni/gpt-6.1-terra` high. Exactly one logical validator (`oracle`) and one independent no-shell `reviewer`, both `tcuni/gpt-6-luna` medium. No model, thinking, agent, or CLI switching. Native read-only child launches pass `options.acceptance: { level: "none", reason: "read-only report; Root performs evidence acceptance" }`. Lite uses `delegate`; children return plain-text reports and do not produce structured acceptance. Validator writes `validator-report.md`; reviewer writes `reviewer-report.md`, each only in the external results directory.

The reviewer reads only this immutable, precomputed diff artifact: `{{BATCH_ROOT}}/common/S2-candidate.diff`.

## Validator Scope

Validator alone checks merge parents and ancestry for candidate `f818cc91c98d6129a152fb28161e00d2f601e494` against `3db1846aedb23a6b5552f69ffb70b552cdb94c7a` and `8168e126bed60d5a7f485718f17d7114d1322bfa`, examines the complete net diff, and assesses the actual candidate binding/applicability of candidate-contained `.scratch/reviewer-range-integration-20261027/combined-source-manifest.sha256`, `acceptance.md`, and `release-combined.log`. Record exact commands, cwd, start/end, exit and relevant fingerprints. Explicitly account for the historical combined-worktree limitation. Source equivalence does not establish dependency/runtime equivalence. Do not read external archives or claim release applicability without candidate binding. If required candidate evidence is absent, identify it and stop.

## Reviewer Scope

Reviewer reads only the frozen diff and independently assesses its contents and limitations. Reviewer has no shell and must not run commands. Do not require validator-only command output, ancestry, or manifest evidence from the reviewer. Root separately judges each role's report and then their combined criterion coverage.

## Root Review and Machine Record

Root reads both actual reports and evidence. Record accepted/rejected/incomplete truthfully; no forced acceptance. Formal content rejection is not automatically infrastructure failure or mode inferiority. Exit 1 can result from content rejection and cannot alone classify the link. If a report is absent, preserve its original failure/terminal evidence and do not invent a report path or hash. The controller's structured `root-acceptance` is accepted-completion-only; do not fabricate a rejected/incomplete JSON object. Keep raw failure and classification separately. Syntax/keywords are not semantic proof.

Only after both reports and evidence are independently accepted, emit this exact fenced JSON shape with observed values:

```root-acceptance
{
  "accepted": true,
  "sessionId": "nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>",
  "attemptId": "{{ATTEMPT_ID}}",
  "children": [
    {
      "role": "validator",
      "agent": "oracle",
      "runId": "<actual completed validator runId>",
      "sessionId": "nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>",
      "attemptId": "{{ATTEMPT_ID}}",
      "reportPath": "{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/validator-report.md",
      "reportSha256": "<actual report byte SHA-256>",
      "accepted": true,
      "verdict": "accepted",
      "reviewVerdict": "accepted"
    },
    {
      "role": "reviewer",
      "agent": "reviewer",
      "runId": "<actual completed reviewer runId>",
      "sessionId": "nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>",
      "attemptId": "{{ATTEMPT_ID}}",
      "reportPath": "{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/reviewer-report.md",
      "reportSha256": "<actual report byte SHA-256>",
      "accepted": true,
      "verdict": "accepted",
      "reviewVerdict": "accepted"
    }
  ]
}
```

For Lite, each child entry also copies `requestId`, `ownerRunId`, and `nodeId` from that child's actual `native-lite-delegation-receipt`; never infer them. Native entries omit them. Root waits for both terminal receipts, reads both reports, computes byte hashes and checks evidence before acceptance. Any refusal, missing report, bad hash, failed/unobserved child or unresolved verdict invalidates acceptance. Preserve every result and freeze formal eligibility before formal runs; do not select successful runs retrospectively.

For a content rejection, keep the result outside the accepted-only controller schema: `accepted=false; verdict=rejected; reviewVerdict=rejected; reason=<specific validator/reviewer criterion>; evidence=<actual report/terminal references>`. Incomplete or missing evidence uses `accepted=false; verdict=incomplete`, retains the raw failure, and does not fabricate either report path or hash.

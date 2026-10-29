Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Preparation template only. Replace the four `{{...}}` tokens during the isolated preparation step; do not treat template values as a frozen batch or launch authorization. Candidate: `f818cc91c98d6129a152fb28161e00d2f601e494`.

## Run Contract

Use the external session/report directory `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, corresponding to this arm worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`; derive the actual `<pair>-<mode>` suffix from the current CWD, not another arm. Batch ID is `{{BATCH_ID}}`; attempt ID is `{{ATTEMPT_ID}}`. The Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>`, replacing each batch-ID character outside `[A-Za-z0-9._-]` with `-`. Use only this arm's candidate worktree, input, and external results. Do not inspect another arm, its results, archived research, old answers, or preparation records. Do not edit candidate files.

Root model/thinking is `tcuni/gpt-6.1-terra` high. Launch exactly one logical worker, actual agent `worker`, `tcuni/gpt-6-luna` medium. Do not switch model, thinking, agent, or CLI. Native read-only launch explicitly sets `options.acceptance: { level: "none", reason: "read-only report; Root performs evidence acceptance" }`. Lite uses `delegate`; children return plain-text reports and adapter child acceptance is false. The worker writes `report.md` only in this arm's external result directory.

## Investigation

At baseline `f818cc91c98d6129a152fb28161e00d2f601e494`, determine how Native records subagent usage and compare it with Lite usage collection. Inspect candidate source and relevant tests only; do not edit. Cite concrete candidate file/symbol evidence for each in-repository data source, call/snapshot/increment semantics and duplicate-count boundary, Root/child coverage for input/output/cache-read/cache-write, missing usage/cost behavior, and limitations. In-candidate answerable omissions cannot be excused as unknown. Separate source semantics from actual runtime behavior and provider billing. Candidate-external RPC aggregation, execution and provider billing may be unknown only where the candidate cannot establish them; these unknowns alone do not justify rejection and do not prove zero cost or absence of duplication. Do not claim either mode is cheaper.

## Root Review and Machine Record

Root independently reads the report and evidence. Record the actual content result as accepted/rejected/incomplete in the review notes; do not force `accepted:true`. A formal content rejection is not automatically infrastructure failure or mode inferiority. Exit 1 can result from content rejection and cannot alone classify the link. If the report is missing, preserve the original failure and terminal evidence; do not invent report path/hash. The controller's structured `root-acceptance` currently represents accepted completion only; do not send a fabricated rejected/incomplete object through it. Keep raw failure and classify it in the separate infrastructure/content/eligibility record. Machine formatting is not semantic proof.

Only when Root actually accepts the evidence, emit this exact fenced JSON shape with observed values:

```root-acceptance
{
  "accepted": true,
  "sessionId": "nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>",
  "attemptId": "{{ATTEMPT_ID}}",
  "children": [{
    "role": "worker",
    "agent": "worker",
    "runId": "<actual completed runId>",
    "sessionId": "nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>",
    "attemptId": "{{ATTEMPT_ID}}",
    "reportPath": "{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/report.md",
    "reportSha256": "<actual report byte SHA-256>",
    "accepted": true,
    "verdict": "accepted",
    "reviewVerdict": "accepted"
  }]
}
```

Lite additionally copies `requestId`, `ownerRunId`, and `nodeId` exactly from the observer's `native-lite-delegation-receipt`; never infer them. Native entries do not contain those fields. A refusal, missing report, bad hash, failed/unobserved child, or unresolved verdict is not accepted. Root waits for the terminal, reads the report, checks its hash and evidence, and only then emits acceptance. Freeze formal eligibility before any formal run; retain all attempts and never select only successes after observing them.

For a rejection, use the separate review note (not controller `root-acceptance`): `accepted=false; verdict=rejected; reviewVerdict=rejected; reason=<specific unmet criterion>; evidence=<actual input/report/terminal references>`. For an incomplete run, use `accepted=false; verdict=incomplete` and preserve the raw failure. Do not put these records in the accepted-only controller schema.

# ReviewRequest

## Scope

Perform a strict read-only review of commit `200985e9962da35097546cbb0f0a7896c00164ea` in the current project. Review the committed artifact and its behavior against the repository specification and standards. Use native `astra_reviewer` only; do not spawn further agents. Do not modify source, fixtures, tracked files, or existing untracked files.

## Inputs

- Commit: `200985e9962da35097546cbb0f0a7896c00164ea`
- Project instructions: `/home/tcuni-claw/pi/pi-planner-only/AGENTS.md`
- Domain context: `/home/tcuni-claw/pi/pi-planner-only/CONTEXT.md`
- ADR directory: `/home/tcuni-claw/pi/pi-planner-only/docs/adr/`
- Baseline status: `.scratch/delegation-contract-review-20260918/validation/git-status-before.txt`
- Raw working-tree typecheck: `.scratch/delegation-contract-review-20260918/validation/worktree-typecheck.stdout` and `.stderr`, `.exit`
- Raw working-tree tests: `.scratch/delegation-contract-review-20260918/validation/worktree-test.stdout` and `.stderr`, `.exit`
- Raw committed-snapshot typecheck: `.scratch/delegation-contract-review-20260918/validation/snapshot-typecheck.stdout` and `.stderr`, `.exit`
- Raw committed-snapshot tests: `.scratch/delegation-contract-review-20260918/validation/snapshot-test.stdout` and `.stderr`, `.exit`
- Raw persistence check: `.scratch/delegation-contract-review-20260918/validation/persistence-check.stdout` and `.stderr`, `.exit`

## Review requirements

Assess correctness against the committed change and the repository instructions. Report only evidence-backed findings with file locations and impact. Return the review verdict and identify any missing or failed evidence. Treat the baseline status as context; do not infer that unrelated untracked files belong to the commit.

The review must run with a genuinely read-only runtime. The launcher may use no `/tmp`; set temporary paths under `.scratch/delegation-contract-review-20260918/validation`. For the runtime read-only probe, the parent and child may target only a newly designated file under `.scratch/delegation-contract-review-20260918/validation/permission-probe`; report the actual tool denial if writing is denied. Do not use the probe to alter source or existing artifacts.

## Return

Return PASS, REQUEST_CHANGES, or BLOCKED with the independent evidence and limitations. Do not delegate further.

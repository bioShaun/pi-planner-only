# pi-planner-only P0/P1 Hardening Spec

> Scope: current `main` branch of `bioShaun/pi-planner-only`
>
> Goal: harden the existing v0.2 orchestration lifecycle without adding new product features.
>
> Principle: **fix correctness seams first; do not expand into a larger workflow framework.**

## 1. Summary

The current implementation is already a viable lightweight orchestration layer:

```text
Root
  │
  ├── Plan
  ├── Delegate
  ├── Inspect
  └── Review
        │
        ▼
     Subagent
        │
        ▼
   WorkerReport
        │
        ▼
   Evidence check
        │
        ▼
     Review loop
```

The next iteration should focus only on lifecycle hardening.

```text
P0
├── Enforce WorkerReport task identity
├── Enforce ReviewResult task identity
└── Re-check evidence at the PASS boundary

P1
├── Separate Reviewer invocation from TaskSpec mutation
├── Fix reviewer/git_audit capability mismatch
├── Add optional strict TaskSpec enforcement
└── Add real pi-subagents E2E coverage
```

No background Advisor, persistence engine, queue, telemetry, memory system, or DAG workflow should be added in this phase.

---

# 2. P0-1 — Enforce WorkerReport Task Identity

## Problem

`PlannerOrchestrator.handleSubagentResult()` identifies the expected task using:

```ts
toolCallId -> taskId
```

but a parsed `WorkerReport` is currently accepted based on its own schema validity.

A report may be structurally valid even when it belongs to a different delegated task.

## Required invariant

For every Worker result:

```text
expectedTaskId
    ==
WorkerReport.taskId
    ==
WorkerReport.evidence.taskId
```

Additionally, when available:

```text
WorkerReport.evidence.workerRunId
    ==
subagent toolCallId
```

## Proposed implementation

Suggested location: `report.ts`.

```ts
export interface WorkerReportIdentity {
  taskId: string;
  workerRunId?: string;
}

export function validateWorkerReportIdentity(
  report: WorkerReport,
  expected: WorkerReportIdentity,
): string[];
```

Example semantics:

```ts
export function validateWorkerReportIdentity(
  report: WorkerReport,
  expected: WorkerReportIdentity,
): string[] {
  const errors: string[] = [];

  if (report.taskId !== expected.taskId) {
    errors.push(
      `WorkerReport taskId mismatch: expected ${expected.taskId}, got ${report.taskId}`,
    );
  }

  if (report.evidence.taskId !== expected.taskId) {
    errors.push(
      `WorkerReport evidence.taskId mismatch: expected ${expected.taskId}, got ${report.evidence.taskId}`,
    );
  }

  if (
    expected.workerRunId &&
    report.evidence.workerRunId &&
    report.evidence.workerRunId !== expected.workerRunId
  ) {
    errors.push(
      `WorkerReport evidence.workerRunId mismatch: expected ${expected.workerRunId}, got ${report.evidence.workerRunId}`,
    );
  }

  return errors;
}
```

## Integration point

In `PlannerOrchestrator.handleSubagentResult()`, after:

```ts
const extracted = extractWorkerReport(text);
```

and before:

```ts
this.store.recordReport(taskId, report);
```

perform identity validation.

## Failure behavior

Identity mismatch must behave like a malformed WorkerReport.

Do not:

```text
record report
advance review
accept evidence
```

Return a bounded correction instruction and consume the existing report-correction budget.

## Tests

Required cases:

- wrong `report.taskId` → rejected, not stored, report-only correction;
- wrong `evidence.taskId` → rejected;
- wrong `workerRunId` → rejected;
- correct identity → accepted and advances to `review_pending`.

---

# 3. P0-2 — Enforce ReviewResult Task Identity

## Problem

Fresh Reviewer output is structurally validated, but the runtime must also verify that the verdict belongs to the task associated with the review subagent call.

## Required invariant

```text
delegation taskId
    ==
ReviewResult.taskId
```

No review verdict may be applied to another task.

## Proposed implementation

Suggested location: `review.ts`.

```ts
export function validateReviewResultIdentity(
  review: ReviewResult,
  expectedTaskId: string,
): string[];
```

Example:

```ts
export function validateReviewResultIdentity(
  review: ReviewResult,
  expectedTaskId: string,
): string[] {
  if (review.taskId === expectedTaskId) return [];
  return [
    `ReviewResult taskId mismatch: expected ${expectedTaskId}, got ${review.taskId}`,
  ];
}
```

## Integration point

In `PlannerOrchestrator.handleSubagentResult()`, after parsing `ReviewResult` and before `recordReview()`.

## Failure behavior

Do not:

```text
record review
advance review state
apply verdict
```

Return an explicit mismatch error and require review to be re-delegated for the correct task.

## Tests

- wrong reviewer `taskId` → review rejected; neither task state changes;
- correct reviewer `taskId` → review stored and lifecycle advances.

---

# 4. P0-3 — Re-check Evidence at the PASS Boundary

## Problem

The current lifecycle checks freshness when the Worker result arrives. That only proves:

```text
evidence was fresh at worker-result processing time
```

not:

```text
evidence is fresh at acceptance time
```

Race example:

```text
Worker returns
   │
   ▼
freshness check at t1
   │
   ▼
Root inspects
   │
   ▼
external edit at t2
   │
   ▼
Root PASS at t3
```

## Required invariant

> **No stale evidence crosses the PASS boundary.**

Any `pass` verdict must perform a fresh workspace sample immediately before acceptance.

## Proposed API change

`recordRootVerdict()` should become asynchronous if necessary:

```ts
async recordRootVerdict(
  task: TaskRecord,
  verdict: ReviewVerdict,
  summary: string,
): Promise<{
  task: TaskRecord;
  decision: ReviewDecision;
}>;
```

## PASS path

```text
PASS requested
      │
      ▼
capture current evidence
      │
      ▼
compare with latest WorkerReport
      │
 ┌────┴────┐
 fresh    stale
   │        │
 accept   reject PASS
            │
            ▼
         revalidate
```

Reviewer-supplied `evidenceFresh: true` must never bypass this Root-side authoritative check.

## Tests

### Race test

1. Worker returns valid report.
2. Evidence is fresh.
3. Simulate external edit.
4. Root calls PASS.

Expected:

```text
PASS rejected
decision = revalidate
task != completed
```

### No-race PASS

Expected: task completes.

### Fresh Reviewer PASS + later drift

Expected: final Root acceptance still re-checks; stale evidence forces revalidation.

---

# 5. P1-1 — Separate Reviewer Invocation From TaskSpec Mutation

## Problem

Reviewer delegation currently reuses a `TaskSpec` with the same `taskId` and `role = reviewer`. That can cause the existing Task record to be rebound with reviewer semantics.

A Task should represent the original unit of work, not the role of the current child invocation.

## Required invariant

A Task's original `TaskSpec` must remain stable.

```text
Task T-100
objective: implement parser
role: worker
```

must remain unchanged through:

```text
worker run
reviewer run
validation run
correction run
```

Reviewer is an invocation over a Task, not a mutation of the Task.

## Introduce ReviewRequest

```ts
export interface ReviewRequest {
  version: 1;
  taskId: string;
  reportTaskId: string;
  reviewMode: "fresh";
  workerReport: WorkerReport;
  taskSpec?: TaskSpec;
  evidenceSummary?: string;
}
```

This can stay transient and need not be persisted in `TaskStore`.

## Delegation mapping

Instead of only:

```ts
private readonly delegations = new Map<string, string>();
```

use:

```ts
type DelegationKind =
  | "worker"
  | "reviewer"
  | "explorer"
  | "validator";

interface DelegationRecord {
  taskId: string;
  kind: DelegationKind;
}

private readonly delegations =
  new Map<string, DelegationRecord>();
```

The Task's original `role`, `objective`, and `spec` stay unchanged.

## Tests

Create `T-100 role=worker`, run Fresh Reviewer, and assert:

```ts
task.role === "worker"
task.spec.role === "worker"
task.spec.objective === originalObjective
```

---

# 6. P1-2 — Fix Reviewer / git_audit Capability Mismatch

## Problem

The role profile advertises:

```ts
reviewer: ["read", "grep", "find", "ls", "git_audit"]
```

but child subagents start with `--no-extensions`, while `git_audit` is registered by the parent extension.

Therefore the declared reviewer capability may not exist in the real child runtime.

## Recommended direction

Do **not** load this extension into reviewer children just to provide `git_audit`.

Keep `--no-extensions`.

Instead:

```text
Root performs Git-read
        │
        ▼
bounded evidence packet
        │
        ▼
Fresh Reviewer
read / grep / find / ls
```

## Reviewer capability profile

Change to:

```ts
reviewer: ["read", "grep", "find", "ls"]
```

## Evidence packet

Root may include bounded:

```text
HEAD
git status --porcelain=v2 --branch
git diff --name-status
git diff --stat
git diff --check
freshness summary
```

Suggested structure:

```ts
export interface ReviewEvidencePacket {
  head?: string;
  status?: string;
  changedFiles?: string[];
  diffStat?: string;
  diffCheck?: string;
  freshness?: string;
}
```

Do not send full diff by default.

## Prompt update

Reviewer prompt should say:

```text
You may inspect files using read, grep, find, and ls.
Git evidence is supplied by Root in the review packet.
Do not assume you can execute git or shell commands.
```

This yields a cleaner boundary:

```text
Root = repository-state authority
Fresh Reviewer = independent semantic reviewer
```

---

# 7. P1-3 — Optional Strict TaskSpec Enforcement

## Problem

A Worker delegation without embedded `TaskSpec` is still accepted, weakening task identity, scope, acceptance criteria, one-writer locking, and the structured report contract.

## Recommended design

```ts
type StructuredDelegationMode =
  | "warn"
  | "strict";
```

Initial default:

```text
warn
```

Potential later default:

```text
strict
```

## Behavior by role

### Worker

Strict mode:

```text
worker delegation without TaskSpec
→ block
```

### Explorer

May remain permissive.

### Validator

Prefer structured TaskSpec, initially warn rather than block.

### Reviewer

Use the dedicated `ReviewRequest` path from P1-1.

## Configuration

Keep this minimal. Prefer a constant or one small config field rather than introducing a config subsystem solely for this feature.

---

# 8. P1-4 — Add Real pi-subagents E2E Coverage

## Problem

Current tests are strong at unit/in-process integration level, but key behavior depends on real `pi-subagents` semantics:

```text
input payload mutation
context=fresh
builtin agent allowlists
--no-extensions
actual child tool surfaces
tool_result formatting
```

Mocks cannot fully prove these.

## Suggested test

Add:

```text
e2e.pi-subagents.test.mjs
```

Run separately:

```json
{
  "scripts": {
    "test:e2e": "node --experimental-strip-types e2e.pi-subagents.test.mjs"
  }
}
```

## Required scenarios

### A — Root tool surface

Root cannot use:

```text
bash
edit
write
```

Root can use:

```text
read
grep
find
ls
subagent
git_audit
```

### B — Worker

Verify the selected Worker child retains its expected edit/write/bash capabilities.

### C — Fresh Reviewer

Verify:

```text
context = fresh
```

and reviewer does not receive Root transcript content.

Verify actual tools match documented tools.

### D — Validator

Verify:

```text
can bash
cannot edit
cannot write
```

### E — `--no-extensions`

Verify the child does not recursively load `pi-planner-only`.

---

# 9. Implementation Order

Recommended sequence:

```text
1. WorkerReport identity enforcement
2. ReviewResult identity enforcement
3. PASS-boundary evidence re-check
4. Reviewer invocation separation
5. Reviewer capability correction
6. Strict TaskSpec warn/strict mode
7. Real Pi/subagents E2E
```

Do not parallelize steps 1–5 unless necessary; they touch the same lifecycle seams.

---

# 10. Suggested File Changes

Likely files:

```text
report.ts
review.ts
orchestrate.ts
task.ts
roles.ts
types.ts
index.ts
README.md
README.zh-CN.md
```

Tests:

```text
report.test.mjs
review.test.mjs
roles.test.mjs
evidence.test.mjs
index.test.mjs
e2e.pi-subagents.test.mjs
```

---

# 11. Explicit Non-goals

Do not add:

```text
background Advisor
review queue
persistent TaskStore
cross-session resume
cost/token accounting
memory suggestions
automatic model selection
DAG scheduler
parallel writer scheduler
complex config UI
telemetry
```

These are unrelated to the current correctness issues.

---

# 12. Definition of Done

## P0

- [ ] `WorkerReport.taskId` matches the expected delegated task.
- [ ] `WorkerReport.evidence.taskId` matches the expected delegated task.
- [ ] `WorkerReport.evidence.workerRunId` is checked against the subagent call when present.
- [ ] mismatched WorkerReport is never stored.
- [ ] `ReviewResult.taskId` matches the delegated review task.
- [ ] mismatched ReviewResult is never stored/applied.
- [ ] every PASS performs an authoritative Root-side evidence refresh.
- [ ] stale evidence at PASS time forces revalidation.
- [ ] Fresh Reviewer `evidenceFresh=true` cannot bypass Root freshness checks.

## P1

- [ ] Fresh Reviewer invocation no longer overwrites the Task's original TaskSpec.
- [ ] Task role/objective remain stable through review.
- [ ] Reviewer tool profile matches actual child tools.
- [ ] `git_audit` is no longer falsely advertised to reviewer children.
- [ ] Root provides bounded Git evidence to Fresh Reviewer.
- [ ] optional structured delegation mode exists.
- [ ] worker-without-TaskSpec can be warned or blocked according to mode.
- [ ] one real Pi/pi-subagents E2E suite exists.
- [ ] current unit/integration tests continue to pass.
- [ ] no new background/persistence framework is introduced.

---

# 13. Target Architecture After Hardening

```text
                         User
                           │
                           ▼
                    ┌──────────────┐
                    │     Root     │
                    │              │
                    │ Plan         │
                    │ Delegate     │
                    │ Git-read     │
                    │ Review       │
                    └──────┬───────┘
                           │
                        TaskSpec
                           │
                           ▼
                       Worker
                           │
                           ▼
                     WorkerReport
                           │
                    identity check
                           │
                           ▼
                    evidence check
                           │
                ┌──────────┴──────────┐
                │                     │
              root                  fresh
             review                reviewer
                │                     │
                │               ReviewRequest
                │                     │
                │               ReviewResult
                │                     │
                └──────────┬──────────┘
                           │
                    identity check
                           │
                           ▼
                    Root arbitration
                           │
                    PASS requested
                           │
                           ▼
                authoritative evidence
                     re-check NOW
                           │
                 ┌─────────┴─────────┐
                 │                   │
               fresh               stale
                 │                   │
                 ▼                   ▼
             COMPLETED           REVALIDATE
```

The key invariants are:

```text
Task identity is stable.
Child invocation roles are transient.
Evidence is authoritative only at the acceptance boundary.
```

---

# 14. Release Recommendation

Treat this as a hardening series rather than a feature release:

```text
v0.2.1
P0 fixes

v0.2.2
Reviewer invocation/capability cleanup

v0.2.3
E2E + strict delegation option
```

After that, pause feature development and use the extension on real coding tasks to collect lifecycle failures before designing v0.3.

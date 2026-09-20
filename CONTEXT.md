# Planner-only orchestration

The parent process stays a planner and reviewer. Execution happens in delegated agent sessions that run **in-process** (pi-subagents structured delegation over the event transport), not child OS processes — a cancelled or crashed Root ends the delegation with it, though shell commands the delegate had already spawned may still orphan. This glossary names the contracts that cross the Root/child seam.

## Language

**Root**:
The parent process. It plans, delegates, inspects, reviews, and arbitrates. It does not edit, write, or run a general shell.
_Avoid_: parent agent, planner service, orchestrator (the person/process — the in-process module that coordinates lifecycle is Orchestration)

**Worker**:
A child that executes a bounded Task. It returns only a WorkerReport.
_Avoid_: subagent (the launch mechanism, not the role)

**Reviewer**:
A child that verifies a WorkerReport against evidence. Isolated from Root's transcript. It returns only a ReviewResult.
_Avoid_: critic, judge

**Explorer**:
A read-only child. It may inspect, not mutate.

**Validator**:
A child that may run a shell to check work, but may not edit files.

**Task**:
One unit of delegated work with a lifecycle (planning → executing → reviewing → completed | changes_requested | blocked | failed).
_Avoid_: job, ticket, unit of work

**Request**:
One independently initiated unit of Root work, spanning its Tasks, corrections,
recoveries, and automatic continuations. Its finite allowance and closure survive
reloads until a trusted next input or confirmed operator action opens another Request.
_Avoid_: Task, assistant turn, model call

**Request stop**:
Closure of new Root tool and child admission, accompanied by cancellation of
active children and a request to stop Root. Admission closure, confirmed child
stop, and confirmed Root stop are separate facts.
_Avoid_: abort called, full termination without host evidence

**Failure chain**:
Unresolved failures of one program-classified family within a Request, including
failures on different Tasks. Only a fully accepted correction resolves its
causally linked predecessors on the same Task and in the same family.
_Avoid_: repeated wording, report validity, success on an unrelated Task

**TaskSpec**:
The downward contract: what a Worker is allowed and required to do.
_Avoid_: prompt, brief, ticket body

**Acceptance mode**:
The immutable declaration of what a Task may accept: `worktree` requires
code-change evidence, while `observation` accepts read-only information and
does not verify code changes.
_Avoid_: reader verification, report text inference

**Execution capability**:
The trusted capability classification of one execution: `restricted-reader`,
`writer`, or `unknown`. It determines stop confirmation and writer isolation;
the Task role or a self-reported read-only flag does not.
_Avoid_: role, readOnly claim

**WorkerReport**:
The upward contract: the only structured thing a Worker returns. It declares Task identity (`taskId` / `evidence.taskId`) and the Git facts the child observed; the execution identity producing it (`evidence.workerRunId`) is Root-stamped at admission (ADR-0004), never child-declared.
_Avoid_: transcript, log, result blob, child-reported runId

**ReviewResult**:
The structured verdict a Reviewer returns.
_Avoid_: review comments, PR review

**Evidence**:
Root's own Git samples, never the Worker's word. Each execution record carries a pre-execution sample (`A_run`) and a result-receive sample (`C_report`); Truth/scope is the pure `diff(A_run, C_report)` against the report declaration, and freshness is the separate `diff(C_report, C_now)` re-sampled at review and acceptance. Findings (under-report, scope, drift) survive later rounds; only a review closes one.
_Avoid_: artifact, snapshot (unless talking about the Git working tree sample itself), the old single Task-level A sample

**ReviewRequest**:
The transient invocation payload a reviewer invocation carries: the Task's original spec (read-only), the latest WorkerReport, and Root's Git evidence. It names the Task; it never rebinds one.
_Avoid_: reviewer TaskSpec, review prompt

**Git-read**:
Root's only Git access: fixed, read-only argv. Never a shell.
_Avoid_: git shell, audit API

**Policy**:
The parent tool guard: which tools Root may call. While a Task is live for the workspace, the live allowlist applies; when none is (Idle for gather), Root may only start a Delegation with `planner_delegate`, re-enter an existing Task with `planner_redelegate`, abandon a `recovery.required` execution with `planner_abort`, list live Tasks with `planner_tasks`, ask a question, record a Verdict, or inspect Git with `git_audit`. Idle is derived from the Task store per workspace, never from prompt wording.
_Avoid_: permissions, ACL

**Delegation**:
Launching a child with a role and a TaskSpec. Two entry points: `planner_delegate` always mints a new Task (it takes no `taskId`) and returns the canonical `taskId`; `planner_redelegate` binds an existing Task by that verbatim id for a correction round, a review, or a recovery re-execution; `planner_tasks` is the read-only lookup that lists this workspace's live Tasks (memory plus ledger records the restore cap left out) when the canonical id is not in context. The child's WorkerReport returns launcher-validated, never parsed from text; at most one worker per cwd. An explicit `envelope` (maxTokens / maxWallMs) bounds a runaway execution; a breach fires CANCEL and records `worker_runaway` on the TaskExecutionRecord.
_Avoid_: spawn, dispatch (the host mechanism), packet

**Writer hold**:
The persisted `task.writerHold` left when an execution's stop was never confirmed; it keeps the workspace refusing a second writer across restarts until a late terminal confirms quiescence or the operator resolves it.
_Avoid_: lock, mutex

**RecoveryDecision**:
Root's structured decision (`planner_redelegate.recovery`, or the dedicated `planner_abort` surface for `action:"abort"` — ADR-0003; `planner_verdict` has no recovery key) that authorizes one new bounded execution on a Task flagged `recovery.required`, or abandons it for the operator; consumed once, never reworded-retried. Distinct from evidence revalidation: a `revalidate` verdict grants a workspace re-sampling attempt, consumed once at durable dispatch, with a separate limit of three attempts per Task.
_Avoid_: replan, retry policy

**Review loop**:
Decide the next lifecycle step from a report, evidence comparison, and optional ReviewResult, then apply it to the Task.
_Avoid_: review pipeline, arbitration service

**Verdict**:
Root's recorded judgment over a Task through `planner_verdict`; the operator's `/planner-only review` is an override, not a second verdict. Flow: worker report → Root evidence comparison → optional reviewer → `planner_verdict` (pass / request_changes / blocked — no recovery key; abandoning a `recovery.required` execution goes through `planner_abort`) → `git_commit` once the Task is completed.

**Usage**:
Token and derived-cost accounting attributed to a Task; Root turns by phase, children by run. Injected text and review leak are tracked separately.

**Orchestration**:
The in-process lifecycle coordinator. The Pi host is an adapter; Orchestration is the module behind that seam.
_Avoid_: extension, framework

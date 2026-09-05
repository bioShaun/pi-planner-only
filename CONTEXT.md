# Planner-only orchestration

The parent process stays a planner and reviewer. Execution happens in child processes. This glossary names the contracts that cross the parent/child seam.

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

**TaskSpec**:
The downward contract: what a Worker is allowed and required to do.
_Avoid_: prompt, brief, ticket body

**WorkerReport**:
The upward contract: the only structured thing a Worker returns.
_Avoid_: transcript, log, result blob

**ReviewResult**:
The structured verdict a Reviewer returns.
_Avoid_: review comments, PR review

**Evidence**:
A point-in-time fingerprint of the workspace a WorkerReport refers to. Freshness is re-sampled by Root at the acceptance boundary; a pass over stale evidence is rejected.
_Avoid_: artifact, snapshot (unless talking about the Git working tree sample itself)

**ReviewRequest**:
The transient packet a reviewer invocation carries: the Task's original spec (read-only), the latest WorkerReport, and Root's Git evidence. It names the Task; it never rebinds one.
_Avoid_: reviewer TaskSpec, review prompt

**Git-read**:
Root's only Git access: fixed, read-only argv. Never a shell.
_Avoid_: git shell, audit API

**Policy**:
The parent tool guard: which tools Root may call.
_Avoid_: permissions, ACL

**Delegation**:
Launching a child with a role, a bounded packet, and at most one writer per cwd.
_Avoid_: spawn, dispatch (the host mechanism)

**Review loop**:
Decide the next lifecycle step from a report, evidence comparison, and optional ReviewResult, then apply it to the Task.
_Avoid_: review pipeline, arbitration service

**Verdict**:
Root's recorded judgment over a Task through `planner_verdict`; the operator's `/planner-only review` is an override, not a second verdict.

**Usage**:
Token and derived-cost accounting attributed to a Task; Root turns by phase, children by run.

**Orchestration**:
The in-process lifecycle coordinator. The Pi host is an adapter; Orchestration is the module behind that seam.
_Avoid_: extension, framework

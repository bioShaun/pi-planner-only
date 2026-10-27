# Planner-only

In Lite, Root spends the expensive tokens on planning and review; children do the bulk of the work on cheaper models. Children run **in-process** through pi-subagents structured delegation, so a cancelled or crashed Root ends them too (shell commands a child already spawned may still orphan). No task ledger is persisted between delegations; mode selection is session metadata.

## Language

**Mode**:
One Root session's choice of Off, Native, or Lite delegation behavior.

**Off**:
The extension contributes no delegation instructions or active execution tools.

**Native**:
The neutral instruction only, with delegation and child lifecycle owned by pi-subagents. No Lite tools or cost accounting.

**Lite**:
The extension's guided delegation interface, change summaries, optional strict behavior, and acceptance by Root. The Root/child/role contract below applies here.

**Root**:
The parent session. It plans, delegates, inspects the actual changes, and commits. It may do small tasks itself unless strict mode is on.
_Avoid_: orchestrator, planner service

**Root handoff**:
The transfer of unfinished work to a fresh Root session through a self-contained brief. The source model and known thinking level are preserved; failed or cancelled delivery retains the brief for manual retry or discard.

**Worker**:
A child that implements a task and ends with a short text report. Runs as the builtin `worker` agent.
_Avoid_: subagent (the launch mechanism, not the role)

**Explorer**:
A child that searches and reads code and returns compact findings. Runs as the builtin `scout` agent.

**Validator**:
A child that runs checks and reports each command with its exit code. Runs as the package `planner-validator` agent.

**Delegation**:
One `delegate` call: one request, one terminal (or a stop Root could not confirm). Root judges it by the Git summary and check output, not by the child's own claims. Rework is a new delegation carrying the previous report and the fixes.
_Avoid_: task, execution (legacy ledger terms)

## Decisions

- In Lite, children return plain text; there is no structured report contract (legacy ADR-0001–0007, 0009 and 0010 are superseded; 0008 keeps only its ten-minute default; the legacy heavy-worker envelope is not revived).
- The default wall-clock limit is ten minutes (`PI_PLANNER_ONLY_TIMEOUT_MS`), but individual delegations can supply an optional `timeoutSeconds` (1..86400, e.g. 120s for short tasks, 900s for complex implementations) overriding `timeoutMs` for that single run without changing the global default or subsequent calls; other token and cancel limits remain intact; the host enforces `timeoutMs`, while the plugin cancels on the token cap.
- Per-role in-memory diagnostics in `PlannerSession` track delegation calls, completed runtime terminals, timed_out runs, incomplete runs, refused calls, and known cumulative `durationMs` (including concurrent overlapping child time, not total wall time) for the current session only; reset on new sessions and not persisted across reload.
- worker and validator hold their repository exclusively until they end; explorers share a repository (any number of them) but never run alongside a worker or validator; an unconfirmed stop keeps the hold until the late terminal.
- The host enforces the wall-clock limit (`timeoutMs`); the plugin cancels on the reported token cap. Neither is a hard budget.
- Child models are operator configuration (`subagents.agentOverrides`), never tool parameters.
- Children run with the intercom bridge off and cannot ask Root mid-run, so each task must be self-contained.

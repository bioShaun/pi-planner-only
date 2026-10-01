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

**Worker**:
A child that implements a task and ends with a short text report. Runs as the builtin `worker` agent.
_Avoid_: subagent (the launch mechanism, not the role)

**Explorer**:
A child that searches and reads code and returns compact findings. Runs as the builtin `scout` agent.

**Validator**:
A child that runs checks and reports each command with its exit code. Runs as the builtin `oracle` agent.

**Delegation**:
One `delegate` call: one request, one terminal (or a stop Root could not confirm). Root judges it by the Git summary and check output, not by the child's own claims. Rework is a new delegation carrying the previous report and the fixes.
_Avoid_: task, execution (legacy ledger terms)

## Decisions

- In Lite, children return plain text; there is no structured report contract (legacy ADR-0001–0007, 0009 and 0010 are superseded; 0008 keeps only its ten-minute default).
- worker and validator hold their repository exclusively until they end; explorers share a repository (any number of them) but never run alongside a worker or validator; an unconfirmed stop keeps the hold until the late terminal.
- The host enforces the wall-clock limit (`timeoutMs`); the plugin cancels on the reported token cap. Neither is a hard budget.
- Child models are operator configuration (`subagents.agentOverrides`), never tool parameters.
- Children run with the intercom bridge off and cannot ask Root mid-run, so each task must be self-contained.

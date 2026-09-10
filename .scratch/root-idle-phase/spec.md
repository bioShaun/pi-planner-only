# Root Idle Policy

**Status:** ready-for-agent

Arbitration (2026-09-10): P0 chooses **(a)** — gather goes Idle when `activeForCwd` is empty; `planner_verdict` stays a Root tool and the blocked/failed escape hatch is not removed. P1: example `taskId` sentinel is replaced and never stored as an alias. P2: PolicyInput carries `cwd`; gather uses `activeForCwd`; ledger restore of a non-final Task makes that cwd live. Do not implement (b).

## Problem Statement

When an operator gives Root a new request, Root still tries to do the work itself: it opens skills, calls a general shell, then retries a Delegation with a malformed TaskSpec. Each blocked call costs a Root turn. A lookup that should have been one Explorer Delegation instead burns several Root turns on tools Policy will refuse and on TaskSpec shapes Orchestration will refuse.

The operator sees the same loop every time: Root gathers, the guard blocks, Root guesses a TaskSpec, the guard blocks again, and only then does a child run.

## Solution

Root has a gather Policy phase, derived from the Task store for the adapter workspace, not from prompt wording.

While Idle for gather (`activeForCwd` empty), Root may start a Delegation, ask a clarifying question, or record a Verdict with `planner_verdict`. Inspect tools, Git-read, and a general shell are refused. Every such refusal includes a copy-paste TaskSpec JSON that already passes TaskSpec validation, filled from whatever Root just attempted.

While a Task is live for gather in that cwd, today's inspect and review tools stay available. Root still does not edit, write, or run a general shell.

`planner_verdict` is not an Idle gather tool. Blocked and failed Tasks can still receive a Root Verdict when they have a recorded WorkerReport; `completed` remains the sole terminal state for verdicts. That existing escape hatch is kept.

Skills are named in TaskSpec constraints. The Worker follows them. Root does not open skill documents in order to execute them.

## User Stories

1. As an operator, I want Root's first tool call on a new request to be a Delegation, so that I do not pay Root turns for work a child will do anyway.
2. As an operator, I want a lookup request (read a Feishu task, inspect a URL, run a CLI) to become one Explorer Delegation, so that Root does not probe then retry.
3. As Root, while Idle for gather, I want `read` refused, so that opening a skill or source file is not a substitute for Delegation.
4. As Root, while Idle for gather, I want `grep`, `find`, and `ls` refused, so that workspace search is not a substitute for Delegation.
5. As Root, while Idle for gather, I want a general shell refused, including commands that Policy today treats as safe Git-read via the shell, so that `git status` through bash is not a gather back door.
6. As Root, while Idle for gather, I want Git-read (`git_audit`) refused, so that I inspect Evidence only while a Task is live for gather in this cwd.
7. As Root, while Idle for gather, I want `planner_verdict` still allowed, so that a blocked or failed Task with a recorded WorkerReport can still PASS without re-Delegation. Policy does not become a second terminal-state check; `rootVerdictRefusal` remains the verdict gate, and `completed` remains the sole terminal state.
8. As Root, while Idle for gather, I want `write` and `edit` refused, as they already are, so that Idle does not weaken the existing mutation guard.
9. As Root, while Idle for gather, I want a child-delegating `subagent` call allowed, so that I can start the Task.
10. As Root, while Idle for gather, I want `question` and `questionnaire` allowed, so that I can ask the operator when the request is underspecified instead of probing the tree.
11. As Root, while Idle for gather, I want wait and supervisor tools refused, so that Idle gather does not use `bg_wait` / `subagent_wait` / `contact_supervisor` / `subagent_supervisor` as a substitute for Delegation.
12. As Root, while Idle for gather, I want a composite `subagent` workflow still refused, so that Idle does not reopen pre-composed worker-then-reviewer chains.
13. As Root, when this cwd has a live gather Task (state planning, executing, reviewing, or changes_requested — `create()` starts in planning), I want `read`, `grep`, `find`, `ls`, and Git-read allowed, so that I can inspect Evidence before a Verdict.
14. As Root, I want `planner_verdict` allowed whether or not gather is Idle, so that recording a Verdict does not depend on inspect tools being on.
15. As Root, when a Task is live for gather, I still want a general shell and file mutation refused, so that review does not become implementation.
16. As Root, when a Task is live for gather, I want the full `ORCHESTRATION_TOOLS` set allowed unchanged (including `question` and `questionnaire`, not only wait tools), so that splitting that set cannot drop clarifying questions mid-Task.
17. As an operator, after a Task reaches completed, I want this cwd to return to Idle for gather, so that the next request cannot gather on leftover inspect tools.
18. As an operator, after a Task reaches blocked or failed, I want this cwd Idle for gather (inspect/shell/Git-read off) while `planner_verdict` remains callable on that Task, so that a leftover unfinished Task cannot keep inspect tools on for an unrelated new request and the documented blocked/failed → pass hatch stays open.
19. As Root, after a Task is blocked or failed, I want inspect of the tree to require a new Delegation, and I want a Verdict to remain `planner_verdict` on that Task (with `taskId` when `active()` is empty), so that gather and arbitration stay separate.
20. As Root, when Policy refuses a parent gather or mutation tool, I want the refusal to include a fenced TaskSpec JSON I can embed in the next Delegation, so that I do not invent field types from an error list.
21. As Root, I want that refusal JSON to produce zero TaskSpec validation errors, so that the next Delegation is not refused for the same shape.
22. As Root, I want refused tool input to fill the example JSON from this table, so that repair is deterministic: inspect path (`read`/`grep`/`find`/`ls`) → that path in constraints, role Explorer; general shell → command text in objective, role Explorer; `write`/`edit` → role Worker; anything else → placeholder objective, role Explorer unless a submitted valid role exists.
23. As Root, I want a blocked `read` of a skill path to name that path in TaskSpec constraints and use role Explorer, so that the Worker follows the skill instead of Root opening it.
24. As Root, I want a blocked `write` or `edit` to use role Worker in that JSON, so that mutating intent is not silently downgraded to Explorer.
25. As Root, I want a blocked inspect tool or general shell to default `validation.required` false, so that lookup work is not stuck on a missing test command list.
26. As Root, when I embed a TaskSpec whose `validation` is an array, I want Delegation refused before launch and the refusal JSON to use `{ "required": false }` instead of that array, so that I can paste a legal object on the next try.
27. As Root, when I embed a TaskSpec whose `validation.required` is not a boolean, I want the refusal JSON to set `required` to false, so that I am not looping on type errors.
28. As Root, when I embed a TaskSpec whose `validation.commands` is not an array of strings, I want those commands omitted in the refusal JSON, so that the example validates.
29. As Root, I want valid fields I already sent (objective, cwd, role, constraints, acceptanceCriteria, a non-empty taskId that is not the example sentinel, a valid validation object) preserved in the refusal JSON when they already pass TaskSpec validation, so that repair does not throw away a good objective.
30. As Root, I want an invalid TaskSpec with characteristic fields still to create no Task and start no child, so that the existing explicit-failure contract is unchanged.
31. As Root, I want a Delegation with no TaskSpec characteristic fields to keep today's warn-or-strict behaviour, so that Idle Policy does not silently turn unstructured Delegation into a hard failure.
32. As Root, I want the Idle gather allowlist ignored when planner-only is disabled, so that `/planner-only off` still restores ordinary tools.
33. As a Worker, I want Idle Policy ignored for children, so that a child can still use a general shell and file tools.
34. As Root, I want PLANNER_PROMPT to say that with no live gather Task in this cwd the first tool call is one Delegation, so that the injected contract matches Policy.
35. As Root, I want PLANNER_PROMPT to say that skill names belong in TaskSpec constraints and the Worker follows them, so that skill instructions to "read the skill first" are not treated as Root steps.
36. As Root, I want PLANNER_PROMPT to say inspect and Git-read happen while a Task is live for gather, and that a Verdict uses `planner_verdict` (including on blocked/failed), so that review remains licensed after the Worker returns and the escape hatch is not contradicted.
37. As an operator, I want PLANNER_PROMPT to stay within the existing UTF-8 byte bound (1800) and to keep the other standing Root contracts (one TaskSpec per Delegation, WorkerReport shape, role remapping, no pre-composed review workflow, never trust Worker PASS, never accept stale Evidence, delegate corrections, review-round stop). Authorized cuts to free bytes: drop "Keep bash/edit/write listed for children; do not call them" (Policy is the source of truth); merge role remapping and the `workflowScript` ban into one line; merge "One ticket per TaskSpec" into the embed-JSON sentence. Do not raise the bound.
38. As an operator, I want user-attached file paths copied into the TaskSpec scope or constraints instead of Root reading them while Idle for gather, so that attachments do not punch a gather hole in Idle.
39. As an operator, I want a blocked parent tool never to auto-start a Worker, so that a refused shell command is not laundered into a live Task.
40. As an operator, I want README and the Chinese README to say that Idle-for-gather Root may Delegate, ask a question, or record a Verdict, and that inspect/shell/Git-read are off until this cwd has a non-final Task, without retracting "blocked/failed can directly pass; completed is the sole terminal state".
41. As an operator, I want CONTEXT.md to define Idle as Root's gather Policy phase when `activeForCwd` is empty (no planning/executing/reviewing/changes_requested Task in that workspace), so that later tickets do not treat Idle as a Task state or as a verdict gate.
42. As Orchestration, I want the invalid-TaskSpec refusal and the Policy parent-tool refusal to share one example-JSON renderer, so that Root sees one paste shape in those two failure modes. Composite-workflow refusal is a third site and stays out of this renderer.
43. As Root, I want the example JSON `taskId` to be a documented sentinel (`T-pending` is acceptable as the literal). Orchestration must always replace that sentinel with a generated canonical id and must not store the sentinel as an alias. Pasting the same example JSON a second time must start a new Task, not bind to the first. After a successful Delegation I use the canonical id Orchestration returns.
44. As Root, I want example JSON to omit budget, Evidence, extra worktree roots, and invented test commands, so that repair does not guess economics or a test suite.
45. As a Reviewer, I want this spec to leave fresh Reviewer packets, write locks, and PASS snapshot identity unchanged, so that Idle Policy does not reopen hardening.
46. As a Validator, I want required validation commands to keep failing closed when missing, so that Idle repair's `{ required: false }` default is only for example JSON, not a silent downgrade of a live Validator TaskSpec that already had `required: true` without commands.
47. As an operator, I want gather live/Idle to use `activeForCwd(adapter cwd)`, so that a live Task in another worktree cannot turn inspect tools on for this request.
48. As an operator, I want a restored non-final Task from the ledger to make that cwd live for gather, so that crash-resume is not a secret Idle. A store-read failure in the adapter, if it ever occurred, is fail-closed (Idle for gather); that failure surface is not a required test.
49. As Root, while Idle for gather, I want MCP or unknown tools refused the same way as today plus the example JSON, so that a new tool name is not an Idle escape.
50. As an operator, I want existing Policy tests that describe a live gather Task to pass `liveTask: true` (or equivalent) and a cwd, and I want `tool_call` fixture tests that today allow safe bash / `contact_supervisor` / `git_audit` / `planner_verdict` re-checked against an explicit live or Idle fixture, so that module-load order cannot hide a Policy regression. L-4 (blocked → pass → completed) must still pass on the real `planner_verdict` path, not only via direct `execute` that bypasses Policy.
51. As an operator, I want CHANGELOG Unreleased to record Idle gather Policy and the sentinel-alias fix, so that a behaviour change is not silent. Do not claim the blocked/failed verdict hatch was removed.

## Implementation Decisions

- Do not add a phase service. Policy remains the parent tool guard. Orchestration remains the lifecycle coordinator.
- PolicyInput gains two fields the adapter always sets: `cwd` (from `ctx.cwd || process.cwd()`) and `liveTask` (boolean: whether `activeForCwd(cwd)` is defined). Children and a disabled guard still bypass Policy. If the adapter cannot read the store, `liveTask` is false (Idle for gather, fail closed). Do not add a dedicated test for that failure; `active()` / `activeForCwd()` are in-memory.
- Gather-live means `activeForCwd(cwd)` returns a Task: the most recently updated Task in that workspace that is not in a final state. Final states stay completed, blocked, and failed. Idle for gather is the absence of that record. Global `active()` is not the gather signal (it can see another cwd).
- Ledger restore: a restored non-final Task in a cwd makes gather live for that cwd. That is accepted. Idle happens again when that Task is final or abandoned. Do not filter restored Tasks out of gather-live.
- While Idle for gather, Policy allows: a child-delegating Delegation via `subagent`, `question`, `questionnaire`, and `planner_verdict`. Every other tool is refused, including inspect tools, Git-read, wait/supervisor tools, file mutation, a general shell, and shell commands that are safe Git-read when gather is live.
- `planner_verdict` is never Idle-refused. Whether a Verdict may be recorded stays in `rootVerdictRefusal` / `recordRootVerdict` (blocked/failed may move to reviewing and pass; only `completed` is terminal). A call without `taskId` while `active()` is empty already fails inside the tool; do not invent a blocked-Task lookup in Policy.
- While gather is live, Policy keeps today's allowlist, with this wording: inspect tools, the full `ORCHESTRATION_TOOLS` set, Git-read, Verdict, child-delegating Delegation, and the existing mutation/shell refusals. Do not remove live-Task safe-shell Git-read; that leftover is out of scope.
- Block reasons for a refused parent tool (Policy) and for an invalid embedded TaskSpec (Orchestration begin-Delegation) share one TaskSpec example renderer owned next to TaskSpec validation. Both reasons keep their existing first lines and then append one fenced JSON object plus the instruction to embed that object in the Delegation prompt. Composite-workflow refusal (`compositeWorkflowBlockReason`) does not use this renderer and does not gain example JSON.
- The example object must produce zero TaskSpec validation errors. `cwd` comes from PolicyInput / the Delegation cwd. Fill fields from the per-tool table in story 22. Optional fields that are the wrong type are dropped rather than guessed. `validation` that is missing or invalid becomes `{ "required": false }` with no commands. Do not invent budget, Evidence, extra worktree roots, or test commands.
- Preserve submitted fields that already pass per-field TaskSpec validation, except the example sentinel `taskId`.
- Documented sentinel: `T-pending`. Orchestration always replaces it (`shouldReplaceTaskId` already would) and must not pass it into `store.create` as an alias. `store.get("T-pending")` after the first paste must not resolve to that Task. A second Delegation whose TaskSpec still uses `T-pending` creates a new Task.
- Invalid TaskSpec with characteristic fields still refuses before launch and creates no Task. Unstructured Delegation (no characteristic fields) keeps warn-versus-strict behaviour.
- PLANNER_PROMPT is rewritten, not appended, stays ≤ 1800 UTF-8 bytes, and uses the authorized cuts in story 37. Positive Idle contract: with no live gather Task in this cwd, the first tool call is one Delegation; name skills in TaskSpec constraints; inspect and Git-read while gather is live; Verdict via `planner_verdict`, including blocked/failed. Update fragment tests; do not snapshot the whole prompt. Do not add a Root-facing slash command.
- CONTEXT.md defines Idle as the gather Policy phase when `activeForCwd` is empty. README and the Chinese README each gain a short Idle-gather sentence in parity and keep the blocked/failed pass hatch. CHANGELOG Unreleased records both Idle gather and the sentinel-alias fix. Do not claim bash was removed from Root's schema.
- Never auto-start a child from a refused parent tool.
- Do not retract L-4 or the "Blocked lifecycle: still accepts Root planner_verdict" status line.

## Testing Decisions

Good tests drive the external behaviours an operator can see: which Root tools Policy allows in which gather phase, whether `planner_verdict` still works on blocked/failed, and whether a refusal contains JSON that TaskSpec validation accepts and that does not rebind via alias. They do not assert helper names, prompt snapshots, or adapter internals.

Seams (prefer these existing ones; add no new module):

1. Policy — Idle versus live gather allowlist (including `planner_verdict` allowed when Idle); parent-tool refusal text containing validating TaskSpec JSON; `cwd` + `liveTask` on the Policy input.
2. TaskSpec validation — example/repair JSON has zero validation errors; submitted valid fields are preserved; invalid `validation` becomes `{ required: false }`.
3. Orchestration begin-Delegation — characteristic-but-invalid TaskSpec still creates no Task and starts no child; the refusal includes that same validating JSON; sentinel `T-pending` is replaced and not aliased; a second paste of the same sentinel starts a new Task (does not bind to the first, including when the first is already completed).
4. Prompt contract tests — UTF-8 bound and semantic fragments, including Idle first-tool Delegation and skills-in-constraints; standing fragments remain after the authorized cuts.
5. Adapter / `tool_call` fixtures — explicit live versus Idle cwd fixtures for safe bash, `git_audit`, `contact_supervisor`, and `planner_verdict`. L-4 style blocked → pass must succeed when Policy is on the path, not only via direct tool `execute`.

Prior art: existing Policy allow/deny tests, extract-TaskSpec-details tests for `validation.required`, Orchestration tests that begin-Delegation returns a block reason, PLANNER_PROMPT UTF-8 bound plus fragment tests, index `tool_call` allow/deny tests, L-4 blocked → pass in the index tests, Orchestration `recordRootVerdict` blocked → reviewing tests.

A good refusal test parses the fenced JSON out of the reason and runs TaskSpec validation on it. A good sentinel test pastes `T-pending` twice and asserts two canonical Task ids and `store.get("T-pending")` undefined (or not equal to the first Task). A bad test snapshots the whole reason string or the renderer function's name.

Do not require a live host session or pi-subagents e2e for this spec. Do not add a test whose only claim is "store.active throws".

## Out of Scope

- Hiding bash/edit/write from Root's tool schema, or splitting the child tool ceiling from the parent schema (host / pi-subagents).
- Auto-wrapping a refused parent tool into a launched Worker.
- Changing structured-Delegation default (warn vs strict), fresh Reviewer default, write locks, PASS snapshot identity, usage floors, or session budget.
- Raising the PLANNER_PROMPT byte bound.
- Removing live-Task safe-shell Git-read.
- Rewriting or intercepting host skill documents beyond the one PLANNER_PROMPT sentence and TaskSpec constraints.
- Cursor/MCP-specific gather tools as a special case; unknown tools follow Policy like any other name.
- P0 option (b): removing the blocked/failed `planner_verdict` hatch, making completed-or-operator-override the only revival path, or rewriting Orchestration status text that says blocked still accepts Root `planner_verdict`.
- Example JSON on the composite-workflow refusal path.

## Further Notes

Idle is a gather Policy phase, not a new Task state and not a verdict gate. Do not add `idle` to the Task state machine.

The motivating failure was two stacked loops: Idle gather (blocked parent tools) and contract retry (invalid TaskSpec). The gather allowlist stops the first; pasteable JSON plus a non-aliasing sentinel stop the second. Prompt text alone has already lost to more specific skill instructions; Policy is the source of truth.

User-attached files while Idle for gather belong in the TaskSpec. That is deliberate: an Idle `read` hole for attachments would bring gather back.

A blocked or failed Task does not keep inspect tools on. Re-Delegation is the path to look at the tree again. A Verdict on that Task remains `planner_verdict`.

Implementation tickets live under `.scratch/root-idle-phase/issues/`. Ticket 02 is blocked by ticket 01 so Idle refusals can ship with validating JSON from day one.

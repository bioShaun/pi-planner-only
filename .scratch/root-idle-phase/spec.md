# Root Idle Policy

**Status:** ready-for-agent

Arbitration (2026-09-10): P0 chooses **(a)** — gather goes Idle when `activeForCwd` is empty; `planner_verdict` stays a Root tool and the blocked/failed escape hatch is not removed. P1: example `taskId` sentinel is replaced and never stored as an alias. P2: PolicyInput carries `cwd`; gather uses `activeForCwd`; ledger restore of a non-final Task makes that cwd live. Do not implement (b).

Revision (2026-09-10): delivery order is Evidence attribution/freshness → retry classification and stop-loss → this feature. Within this feature, issue 01 supplies the legal Delegation contract; issue 02 ships Explorer lifecycle, bounded result recovery, and Idle Policy together. Do not enable Idle before its exit and recovery paths work.

## Problem Statement

When an operator gives Root a new request, Root still tries to do the work itself: it opens skills, calls a general shell, then retries a Delegation with a malformed TaskSpec. Each blocked call costs a Root turn. A lookup that should have been one Explorer Delegation instead burns several Root turns on tools Policy will refuse and on TaskSpec shapes Orchestration will refuse.

The operator sees the same loop every time: Root gathers, the guard blocks, Root guesses a TaskSpec, the guard blocks again, and only then does a child run.

Two lifecycle gaps would make an Idle-only guard ineffective: a standalone Explorer with a TaskSpec starts a Task but its result currently leaves that Task executing; an unbound asynchronous Explorer creates no live Task, so refusing every wait tool would prevent recovery when its completion notice is lost. The result must be recoverable and the Task must have a controlled route back to Idle.

## Solution

Root has a gather Policy phase, derived from the Task store for the adapter workspace, not from prompt wording.

While Idle for gather (`activeForCwd` empty), Root may start a Delegation, ask a clarifying question, record a Verdict with `planner_verdict`, or recover one already registered pending run through an exact-id `bg_wait` request for this cwd. Inspect tools, Git-read, and a general shell are refused. Every such refusal includes a copy-paste TaskSpec JSON that already passes TaskSpec validation, filled from whatever Root just attempted.

While a Task is live for gather in that cwd, today's inspect and review tools stay available. Root still does not edit, write, or run a general shell.

`planner_verdict` is outside the gather restriction. Blocked and failed Tasks can still receive a Root Verdict when they have a recorded WorkerReport; `completed` remains the sole terminal state for verdicts. That existing escape hatch is kept.

A standalone Explorer returns a WorkerReport for its own Task; confirmed completion moves it to reviewing, and Root records the Verdict through the existing acceptance boundary. An auxiliary Explorer only finishes its own Delegation and never closes or revives the Task it assists. An unbound Explorer keeps its raw-output compatibility and does not manufacture a Task.

Skills are named in TaskSpec constraints. The Worker follows them. Root does not open skill documents in order to execute them.

## User Stories

1. As an operator, I want Root's first gather action on a new request to be a Delegation, so that I do not pay Root turns for work a child will do anyway.
2. As an operator, I want a lookup request (read a Feishu task, inspect a URL, run a CLI) to become one Explorer Delegation, so that Root does not probe then retry.
3. As Root, while Idle for gather, I want `read` refused, so that opening a skill or source file is not a substitute for Delegation.
4. As Root, while Idle for gather, I want `grep`, `find`, and `ls` refused, so that workspace search is not a substitute for Delegation.
5. As Root, while Idle for gather, I want a general shell refused, including commands that Policy today treats as safe Git-read via the shell, so that `git status` through bash is not a gather back door.
6. As Root, while Idle for gather, I want Git-read (`git_audit`) refused, so that I inspect Evidence only while a Task is live for gather in this cwd.
7. As Root, while Idle for gather, I want `planner_verdict` still allowed, so that a blocked or failed Task with a recorded WorkerReport can still PASS without re-Delegation. Policy does not become a second terminal-state check; `rootVerdictRefusal` remains the verdict gate, and `completed` remains the sole terminal state.
8. As Root, while Idle for gather, I want `write` and `edit` refused, as they already are, so that Idle does not weaken the existing mutation guard.
9. As Root, while Idle for gather, I want a child-delegating `subagent` call allowed, so that I can start the Task.
10. As Root, while Idle for gather, I want `question` and `questionnaire` allowed, so that I can ask the operator when the request is underspecified instead of probing the tree.
11. As Root, while Idle for gather, I want generic wait and supervisor tools refused, with only an exact-id `bg_wait` for a registered pending run in this cwd allowed, so that lost completion delivery is recoverable without permitting discovery of unrelated runs.
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
34. As Root, I want PLANNER_PROMPT to say that with no live gather Task in this cwd new gather starts with one Delegation; known-run recovery and Verdict remain allowed, so that the injected contract matches Policy.
35. As Root, I want PLANNER_PROMPT to say that skill names belong in TaskSpec constraints and the Worker follows them, so that skill instructions to "read the skill first" are not treated as Root steps.
36. As Root, I want PLANNER_PROMPT to say inspect and Git-read happen while a Task is live for gather, and that a Verdict uses `planner_verdict` (including on blocked/failed), so that review remains licensed after the Worker returns and the escape hatch is not contradicted.
37. As an operator, I want PLANNER_PROMPT to stay within the existing UTF-8 byte bound (1800) and to keep the other standing Root contracts (one TaskSpec per Delegation, WorkerReport shape, role remapping, no pre-composed review workflow, never trust Worker PASS, never accept stale Evidence, delegate corrections, review-round stop). Authorized cuts to free bytes: drop "Keep bash/edit/write listed for children; do not call them" (Policy is the source of truth); merge role remapping and the `workflowScript` ban into one line; merge "One ticket per TaskSpec" into the embed-JSON sentence. Do not raise the bound.
38. As an operator, I want user-attached file paths copied into the TaskSpec scope or constraints instead of Root reading them while Idle for gather, so that attachments do not punch a gather hole in Idle.
39. As an operator, I want a blocked parent tool never to auto-start a Worker, so that a refused shell command is not laundered into a live Task.
40. As an operator, I want README and the Chinese README to say that Idle-for-gather Root may Delegate, ask a question, record a Verdict, or recover an exact known pending run, and that inspect/shell/Git-read are off until this cwd has a non-final Task, without retracting "blocked/failed can directly pass; completed is the sole terminal state".
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

52. As Root, I want a standalone Explorer Task to return a WorkerReport and become reviewing only after a confirmed successful run, so that I can judge its findings and close the Task with a Verdict.
53. As an operator, I want zero-change exploration to be a valid outcome under the existing review mode, so that a simple lookup does not acquire mandatory Reviewer or Validator calls just to exit Idle.
54. As Orchestration, I want each Explorer Delegation classified at launch as standalone, auxiliary, or unbound, so that receipt handling never guesses which Task it owns from the currently active Task.
55. As Root, I want an auxiliary Explorer success, failure, or cancellation to leave the assisted Task lifecycle, reports, Evidence baseline, and writer ownership unchanged, so that parallel inspection cannot end or revive other work.
56. As Root, I want sync results, async notices, and saved-result reconciliation to use the same Explorer completion rules, so that losing a notice cannot leave a finished Task executing forever.
57. As an operator, I want launch acknowledgements, wait timeouts, and unknown exit status to stay pending, so that starting or waiting is never mistaken for success.
58. As Root, I want confirmed launch failure, nonzero exit, cancellation, and malformed standalone reports to produce an explicit non-success outcome and next action, so that I can recover without a permanently executing Task or a false PASS.
59. As Root, I want an unbound Explorer result recovered by exact run id even when its native notice is missing and the wait response contains no completions, so that raw findings are not discarded merely because no Task exists.
60. As an operator, I want wrong-cwd, unknown, prefix-only, already-consumed, and all-runs wait requests refused while Idle, so that result recovery does not broaden gather permission.
61. As an operator, I want duplicate, late, superseded, and restored receipts to respect the original run ownership and acceptance state, so that replay cannot reopen completed work, overwrite newer reports, or grant permission from an untrusted id.
62. As Root, I want terminal results returned once with their run identity and a useful next action, so that recovery does not add duplicate context or busy-wait instructions.
63. As an operator, I want the full Idle → standalone Explorer → pending recovery → review → Verdict → Idle lifecycle covered at the Orchestration and adapter boundary, so that testing proves the Policy can both activate and release.

## Implementation Decisions

- Do not add a phase service. Policy remains the parent tool guard. Orchestration remains the lifecycle coordinator.
- PolicyInput gains workspace fields the adapter always sets: `cwd` (from `ctx.cwd || process.cwd()`) and `liveTask` (boolean: whether `activeForCwd(cwd)` is defined). Children and a disabled guard still bypass Policy. If the adapter cannot read the store, `liveTask` is false (Idle for gather, fail closed). Do not add a dedicated test for that failure; `active()` / `activeForCwd()` are in-memory.
- Gather-live means `activeForCwd(cwd)` returns a Task: the most recently updated Task in that workspace that is not in a final state. Final states stay completed, blocked, and failed. Idle for gather is the absence of that record. Global `active()` is not the gather signal (it can see another cwd).
- Ledger restore: a restored non-final Task in a cwd makes gather live for that cwd. That is accepted. Idle happens again when that Task is final or abandoned. A restored Task alone never authorizes an exact-run recovery exception; that exception requires a trusted pending Delegation binding. Do not filter restored Tasks out of gather-live.
- While Idle for gather, Policy allows child-delegating `subagent`, `question`, `questionnaire`, `planner_verdict`, and the bounded `bg_wait` recovery below. Every other tool is refused, including inspect tools, Git-read, generic wait/supervisor calls, mutation, and safe-shell Git-read. Pending unbound work does not make gather live.
- `planner_verdict` is never Idle-refused. Whether a Verdict may be recorded stays in `rootVerdictRefusal` / `recordRootVerdict` (blocked/failed may move to reviewing and pass; only `completed` is terminal). A call without `taskId` while `active()` is empty already fails inside the tool; do not invent a blocked-Task lookup in Policy.
- While gather is live, Policy keeps today's allowlist, with this wording: inspect tools, the full `ORCHESTRATION_TOOLS` set, Git-read, Verdict, child-delegating Delegation, and the existing mutation/shell refusals. Do not remove live-Task safe-shell Git-read; that leftover is out of scope.
- Block reasons for a refused parent tool (Policy) and for an invalid embedded TaskSpec (Orchestration begin-Delegation) share one TaskSpec example renderer owned next to TaskSpec validation. Both reasons keep their existing first lines and then append one fenced JSON object plus the instruction to embed that object in the Delegation prompt. Composite-workflow refusal (`compositeWorkflowBlockReason`) does not use this renderer and does not gain example JSON.
- The example object must produce zero TaskSpec validation errors. Explorer constraints must request a WorkerReport when the example creates a standalone Task; its launch packet names the generated canonical Task id and the existing report identity, never the example sentinel. `cwd` comes from PolicyInput / the Delegation cwd. Fill fields from the per-tool table in story 22. Optional fields that are the wrong type are dropped rather than guessed. `validation` that is missing or invalid becomes `{ "required": false }` with no commands. Do not invent budget, Evidence, extra worktree roots, or test commands.
- Preserve submitted fields that already pass per-field TaskSpec validation, except the example sentinel `taskId`.
- Documented sentinel: `T-pending`. Orchestration always replaces it (`shouldReplaceTaskId` already would) and must not pass it into `store.create` as an alias. `store.get("T-pending")` after the first paste must not resolve to that Task. A second Delegation whose TaskSpec still uses `T-pending` creates a new Task.
- Invalid TaskSpec with characteristic fields still refuses before launch and creates no Task. Unstructured Delegation (no characteristic fields) keeps warn-versus-strict behaviour.
- PLANNER_PROMPT is rewritten, not appended, stays ≤ 1800 UTF-8 bytes, and uses the authorized cuts in story 37. Positive Idle contract: with no live gather Task in this cwd, new gather starts with one Delegation; exact known-run recovery and Verdict remain allowed; name skills in TaskSpec constraints; inspect and Git-read while gather is live; Verdict via `planner_verdict`, including blocked/failed. Update fragment tests; do not snapshot the whole prompt. Do not add a Root-facing slash command.
- CONTEXT.md defines Idle as the gather Policy phase when `activeForCwd` is empty. README and the Chinese README each gain a short Idle-gather sentence in parity and keep the blocked/failed pass hatch. CHANGELOG Unreleased records both Idle gather and the sentinel-alias fix. Do not claim bash was removed from Root's schema.
- Explorer ownership is fixed at accepted launch: an Explorer creating a new Task owns that standalone Task; a continuation of that same standalone Explorer Task keeps that ownership; an Explorer assisting an existing Worker/Validator Task is auxiliary; a legacy unstructured Explorer that binds no Task is unbound. Persist enough Task ownership to distinguish continuation after restore. Role alone or the current active Task is not ownership. Auxiliary begin and all terminal paths must leave the assisted Task state, reports, Evidence baseline, review mode, and pending writers unchanged.
- A standalone Explorer uses the existing WorkerReport contract, with findings in its summary and truthful changed-files, validation, and Evidence fields. Capture and bind its own run Evidence using the preceding Evidence work; never reset an assisted Task's attribution window. A confirmed successful run with a valid report goes executing → reviewing, then through `planner_verdict` and the existing Review loop to completed or another recorded outcome. Do not auto-complete on a receipt or synthesize a PASS report from raw prose. A verified unchanged workspace and empty changed-files list is a valid read-only outcome; it does not waive Evidence freshness or configured review requirements. Preserve the existing review-mode choice and required validation settings; do not automatically add Reviewer/Validator calls to a simple standalone lookup.
- Confirmed launch failure, nonzero exit, or cancellation ends the standalone invocation and records failed with a reason; malformed or absent terminal WorkerReport records blocked with a contract-repair instruction. No new Task state is introduced. A pending receipt, wait timeout/window expiry, empty management response, or ambiguous error after launch is not confirmed exit and keeps the invocation pending. Existing Root blocked-Verdict and sealed-receipt rules still apply. Auxiliary/unbound errors only record that invocation outcome. Late results cannot revive a blocked/failed Task automatically or overwrite a completed or newer accepted result.
- Use one Orchestration Explorer completion path for sync results, validated async terminal notices, and saved-result reconciliation. It binds the original tool-call/run identity before state changes, records each terminal result once, and retains output for delivery. Reconcile must not discard unbound output after finding no Task. A superseded or consumed run may not mutate the Task again; an auxiliary result never completes the assisted Task.
- Choose bounded recovery through existing `bg_wait`, not a new generic inspect or recovery tool. The adapter derives authorization from a registered pending Delegation: exact full host run id, original tool-call identity, and launch cwd. Store launch cwd even for unbound Explorer calls; an accounting Task in another cwd is not authorization. Accept only the exact registered id and bounded blocking timeout (at most 60 seconds); reject omitted ids, prefixes, all-runs requests, nonblocking subscription requests, unknown extra fields, and cross-cwd or consumed ids while Idle. Other wait/supervisor tools remain refused. This is a per-call exception, not a live-Task flag; Root cannot supply its own authorization boolean.
- Reuse the actual host run id from the async receipt, not canonical Task id, accounting id, or provider id. The installed host supports `bg_wait` id lookup including prefixes, but Policy deliberately permits exact recorded identities only. Before and after the authorized wait, reconcile only that registered run against its trusted saved-result location; a management-only wait response is not completion proof. Consume terminal metadata and saved output through the same completion path and deliver the recovered output through the adapter response even without a native notice. Existing completion payloads may be used only after exact identity and terminal-status validation. Missing metadata/output or a missing receipt id reports pending/unavailable with a reason, without broad scans or new Delegations. Do not recommend a generic wait as fallback.
- Recovery binding and result-consumption state must survive the lifecycle in which they are used. If a restart cannot restore a trusted run/cwd binding from existing persisted records, refuse the Idle exception and report recovery unavailable; do not infer it from a Task id, accounting entry, filename, or caller-supplied path. Persist standalone ownership/report state through existing Task persistence. Full reconstruction of every legacy pending run across process restarts is outside this feature. Replay after consumption, abandonment, or sealed Verdict cannot reopen gather permission.
- Never auto-start a child from a refused parent tool.
- Do not retract L-4 or the "Blocked lifecycle: still accepts Root planner_verdict" status line.

## Testing Decisions

Good tests drive the external behaviours an operator can see: which Root tools Policy allows in which gather phase, whether `planner_verdict` still works on blocked/failed, and whether a refusal contains JSON that TaskSpec validation accepts and that does not rebind via alias. They do not assert helper names, prompt snapshots, or adapter internals.

The user confirmed the primary seam: the full Orchestration Task lifecycle, with adapter `tool_call` Policy enabled. Use real Task state and report processing; fake only the host run delivery and Git boundary where necessary. Smaller Policy/TaskSpec/prompt tests supplement this seam rather than replacing it.

| Scenario | Observable acceptance |
| --- | --- |
| Idle read → paste refusal JSON → standalone Explorer async launch → recover pending result → review → Root Verdict | Valid TaskSpec creates a canonical Task; no receipt-only success; valid terminal WorkerReport is recorded; existing acceptance passes; the next read is refused when no other live Task remains in the cwd. |
| Synchronous result, native async notice, saved-result reconciliation | Same standalone lifecycle and outcome; the result is delivered once and does not remain executing after terminal processing. |
| Zero-change standalone lookup | Normal report and existing review mode suffice; no fabricated edits, validation command, or forced extra child call. Freshness and explicitly required review still gate PASS. |
| Auxiliary Explorer succeeds, fails, or is cancelled while a Worker is pending | Its output/outcome is returned; assisted Task state, latest WorkerReport, baseline, and writer ownership remain unchanged. |
| Unbound pending Explorer, lost native notice, wait returns only management data | Same-cwd exact-id wait remains allowed while read stays refused; trusted terminal metadata/output is reconciled and returned once without creating a Task. |
| Receipt, timeout, ambiguous launch error, missing terminal metadata | No success, no consumed live invocation, explicit pending/unavailable reason; no automatic retry or busy-wait loop. |
| Confirmed launch failure, nonzero exit, cancellation, malformed standalone terminal report | Failed or blocked as specified, inspect switches off absent other live Tasks; repair/blocked Verdict remains reachable. |
| Omitted/prefix/unknown/consumed id, all-runs, subscription, unknown fields, wrong cwd | Idle recovery denied. No arbitrary wait, broad artifact lookup, or accidental global-active permission. |
| Duplicate notify after recovery; late result after supersede/seal; restored ownership | No duplicate report/output/state change; no assisted-Task completion or permission inferred from stale ids. Missing trusted restored binding fails closed. |
| Another live Task in the same cwd; live Task only in another cwd | Completing one Task does not force Idle while another local Task is live; another cwd never enables gather or recovery here. |
| Blocked → Root pass → completed through adapter | Existing report/Evidence/review gates and L-4 remain effective with Policy on the path. |

Supplemental checks retain example parsing through TaskSpec validation, preservation of valid submitted fields, invalid validation repair, sentinel non-aliasing across repeated pastes, characteristic-but-invalid refusal before launch, unstructured warn/strict behaviour, guard-off and child bypasses, explicit cwd fixtures for the existing allowlist, and prompt semantic fragments within 1800 UTF-8 bytes. Do not snapshot whole prompts/reasons or helper names.

Prior art: existing Orchestration begin-Delegation, WorkerReport, pending reconciliation, and Root Verdict tests; adapter `tool_call`/`tool_result` and async notify fixtures; L-4 blocked → pass; TaskSpec extraction, Policy allow/deny, and prompt UTF-8/fragment tests. Add a host-shaped exact-id wait fixture based on the installed wait schema and management-only response, plus saved metadata/output; do not invent a `completions` array for every ordinary async wait.

Implementation QA drives the same lifecycle through the plugin adapter and records the final Policy decision and Task status. A live host session is not required for this document's implementation gate; do not claim live-host reliability or token savings from fixtures. Before publishing such claims, use the separate host validation/cost comparison work. Do not add a test whose only claim is that an in-memory store lookup throws.

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
- Root waiting-cost optimization while Workers are running, a general capability platform, new model pricing policy, or a general cross-session pending-run migration.
- Changing the preceding Evidence/stop-loss specifications or relaxing report freshness to make an Explorer close.

## Further Notes

Idle is a gather Policy phase, not a new Task state and not a verdict gate. Do not add `idle` to the Task state machine.

The motivating failure was two stacked loops: Idle gather (blocked parent tools) and contract retry (invalid TaskSpec). The gather allowlist stops the first; pasteable JSON plus a non-aliasing sentinel stop the second. Prompt text alone has already lost to more specific skill instructions; Policy is the source of truth.

User-attached files while Idle for gather belong in the TaskSpec. That is deliberate: an Idle `read` hole for attachments would bring gather back.

A blocked or failed Task does not keep inspect tools on. Re-Delegation is the path to look at the tree again. A Verdict on that Task remains `planner_verdict`.

Implementation tickets live under `.scratch/root-idle-phase/issues/`. Ticket 01 precedes ticket 02 so Idle refusals ship with validating JSON. Both follow the Evidence and retry stop-loss work. Ticket 02 includes lifecycle closure and bounded recovery as release prerequisites, not follow-up cleanup.

Source checks for implementation: current Explorer sync/notify/reconcile paths return or discard raw output without closing standalone Tasks; the adapter currently treats `bg_wait` as Usage collection only. The installed host wait tool accepts exact run ids as well as prefixes; the existing usage adapter joins completions to registered `runId`. These are available seams, not proof that lifecycle recovery already works. The implementation must wire and verify them.

Measure the same lookup workload before/after using Root Usage, child calls, contract retries, result-recovery attempts, and total task cost; do not equate more Delegations with proven savings.

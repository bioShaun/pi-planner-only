# Invocation lock and snapshot PASS

**Status:** ready-for-agent

Parent review: hardening tickets 01–10 were marked done on `main` (`fa2855d…79837cb`). This spec is the leftover: behaviour those tickets promised that the implementation still does not deliver.

## Problem Statement

Root still cannot treat “one writable child per worktree” and “PASS means the workspace snapshot still matches” as true.

A Validator that can run a general shell, or a second Worker started while the Task is already reviewing, does not hold the write lock. Two such children can launch on the same worktree. A lost completion notice leaves the Task executing, so the next same-Task Delegation is refused by that executing state instead of reconciling or superseding the leftover waiter — the original pending-deadlock path is only half-closed.

A Reviewer PASS can still complete a Task using HEAD/status/content hashes, even when no WorkspaceSnapshot is bound, and even when the ReviewRequest’s patch was truncated. Root’s own `planner_verdict` re-samples the snapshot; the Reviewer accept path does not. Operators reading the README are still told that no full diff crosses the seam.

## Solution

Every writable Delegation acquires and holds one worktree lock for the life of that invocation. Starting another writable child on the same worktree either consumes a finished leftover, supersedes a waiter that is not actually running, or is refused — it never launches beside a live writer.

PASS completes a Task only when a current WorkspaceSnapshot digest matches the digest bound to the report under review. A truncated Reviewer packet cannot complete. HEAD/status hashes are evidence for attribution, not a substitute identity for PASS.

## User Stories

1. As Root, I want at most one writable child running in a worktree, so that two writers cannot interleave edits I cannot attribute.
2. As Root, I want a Validator with a general shell to take that same lock, so that “no edit tool” is not a back door to unsynchronized writes.
3. As Root, I want a Worker started while the Task is reviewing to take that same lock, so that a second execution round cannot start beside an unfinished writer.
4. As Root, I want a second writable Delegation on the same Task to contend for the lock, so that same-Task is not a free pass.
5. As Root, I want Explorer and Reviewer invocations to stay unlocked, so that inspection does not stall writers.
6. As Root, I want two independent worktrees to keep independent locks, so that isolation is still available.
7. As Root, I want relative-path and symlink aliases of one worktree to share the lock, so that a renamed cwd cannot dodge coordination.
8. As Root, I want warn-mode unstructured Workers to take the lock, so that missing a TaskSpec does not skip coordination.
9. As an operator, I want a conflicting writable start refused before the child launches, so that I never see two executing writers on one tree.
10. As an operator, I want the refusal to name the holder Task, so that I know whom to wait for or abandon.
11. As Root, I want the lock held by the live writable Delegation, not by the Task sitting in executing, so that a reviewing Task with no live writer does not block, and a live writer whose Task is not executing still blocks.
12. As Root, I want a stale-looking executing Task to keep blocking while its child is not known stopped, so that timeout is not treated as exit.
13. As Root, I want a confirmed launch failure (no process) to release the lock, so that a phantom holder cannot stall the worktree.
14. As Root, I want cancel or unreadable child output to keep the lock until the child is known stopped, so that a dying writer cannot be raced.
15. As an operator, I want unlock after confirmed exit to be idempotent, so that a completion notice and a cancel cannot double-release.
16. As Root, I want begin-delegation to reconcile finished pending children from artifacts before taking the lock, so that a lost `subagent-notify` with a terminal child-run meta does not look like a live writer.
17. As Root, I want that reconcile to record the finished Worker or Validator result when it is still usable, so that a completed run is not thrown away when I re-delegate.
18. As Root, I want a leftover waiter with no terminal artifacts to be superseded when I start a new Delegation for the same Task, so that later notices are not ambiguous.
19. As Root, I want a leftover waiter whose child is still not known stopped to keep the lock and refuse the new writable start, so that supersede cannot launch a second live writer.
20. As Root, I want a single-run completion notice after supersede to match only the remaining waiter, so that “match nothing” cannot deadlock the Task.
21. As Root, I want a late notice for a superseded run to record nothing and not move the Task backwards, so that the new invocation owns the report.
22. As Root, I want `blocked` to remain recordable while a child is still pending after reconcile, so that the escape hatch from ticket 01 stays open.
23. As Root, I want `pass` and `request_changes` to keep waiting on a truly live pending child, so that I cannot accept work that has not returned.
24. As a Reviewer, I want my PASS to name the report revision and WorkspaceSnapshot digest I was shown, so that an old PASS cannot complete a newer report.
25. As Root, I want a Reviewer PASS that omits those bindings to be refused, so that unbound accept cannot complete the Task.
26. As Root, I want a Reviewer PASS whose digest does not match a newly sampled WorkspaceSnapshot to be refused, so that accept is not cheaper than `planner_verdict`.
27. As Root, I want a pre-snapshot WorkerReport to be unable to complete via Reviewer PASS or via `planner_verdict`, so that old reports cannot skip the snapshot gate.
28. As Root, I want HEAD/status/content hashes never to stand in as the PASS identity when a snapshot digest is required, so that `workspaceSummaryDigest` cannot complete a Task.
29. As Root, I want a Reviewer’s `evidenceFresh` flag to never override the snapshot comparison, so that a child cannot declare the tree fresh.
30. As a Reviewer, I want a truncated or omitted patch to make PASS ineligible, so that I cannot accept a packet I did not fully see.
31. As Root, I want `request_changes` and `blocked` still allowed when the packet is truncated, so that incomplete evidence can still stop the Task without pretending to PASS.
32. As an operator, I want the ReviewRequest to keep carrying a bounded patch against the Task baseline, so that committed Task changes remain reviewable.
33. As an operator, I want README (and the Chinese README) to say that a bounded patch does cross the Reviewer seam, so that I am not told the opposite of the product.
34. As an operator, I want README to say PASS is snapshot-digest-bound, so that I do not think HEAD/status hashes are enough.
35. As Orchestration, I want Task fields such as `stateReason` written only through the Task store, so that the adapter/orchestration seam does not mutate Task memory in place.
36. As an operator, I want a stale lock to surface as a recorded needs-reconcile reason on the holder, so that status explains why a new writer was refused.
37. As Root, I want WorkspaceSnapshot unknown (over-budget, unreadable, unstable) at accept time to refuse PASS, so that truncated sampling cannot look fresh.
38. As Root, I want a matching snapshot digest plus a matching report revision to still complete, so that the happy path is not broken by the stricter gate.
39. As a Worker, I want my finished run’s bound snapshot to be the digest Reviewers and Root both use, so that review and acceptance share one identity.
40. As an operator, I want existing artifact reconcile, tool-restore, and release-gate behaviour from the prior hardening round left intact, so that this spec does not reopen closed tickets.

## Implementation Decisions

- The product seam is Orchestration. Lock acquire/refuse, pending reconcile, supersede, Reviewer accept, and Root verdict all change through that coordinator. Do not add a second lock service.
- A writable invocation is any Delegation whose role is allowed mutating tools (Worker, Validator, and unstructured warn-mode Worker). Explorer and Reviewer are not writable.
- The write lock is owned by a live writable Delegation for a normalized worktree identity, not by `Task.state === "executing"`. Holder lookup must see live writable Delegations even when the Task is reviewing, blocked, or otherwise not executing.
- Starting a writable Delegation: (1) reconcile same-Task pending children from child-run artifacts; (2) if a live writable Delegation still holds this worktree and its child is not known stopped, refuse before launch; (3) otherwise supersede leftover same-Task waiters; (4) register the new Delegation as the lock holder; (5) transition the Task to executing only when the lifecycle actually requires it — lock holding must not depend on that transition.
- Validators do not rebind or transition the reviewed Task, but they still perform steps 1–4 on the worktree they will write (and on the reviewed Task’s worktree when those differ).
- “Known stopped” remains: consumed result, consumed notify, consumed terminal artifact, confirmed never-started, or operator abandon. Timeout, cancel, and unreadable output are not stop.
- PASS identity is the WorkspaceSnapshot digest bound to the latest WorkerReport (plus that report’s revision). Root `planner_verdict` already re-samples; Reviewer accept must re-sample with the same comparison and refuse unless the binding is fresh.
- Drop HEAD/status/`dirtyPathHashes` fallbacks as a PASS or Reviewer-binding identity. Those fields may still describe Git attribution inside Evidence. A missing bound snapshot is unknown, not a hash of porcelain.
- A ReviewResult `pass` with `patchTruncated` or omitted patch paths on the packet that Reviewer was sent is refused; Task state is unchanged. Non-pass verdicts are unchanged by truncation.
- Needs-reconcile notes on a stale holder are recorded through the Task store, not by writing the in-memory record from Orchestration.
- User-facing docs must match: bounded patch is in the ReviewRequest; PASS is snapshot-digest-bound; Chinese README stays in parity.

## Testing Decisions

- Good tests drive Orchestration the way Root does: start a Delegation, feed a child result or a Root verdict, and assert Task state, pending waiters, lock refusal, and whether a PASS completed. They do not assert internal maps or helper names.
- One seam: Orchestration’s public entry points (begin Delegation, handle child result / notify, record Root verdict). Prefer this over adding tests only against the worktree-conflict helper: that helper currently keys on executing Tasks and would stay green while two Validators still launch.
- Prior art: the existing Orchestration suite already covers receipt-vs-notify, pending reconcile, same-Task supersede on the reviewing path, writer conflict, Reviewer identity, and Root snapshot PASS. Extend those cases; do not start a parallel harness.
- Required external behaviours:
  - Two Validators (or a Validator beside a Worker) on one worktree: the second begin is refused; no second child is registered.
  - A Worker begin while the Task is reviewing and a writable Delegation is still pending: refused.
  - A Worker begin while the Task is reviewing and no writable Delegation is live: allowed (Reviewer-only should not hold the lock).
  - Lost-notify Worker still executing, artifacts terminal: next same-Task begin consumes the finished run, then starts; it is not a hard lock refuse with two waiters.
  - Lost-notify Worker still executing, no terminal artifacts: next writable begin is refused; `blocked` remains allowed.
  - Reviewer PASS with matching revision but no bound snapshot, or with only a HEAD/status digest: Task does not complete.
  - Reviewer PASS after a new snapshot sample that does not match the bound digest: Task does not complete.
  - Reviewer PASS with a truncated packet: Task does not complete; `request_changes` still records.
  - Root `planner_verdict` PASS with a matching snapshot still completes (no regression of ticket 10’s Root path).
- Keep using temporary real Git repos where freshness or patch content is the claim, matching the evidence and snapshot suites.

## Out of Scope

- Re-implementing tickets that already match their acceptance tests: content-hash stale/unknown (02), tool restore (05), release skip≠pass (06), Root-side snapshot PASS (10’s `planner_verdict` path), blocked-escape and artifact consume at the verdict boundary (01).
- Host APIs that still do not exist (true child-process wait, tool-change provenance). “Known stopped” stays artifact/result/abandon based.
- Changing snapshot scope policy (allowed paths plus Git-reported changes) or introducing a new snapshot format.
- Composite `tasks`/`chain` execution, Reviewer rebinding a Task, treating an async receipt as a completion report.
- Rewriting triage labels on the already-closed hardening tickets.
- Vendor skill dumps under `.agents/`.

## Further Notes

- Hardening tickets 03, 07, 09, and 10 are the parents; this spec does not reopen 04’s patch generation, only the “truncated packet must not PASS” rule that landed as prompt text.
- Ticket 09’s implementation note (stale holder keeps blocking; operator exits are `blocked` or abandon) remains the timeout policy. This spec only insists the holder is the invocation, and that needs-reconcile text goes through the Task store.
- Ticket 05’s host limitation (no tool-change source) is unrelated and stays closed.
- If a later split into tickets is wanted: (A) invocation lock + reconcile-before-refuse, (B) Reviewer accept uses snapshot binding and refuses truncated PASS, (C) docs/store hygiene. A and B are independently demoable through the same Orchestration seam.

# The Root/child contract is typed data, never prompt text

Status: accepted 2026-09-16 (spike `.scratch/typed-delegation/issues/02`, `03`)

Root delegates to a child through a tool the plugin registers itself, with a
TypeBox schema for the TaskSpec; the child returns a WorkerReport through
pi-subagents' structured delegation API (`pi-subagents/delegation`,
`result: { kind: "structured", schema }`), schema-validated by the launcher.
Neither direction is ever recovered from free text: no JSON-candidate scanning
of a prompt, no regex for Task ids in prose, no keyword sniffing for
`reportOnly`, no "repair" of a report scraped from a transcript, and no
rewriting of another tool's prompt string in a `tool_call` hook.

## Why

Until 2026-09-15 the contract rode on the `subagent` tool's free-text `task`
argument. The plugin intercepted the LLM's call, guessed the TaskSpec out of
the string with three heuristics, bound the Task by regex, rewrote the prompt
into a packet in place, and re-parsed the packet downstream; the WorkerReport
was scraped the same way on the way back. That made the same TaskSpec exist in
five representations with two different precedence orders, and it made the
unit tests (which call the parser directly) exercise a different path from the
host (which goes through the rewrite). Tickets 28, 45, 47, 48, 52 and 53 in
`.scratch/planner-only-cost-control/issues/` are all instances of this one
fault; each fix changed a precondition of the previous one. The launcher we
depend on already states the rule we broke: "Text remains literal even when it
looks like JSON" and "Reviewer prose is never parsed."

## Considered options

- **Keep intercepting `subagent` and harden the parser.** Rejected: five days
  of doing exactly that produced tickets 45 to 53 without converging, and the
  test/host divergence is structural, not a missing case.
- **Own tool + structured delegation API** (chosen). The plugin already
  registers four TypeBox tools (`git_audit`, `git_commit`, `planner_recover`,
  `planner_verdict`) and pi-subagents >= 0.65 ships the API, so no new
  infrastructure is needed.
- **Own tool + RPC `spawn` (async).** Rejected after the spike. The
  structured API is foreground: the tool turn blocks for the child's whole run
  (60–317 s measured). We accept that on purpose. Root is a planner with
  nothing to do while a Worker runs, and the async design is what required the
  receipt-parking, `bg_wait` authorisation, notification parsing and output-file
  recovery machinery (`notify.ts`, `completion.ts`, `planner_recover`) that
  tickets 12, 35, 41 and the OUTPUT_* refusal family were all about. Known
  costs: one child at a time per Root session; a parent killed mid-delegation
  orphans the child (the CLI `-p` mode has no soft cancel); progress needs an
  explicit UPDATE-event subscription.

  *Runtime fact (worker-runaway-controller P0-A, 2026-09-16):* the delegation
  now runs **in-process** inside Root's AgentSession, so a killed parent takes
  the delegate down with it — no orphan child process (child-spawned shell
  commands may still orphan). Cancel is `planner_delegate`'s Esc → CANCEL →
  `cancelled` terminal within a 5 s grace; the grace overrun keeps the
  RESPONSE subscription for a late terminal and marks the execution
  `stop_unconfirmed` with a persisted writer hold instead of releasing the
  workspace unconditionally. The decision above stays as the record of why
  the async spawn design was rejected.

  *Runtime fact (P0-B, 2026-09-16):* an explicit per-delegation `envelope`
  (cumulative UPDATE tokens and/or wall clock, configured via
  `planner_delegate.envelope`, no defaults) drives the runaway monitor: a
  breach fires the same CANCEL path, records `endedReason: worker_runaway`,
  and flags `task.recovery.required`; re-execution then needs a structured
  RecoveryDecision (`planner_delegate.recovery` for retry_same_plan /
  fix_environment, `planner_verdict` blocked for abort) — each decision is
  consumed once and reworded duplicates are refused.

  *Superseded (2026-09-17, ADR-0003):* the abort entry is no longer
  `planner_verdict` blocked + `recovery`; it is the dedicated `planner_abort`
  tool. (ADR-0002 already moved `planner_delegate.recovery` to
  `planner_redelegate.recovery`.)

## Consequences

- `task.ts` `extractTaskSpec*` / `topLevelJsonCandidates`, `report.ts`
  `jsonCandidates` / `scanBalancedObjects` / `repair*`, `roles.ts`
  `TASK_ID_RE` binding, and `orchestrate.ts` `prepareRoleDelegation` become
  dead once the migration lands and are deleted, not kept as fallbacks.
- A Task is bound by the `taskId` argument of the tool call, or minted when the
  argument is absent; mentioning an id in prose binds nothing (run identity: see ADR-0004).
- Policy still guards the `subagent` tool, but only to refuse it for Root; it
  no longer reads the prompt.
- The plugin does not `import` from `pi-subagents/*`. That package exports raw
  `.ts` sources: consuming them drags its whole source graph into our `tsc`
  program (246 errors under our flags), and Node's `--experimental-strip-types`
  refuses to load `.ts` under `node_modules` at all, so our test runner could
  never import such a module. The event names and request/response shapes are
  copied into a local contract module with the upstream version noted; an
  acceptance check diffs the copied event names against the installed package.

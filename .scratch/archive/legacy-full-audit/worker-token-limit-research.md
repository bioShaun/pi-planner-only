# Worker token ceilings: source-based research

Research date: 2026-09-16. Repository HEAD: `6db47b094f58d228aea42cb93a209d953cdb81af` (working-tree source inspected). Installed primary host source: `pi-subagents@0.67.0`.

## Summary

1. **Current `planner_delegate` does not propagate floor budgets.** Its requests contain neither `toolBudget`, `usageBudget`, nor `timeoutMs`. The numbers in `floors.ts` are not evidence of effective worker ceilings.
2. **The host structured delegation API rejects `usageBudget`.** The separate model-facing/workflow API accepts it, but documented hard usage limits gate later child launches after reported usage reconciliation; they do not interrupt active children or reserve spend.
3. **UPDATE `tokens` is cumulative input + output, excluding cacheRead/cacheWrite.** The planner ledger's total includes both cache categories. These are different metrics and cannot share a threshold without an explicit definition.
4. **Turns are known internally and returned at termination, but absent from structured UPDATE.** Token snapshots are updated at assistant `message_end`, not continuously during generation, and unchanged progress heartbeats are coalesced.
5. **Runtime monitoring can request cancellation using the supported identity-scoped channel; it cannot promise mutation-safe interruption, an exact token ceiling, or complete accounting.** Native foreground children in this installed version are in-process sessions, not independently killable worker processes.
6. **Abnormal consumption is a useful reason to recheck decomposition, not proof that decomposition is wrong or that a model is weak.** A defensible policy needs comparable task/model baselines, cache-separated metrics, progress evidence, and interruption-aware outcomes.

## Scope and citation convention

Source/docs were inspected by a research subagent; the main agent additionally inspected selected ticket 10 artifacts as recorded below. No new model or host workload was executed. No implementation or ticket edits were performed. This is the single new research file.

`R:` means `/public/pi/pi-planner-only/`; `H:` means `/home/tcuni/.pi/agent/npm/node_modules/pi-subagents/`. Each citation below is a file relative to one of these absolute roots, with line numbers from the inspected files. Host version and upstream ownership: `H:package.json:1–4,24–28`. Primary upstream: <https://github.com/nicobailon/pi-subagents>. Installed sources are the authority for this report; upstream URLs below are navigation links and may change after this inspection.

Applicable instructions/context read: `R:AGENTS.md:1–13`, `R:docs/agents/domain.md:5–9,41–51`, `R:CONTEXT.md:3–26,29–46,57–73`, and `R:docs/adr/0001-typed-delegation-contract.md:1–65`.

## Verified facts

### 1. Actual planner budget propagation

- `planner_delegate`'s public parameters expose task, role, scope, constraints and validation, but no budget or timeout fields (`R:delegate.ts:73–102`). `index.ts` passes the host signal/update callback and the shared launcher directly into `runDelegation`; there is no budget-resolving wrapper in that tool execution path (`R:index.ts:754–789`; launcher creation at `R:index.ts:337`).
- Worker/explorer/validator requests are built explicitly with identity, selected role agent, rendered TaskSpec, fresh context, cwd and structured result schema. Reviewer requests are built analogously. Neither construction calls `resolveEffectiveLimits` nor includes tool/token/cost budgets or timeout (`R:delegate.ts:412–427,662–677`). The launcher emits the given request directly (`R:delegate.ts:919–975`).
- `floors.ts` defines bounded defaults of 20 tool calls, 40,000 tokens and $0.10; initial Worker defaults of 100,000 tokens and $0.50, with no default tool count; Reviewer has no default floor (`R:floors.ts:167–193`). Its resolver chooses minimum limits from applicable defaults/caller/TaskSpec/balance; correction classification uses `reportsCount > 0` (`R:floors.ts:427–554`). These remain definitions, not current typed-path enforcement.
- `HostEnforcement` defaults to false for tokens and cost; env flags are operator declarations. The comment about 0.66 accepting a parameter shape is explicitly historical and not verification of 0.67's structured API (`R:floors.ts:218–261`). Setting these flags does not add fields to `delegate.ts` requests or change host code.
- Exploration accounting in `floors.ts` returns notice strings; this helper itself does not block a host call or abort a child (`R:floors.ts:110–148`). Do not equate its inspection-call accounting with the host's all-tool-call budget counter.

### 2. Host usageBudget and toolBudget have different contracts

**Structured API:** `H:src/api/delegation.ts:26–43` includes `timeoutMs` and `toolBudget`, but no `usageBudget` or turn-limit field. This is enforced at runtime: a supported-field allowlist and unknown-field rejection reject `usageBudget` (`H:src/slash/delegation-request.ts:13–29,65–67`). The adapter forwards toolBudget/timeout and forces `async:false`, `foregroundOnly:true`, `clarify:false`, and `acceptance:false` (`H:src/slash/delegation-adapters.ts:286–305`). Thus adding a usageBudget property to the emitted request would not silently enable token enforcement.

**Separate reported-usage budget:** The model-facing tool documents `{ tokens?: {soft?, hard}, costUsd?: {soft?, hard} }`, with soft limits status-only and hard limits preventing subsequent launches, no reservations, and active children continuing (`H:docs/tool-reference.md:116–119`; `H:docs/workflows.md:99–101`). Source validation requires positive finite limits, soft ≤ hard, and at least one dimension (`H:src/runs/shared/usage-budget.ts:3–32`). Hard is reached at `used >= hard`; token used is `inputTokens + outputTokens`, unknown/missing totals default to zero (`same file:35–58`). The aggregation supplying those fields sums child `usage.input` and `usage.output` (and nested costs), not cache categories (`H:src/shared/utils.ts:367–389`). Workflow dispatch checks the reconciled state before launching another child (`H:src/runs/foreground/subagent-executor.ts:5618–5620,5885–5887`). Global usageBudget may be selected in the executor (`same file:6693–6694`); that does not make the structured request accept it or establish a running-child cutoff.

**Tool budget:**

- Default blocked set is `read`, `grep`, `find`, `ls`; `block:"*"` blocks all tool names. The counter advances for **every** child `tool_call`, not just the blocked names (`H:src/runs/shared/tool-budget.ts:3–9,55–58`; `H:src/runs/shared/subagent-prompt-runtime.ts:382–400`).
- Calls through count `hard` are permitted; matching calls with count **greater than** hard are blocked. At soft, a one-time steer message requests finalization. Blocking returns a tool error; it is not a session kill or limit on final assistant text (`same source ranges`; `H:docs/tool-reference.md:118`). A child can continue generating text or calling unblocked tools after hard.
- Structured delegation permits `hard:0`; ordinary configured budgets require at least one (`H:src/slash/delegation-request.ts:84–91`; `H:src/runs/shared/tool-budget.ts:11–36`).
- **Structured-report pitfall:** final structured delivery uses a real `structured_output` tool (`H:src/runs/shared/subagent-prompt-runtime.ts:404–419`). An exhausted `block:"*"` has no exemption for it in the blocker. A zero-tool leaf may produce text but cannot use that tool to deliver the WorkerReport required by this planner. Reserve/report design needs explicit consideration rather than assuming text-finalization guarantees apply.
- The host maps a detected blocked budget to `tool_budget_exhausted` (`H:src/slash/delegation-adapters.ts:331–344`). Planner parks that terminal status, cancellation and timeout as `blocked`; other non-completed statuses generally become `failed` (`R:delegate.ts:70–71,443–475`).

Official navigation: <https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md>, <https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md>, <https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md>.

### 3. UPDATE, cache accounting and turns

| Metric | Verified meaning / visibility |
|---|---|
| Native progress `tokens` → structured UPDATE `tokens` | Cumulative `usage.input + usage.output`; excludes both caches. Updated from assistant `message_end` usage. |
| Native progress `turnCount` | Incremented once per assistant `message_end`, even when that message has no usage. Not included in structured UPDATE. |
| Terminal `usage` | Input, output, cacheRead, cacheWrite, cost, turns, toolCalls and durationMs, when a child result supplies usage. |
| Planner ledger token total | Input + output + cacheRead + cacheWrite. Reasoning is retained separately but deliberately not added to avoid output double counting. |

Sources: `H:src/runs/foreground/execution.ts:1097–1123`; UPDATE projection `H:src/slash/delegation-adapters.ts:308–328`; terminal projection `same file:385–411`; host public types `H:src/api/delegation.ts:51–62,81–90`; planner totals `R:usage.ts:972–985,1120–1122`.

Additional verified details:

- Native progress also computes current input window as `u.input + u.cacheRead` and a window peak, but these are not exposed by the structured UPDATE projection (`H:src/runs/foreground/execution.ts:1111–1123`; adapter above). Token-throughput totals are not a context-window measurement.
- UPDATE events are **snapshots, not deltas**. Structured bridge coalesces updates whose visible progress/output is unchanged; a duration-only heartbeat is insufficient (`H:docs/extension-api.md:332–334`; `H:src/slash/prompt-template-bridge.ts:333–345`). A one-second internal timer exists, but does not guarantee one external update per second (`H:src/runs/foreground/execution.ts:1204–1213`).
- Planner forwards UPDATE tokens in progress details, but not in its progress text; it strips the upstream model field and has no turns field there. The hooks currently only render/forward progress; no threshold action or progress-ledger write is present (`R:delegate.ts:425–427,675–677,836–859`).
- Planner terminal normalization preserves finite `turns`; it retains token categories and adds `cacheWrite1h` to cacheWrite when supplied, while ignoring `totalTokens` as a fallback (`R:usage.ts:297–305,527–564`). Host structured usage does not include cacheWrite1h or reasoning (`H:src/api/delegation.ts:81–90`).
- The planner child ledger upserts by runId, else toolCallId, rather than adding duplicate run snapshots. It refuses to replace resolved entries with pending ones or with a lower-turn resolved snapshot (`R:usage.ts:566–570,743–785`). Simply summing raw ledger event rows would overcount snapshots.
- UI totals are not uniform: `renderUsageLine` computes its compact figures from input+output; detailed child rows omit cache and turns, even though stored values may contain both (`R:usage.ts:1158–1164,1210–1235`). A screen label alone cannot establish the token definition.

### 4. Timeout, cancellation and what “safe interruption” means

**Timeout exists at the host, but the planner does not supply an explicit one.** Host docs specify call-level timeout/maxRuntime, selected-agent defaults, global config, and a 30-minute native foreground fallback. Source defines `DEFAULT_FOREGROUND_TIMEOUT_MS = 30 * 60 * 1000` and resolves config/fallback (`H:src/runs/foreground/subagent-executor.ts:2733–2749,2777–2817,6800–6803`; `H:docs/configuration.md:258–264`). No claim is made here about the loaded agent/config value for a particular run. The structured API validates an integer timeout in `[1, 2147483647]` (`H:src/slash/delegation-request.ts:77–82`).

**Cancellation path is real and identity-scoped:**

1. `createHostLauncher` receives an AbortSignal. Aborting emits CANCEL with exactly `{requestId, ownerRunId, nodeId}`, retains RESPONSE subscription for a default 5 seconds, and then rejects with `DelegationAborted` if no response (`R:delegate.ts:919–975`). Shutdown can emit best-effort CANCEL for all registered in-flight attempts (`same file:890–906`).
2. Host requires those exact identity fields, rejects extra cancellation keys, aborts the matching controller, or remembers a pending cancellation (`H:src/slash/prompt-template-bridge.ts:158–172`). The controller signal is passed into execution; normal return is projected to cancelled if it was aborted. An execution throw yields cancelled/failed without usage in that catch response (`same file:329–373`).
3. For **native foreground Pi**, execution calls `session.abort()`; signal cancellation has a 3-second forced-settlement timer. Timeout marks timedOut, aborts, and has a 4-second forced-settlement timer (`H:src/runs/foreground/execution.ts:622–627,1216–1234,1302–1343`).
4. Finalization unsubscribes from session events and waits for session disposal before resolving. Session shutdown handlers have a default 5-second bound (`H:src/runs/foreground/execution.ts:783–806`; `H:src/runs/shared/child-session.ts:205–207,298–334`). Therefore the planner's 5-second grace is not guaranteed to encompass all host cancellation/cleanup paths. A late terminal can be dropped by launcher cleanup.

**Important runtime/context mismatch:** `H:src/runs/shared/child-session.ts:1–9,267–286,320–326` implements native foreground children as in-process `AgentSession`s, sharing a ModelRuntime; abort delegates to `session.abort()`. This conflicts with the literal process description in `R:CONTEXT.md:3,11–12` and the ADR's historical CLI orphan/soft-cancel statement (`R:docs/adr/0001-typed-delegation-contract.md:38–47`). The typed-contract architectural decision remains intact, but process/isolation/cancellation assumptions need reopening before relying on them. External CLI/job runners have separate paths; these native findings must not be generalized to every configured runner.

**Answer: can monitoring interrupt safely?**

- **Yes, as a supported best-effort cancellation request:** a nonblocking launcher hook can observe cumulative progress and trigger an owned AbortController, which uses the existing CANCEL/terminal pathway. This is a proposed use of an existing seam, not implemented behavior.
- **No, if “safely” means a mutation-safe checkpoint, rollback, exact billed-token cap, or confirmed termination of every side effect.** The cancellation code does not wait for a chosen edit/test boundary before aborting, and the bounded forced-settlement path is not proof arbitrary extension/tool work has ceased. `currentTool` is only a snapshot, not a lock protecting the next tool start. Provider-side work already in flight can outlive local observation.
- Official docs explicitly say timeout is not mutation-safe and recommend requesting a checkpoint after the current tool returns. They recommend narrow writer tasks with adequate outer timeouts, and discourage hard tool/tight usage caps for mutation-capable children (`H:docs/tool-reference.md:131–133`).
- Planner records usage on non-completed terminal responses when present, but a launch throw/no-terminal grace failure records no child usage in this path. Normal C_report capture and execution completion happen only after a completed response; worker reservation releases in `finally` even after cancellation/grace expiry (`R:delegate.ts:428–475,480–484,544–560,595–597`). Thus inspect/reconcile workspace state and establish quiescence before launching another writer; a `blocked` Task is not evidence of a clean checkpoint. This is especially important where grace expires before host disposal finishes.

## Measurement pitfalls and uncertainties

### Established pitfalls

1. **Cache mismatch:** an UPDATE threshold of 100k input+output is not the ledger's 100k all-category total. Repeated cached history can create large aggregate token totals with comparatively little fresh generation or cost. Conversely, excluding cache entirely conceals repeated-context work. Record both, with explicit labels.
2. **Sample latency:** latest UPDATE tokens represent completed assistant messages; one long in-flight response can overshoot before the monitor sees it. Coalescing means silence is not proof of a hung child. Missing turns cannot be reconstructed by counting UPDATE events or tools.
3. **No unique-information interpretation:** cumulative request input can count the same context many times. Token totals, context-window size, newly produced output and useful progress are different measures.
4. **Cost is not always measured spend:** planner accepts only positive reported cost, otherwise derives it from a pricing table; missing rates yield unknown. Known zero reported cost can therefore become a table estimate or unknown (`R:usage.ts:333–340,379–411,743–757`). Host budget state instead substitutes zero for absent cost totals (`H:src/runs/shared/usage-budget.ts:44–49`). Preserve the distinction between billed, provider-reported, estimated, zero and missing cost.
5. **Incomplete terminal accounting:** cancelled/failed attempts can carry usage, but bridge exceptions and planner grace expiry can lose it; partial provider responses may lack final usage. Do not treat absent usage as zero or compare only successful survivors.
6. **Turns and attribution:** host turns mean assistant-message completions, not user rounds or task review rounds. Planner exported run turns combine Root and all child turns, and missing child turns fall back to zero (`R:usage.ts:1290–1297`). Compare per-worker metrics before using task-wide totals to characterize workers.
7. **All-tools budget is not exploration budget:** host budget counter includes attempted tool calls and the report-submission tool; progress counter is driven by `tool_execution_start` (`H:src/runs/foreground/execution.ts:1060–1075`). Hook-blocked calls and provider batches need not align with one progress increment per budget attempt.

### Remaining uncertainty

- No paid runtime probe was performed. Installed source establishes implementation and documentation contracts, not which build/profile/runner was actually loaded in any historical run, nor cancellation reliability under a real stuck tool/provider.
- No attempt was made to infer the operator's effective model, thinking, tool defaults, global budgets or timeout from run artifacts/settings. Effective model/thinking should be taken from terminal response or independently verified launch provenance.
- This review establishes native foreground accounting. Provider normalization of input/cache/reasoning, retries and compaction coverage can vary; exhaustive provider-specific billing accuracy and external-runner behavior were not verified. A nominal package version alone does not prove files are pristine upstream; installed file citations identify the actual evidence inspected.
- There is no evidence in this source-only research that weaker models caused abnormal consumption, or that poor decomposition caused it. Threshold magnitudes and predictive value require the independent evidence work planned by the main agent.

## Recommendations (not implemented)

1. **Adopt the hypothesis as a review trigger:** “unexpected consumption with insufficient observable progress warrants rechecking the TaskSpec and model/task fit.” At review, distinguish a task too broad, missing context, unclear acceptance criteria, repeated failures, provider issues and an unsuitable worker model. Do not automatically split a task merely because it is expensive.
2. **Define the metric before choosing a ceiling:** track uncached input, output, cacheRead, cacheWrite, all-category total, reported/estimated cost, assistant turns, tool attempts, wall time and validated progress separately. Match role, model, thinking, scope and cache state in comparisons. Use task-local and cumulative retry/review spend alongside per-attempt consumption.
3. **Prefer staged action:** a soft anomaly threshold requests a bounded checkpoint/partial report after current tool completion; Root rechecks decomposition and chooses narrower scope, missing-context repair, escalation, or continuation. A hard emergency stop remains a cancellation with possible partial edits and accounting gaps, not a guaranteed successful handoff.
4. **Do not wire `usageBudget` into structured requests or label floors enforced.** Any future implementation needs an explicit supported transport/monitoring contract and tests of actual propagation. Current UPDATE alone cannot enforce a cache-inclusive cap or live turn ceiling; those require host telemetry changes or another authoritative measurement surface.
5. **For read-only roles**, a host tool budget is a more direct supported bound on selected tool calls, with the report-delivery pitfall considered. **For Workers**, use narrow deliverable slices and checkpoint-aware supervision rather than an arbitrary all-tools kill budget. An explicit outer timeout remains a backstop, not a safe editing boundary.
6. **Verify cancellation without spending money first:** scripted child/session fakes should cover identity mismatch, coalesced/repeated snapshots, cache-only growth, missing usage, report-tool exhaustion, late terminal cleanup and grace expiry while a tool ignores abort. Any eventual real-host acceptance run must separately verify loaded provenance, actual stop/cleanup, workspace evidence and terminal accounting before claiming a hard worker ceiling.

The recommended posture is consistent with the ADR's typed contract: signals and decisions should cross an explicit data channel, not be inferred by parsing Worker prose. No code or ticket changes are part of this research.

## Ticket 10 evidence cross-check and decision

The main agent inspected `R:.scratch/typed-delegation/host-10/29c-n1-usage.txt:1–3`: the first worker reports input 185,690, output 4,022, cacheRead 4,081 and 22 turns; correction reports input 1,215,987, output 14,941, cacheRead 6,115,007 and 61 turns. Both identify the same model/thinking. Correction input is about 6.55 times its own first attempt, rather than 15 times; the roughly 15-times figure compares against the separate approximately 80k P1 run. These rows are cumulative snapshots and must not be summed.

Crucially, `R:.scratch/typed-delegation/host-10/22c-n1-worker2.json:57–59` already specifies the exact missing assertion, two allowed paths, explicit validation command `node src/greet.test.js`, and per-attempt changedFiles semantics. The expensive correction therefore does not establish that missing explicit validation or an overly broad objective caused the consumption. It also does not rule out excess context in the rendered child prompt or child-side loops; those require the actual child trajectory. The instruction to call only one tool in the initiating user message addresses Root, not the child (`same file:4`).

Ticket 10's handback records evidence-hash-induced revalidation loops, changedFiles declaration mismatches, an objective/scope conflict taking 947 seconds without a report, and P1's 31-to-15 call improvement alongside packet changes (`R:.scratch/typed-delegation/10-handback.md:7–12,29,40–44`). These are plausible distinct sources of wasted work. The handback is a secondary summary of local experiments; it does not prove which mechanism caused the 61-turn child.

**Recommended decision:** treat abnormal consumption as a bounded-attempt review trigger, not an automatic decomposition verdict. A simple initial design should observe well-defined UPDATE tokens and elapsed time, apply a configurable emergency cancellation threshold, and return a typed anomaly plus workspace/termination evidence to Root. Root must diagnose task ambiguity/scope, environment/tool loops, reporting protocol problems, and model/task mismatch before retrying. Narrow or clarify when warranted; escalate the model when an already clear and small task repeatedly fails. Avoid infinite splitting and identical retries. Add cooperative checkpoints only after verifying an actual supported steering/checkpoint contract; current UPDATE+CANCEL does not provide one.

Before choosing numerical defaults, inspect the expensive child's tool/message trajectory, then compare repeated matched runs changing one factor at a time (packet/context vs worker model), measuring accepted completion, total attempts, aggregate consumption and wall time. Existing observations justify a backstop but not a statistically calibrated threshold or the assertion that model capability is irrelevant.

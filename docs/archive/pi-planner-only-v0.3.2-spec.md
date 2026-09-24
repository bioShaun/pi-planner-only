# pi-planner-only v0.3.2 Spec — Compress Re-read Input

> Scope: `bioShaun/pi-planner-only` after `16c4ece` (v0.3.1 plus the five
> re-measurement follow-ups). Target host remains Pi 0.85.x with
> pi-subagents 0.65.x. Governing evidence:
> `.handoff/closeout-0.3.1.md`, `.handoff/baseline/README.md` §0.3.1,
> and `.handoff/R15-t6-input-bytes.{py,json}`.

## Status

Draft, 2026-09-05. Authored by the Planner seat. Items are ordered by measured
impact and must execute in that order. Do not renumber I-1 or I-2.

## 1. Summary and priority

v0.3.1 reached the turn target on T6: 9 Root turns, `completed`, no correction
or validator run. The remaining Root cost is therefore mostly the cost of
re-reading the same context, not lifecycle failure. v0.3.2 opens **injection
compression first**:

1. **I-1:** shrink the two extension-controlled inputs repeated across Root
   requests: `PLANNER_PROMPT` and the Root-facing worker result.
2. **I-2:** add a reactive one-line JSON reminder only after a worker's first
   prose-only report strike.

A fresh reviewer default remains secondary. T6 used 1–2 review turns for direct
inspection, while extension-controlled text was present across most or all 9
turns. v0.3.2 does not change the default review mode.

## 2. T6 input-byte measurement

The T6 session is the `sessionFile` from the last line of
`~/.pi/agent/planner-only/usage.jsonl`:

`/home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/2026-09-05T09-59-38-741Z_01a07102-69f5-74e2-846c-de55ca1f372c.jsonl`

### 2.1 Boundary

For each of the nine `root-turn` records attributed to `T-20260905-001`, measure
the text present immediately before the assistant message paired with that
`message_end` ledger record. The ledger record itself occurs after the
assistant's tool results and is therefore an attribution marker, not a request
boundary:

- **PLANNER_PROMPT:** UTF-8 bytes of the `index.ts` template literal, once per
  request.
- **Injected text:** cumulative UTF-8 bytes from earlier `kind=injected` ledger
  entries. A tool result identified by that ledger entry belongs here and is
  not counted again.
- **Tool results:** cumulative UTF-8 bytes of prior ordinary
  `message.role=toolResult` text payloads.

This is a reproducible text-payload metric, not the provider's serialized prompt
size. It deliberately excludes the host/base system prompt, user and assistant
prose, tool schemas, JSON framing, and tokenisation. It also does not infer
content from cache token counts. The session does not contain the system prompt,
so the 2,399 B `PLANNER_PROMPT` value is provenance-backed by `git show
299a593:index.ts` plus the constants in `299a593:types.ts`; the JSONL alone
cannot prove which installed prompt was sent.

### 2.2 Results

| T6 Root turn | PLANNER_PROMPT | Injected text | Tool results | Three-part total |
|---:|---:|---:|---:|---:|
| 1 | 2,399 B | 0 B | 17,590 B | 19,989 B |
| 2 | 2,399 B | 0 B | 17,697 B | 20,096 B |
| 3 | 2,399 B | 3,567 B | 17,855 B | 23,821 B |
| 4 | 2,399 B | 3,567 B | 18,402 B | 24,368 B |
| 5 | 2,399 B | 3,567 B | 20,620 B | 26,586 B |
| 6 | 2,399 B | 3,567 B | 20,761 B | 26,727 B |
| 7 | 2,399 B | 3,567 B | 23,580 B | 29,546 B |
| 8 | 2,399 B | 3,567 B | 24,815 B | 30,781 B |
| 9 | 2,399 B | 3,567 B | 25,169 B | 31,135 B |
| **Exposure sum** | **21,591 B** | **24,969 B** | **186,489 B** | **233,049 B** |

The 3,567-byte injected worker result splits into 860 B of decision/repair
text, 1,289 B of rendered WorkerReport, and a 1,418 B reviewer-template
section. The reviewer template is dead weight in Root's normal path:
`prepareRoleDelegation` builds the bounded fresh-review packet from stored Task
state when Root actually delegates a reviewer.

Tool results are the largest historical component, but Pi owns their retention
and compaction. I-1 targets the 46,560 B of extension-controlled exposure
(prompt plus injected text) without pretending to reduce the 186,489 B host
component.

## 3. I-1 — Compress extension-controlled Root input

### 3.1 `PLANNER_PROMPT`

Rewrite, do not weaken, the prompt. Its UTF-8 size must be **≤ 1,800 bytes**
(`Buffer.byteLength(PLANNER_PROMPT, "utf8")`), replacing the old character-only
2,500 bound.

The compressed prompt must still state all of these contracts:

1. Root may plan, delegate, read, review, and arbitrate, but may not edit/write,
   run a general shell, or implement fixes.
2. Executable work uses one bounded TaskSpec embedded in one direct subagent
   call; use the canonical id returned by the extension.
3. A worker returns WorkerReport version 1 with identity, status, summary,
   changed files, validation plus exit codes, evidence, risks, and unresolved
   items.
4. Before acceptance Root checks identity, freshness, relevant files/git,
   acceptance criteria, then calls `planner_verdict`.
5. Reviewer/validator role remapping, fresh reviewer context, and the ban on
   pre-composed worker→reviewer workflows remain explicit.
6. Root uses `git_audit`, never trusts worker PASS, never accepts stale
   evidence, delegates corrections instead of fixing, and stops after the
   review-round limit.
7. No Root-facing slash command is introduced.

Tests assert each contract by stable phrase or semantic fragment and assert the
UTF-8 byte bound. They must not lock the complete prompt as one snapshot.

### 3.2 Worker result shown to Root

On an accepted WorkerReport, `handleWorkerResult` keeps:

- the decision block and optional `Report normalised:` line;
- the compacted report's task id, status, summary, complete changed-file list,
  validation status/command/exit code/summary, evidence label, and non-empty
  risks or unresolved items;
- the existing compaction notice when compaction occurred.

It removes these lines from the Root-facing result:

- `Reviewer prompt template for an isolated fresh review:`
- the full `reviewerPrompt(task.taskId)` body.

The stored WorkerReport is unchanged. `buildFreshReviewerTask` and
`prepareRoleDelegation` remain the only source of the full reviewer prompt when
a reviewer is actually launched. Invalid worker output, validator output,
reviewer output, Task transitions, evidence comparison, and verdict semantics
do not change.

For a fixture matching T6's accepted report and repair list, the entire initial
worker-result text must be **≤ 2,300 UTF-8 bytes** and contain no reviewer
template. The measured pre-change fixture is 3,567 B; removing the 1,418 B
template yields 2,149 B without dropping review evidence.

### 3.3 Replay target

The script defaults to T6's runtime ref `299a593`, so the §2 baseline remains
reproducible after source changes. `--ref HEAD --session <fixture.jsonl>` selects
the new prompt and a synthetic T6-shaped session carrying the new worker-result
fixture:

- prompt exposure across 9 turns: ≤ 16,200 B;
- injected worker-result exposure across the following 7 turns: ≤ 16,100 B;
- combined extension-controlled exposure: **≤ 32,300 B**, at least 30% below
  T6's measured 46,560 B;
- tool-result bytes are reported separately and are not credited as an I-1
  saving.

## 4. I-2 — Reactive JSON reminder after one prose strike

T5's first worker output contained no JSON at all, so normalisation could not
run. Do not add a schema block to every worker prompt. Change only the first
report-correction response whose extraction error is
`worker output did not contain a WorkerReport object`.

Immediately after the existing report-only correction instruction, append this
single line with the Task's canonical id substituted for `<id>`:

```text
JSON only: {"version":1,"taskId":"<id>","status":"completed|partial|blocked|failed","summary":"...","changedFiles":[],"validation":[],"evidence":{"taskId":"<id>"},"risks":[],"unresolved":[]}
```

Rules:

- emit it only for the first prose-only strike;
- do not emit it for empty output, parseable-but-invalid JSON, identity
  rejection, an already exhausted correction, validator output, or reviewer
  output;
- do not change `MAX_REPORT_CORRECTIONS`, normalisation, transitions, or the
  existing correction sentence;
- record its actual bytes through the existing injected-text ledger.

Tests cover the positive case and every excluded branch above. A valid JSON
report following the reminder is accepted through the existing normaliser in
one pass.

## 5. Explicit non-goals

- Fresh reviewer as the default or a model-selection change.
- Worker JSON schema on every launch.
- Host/Pi conversation compaction or tool-result rewriting.
- Changes to pi-subagents, including the immediate `bg_wait({all:true})` race.
- Task persistence, write locks, worktree lanes, or leaked interrupted-test
  directories.
- Reopening WorkerReport schema decisions already closed in v0.3.1.

## 6. Execution rounds

One writer at a time in the repository. The spec is read-only for executors.

| Handoff | Executor | Scope | Acceptance |
|---|---|---|---|
| R15 | Planner; cursor audit cancelled | T6 measurement and this spec | script reproduces nine rows; spec records boundary and targets |
| R16 | `cursor=w2E:pA` | I-1: `index.ts`, `orchestrate.ts`, focused tests | `npm test`; `npm run typecheck`; byte fixtures meet §3 |
| R17 | `agy=w2E:pB` | I-2: orchestration/report-correction path and focused tests | `npm test`; `npm run typecheck`; §4 branch matrix |
| R18 | `agy=w2E:pB` | release notes, README if behaviour text changed, version 0.3.2 | full acceptance ledger; no real pricing rates |

Each handoff starts with `.handoff/R15-` or later, is dispatched by pairctl,
names `w2E:p7` as the return pane, forbids commit/push unless separately
authorized, and carries the full report contract. The Planner reads every diff
and runs acceptance independently before accepting a round.

## 7. Acceptance ledger

Before release, mark every row pass/fail/not-run:

| Item | Required evidence |
|---|---|
| M-1 measurement | R15 script reproduces all nine §2 rows and four exposure sums from the T6 sessionFile |
| I-1 prompt | `Buffer.byteLength(PLANNER_PROMPT, "utf8") ≤ 1,800`; seven §3.1 contracts covered |
| I-1 worker result | T6 fixture ≤ 2,300 B; no reviewer template; required evidence fields retained |
| I-1 reviewer path | fresh reviewer delegation still receives the full generated reviewer packet |
| I-1 replay | extension-controlled exposure ≤ 32,300 B and tool results reported separately |
| I-2 reminder | exact one-line JSON reminder on first prose-only strike; excluded-branch matrix green |
| Regression | `npm test` exit 0; `npm run typecheck` exit 0 |
| Host integration | `npm run test:e2e` exit 0, or loud skip under its documented missing-host condition |
| Real Tasks | two bounded real Tasks, Root ≤ 9 turns each, both close `completed` on implementation id, zero `over-reported` on correct diffs |
| Release | version 0.3.2; CHANGELOG includes the five post-0.3.1 commits and I-1/I-2; installed-copy naming check green after authorized push/update |

The real-Task rows cannot be replaced by synthetic tests. Any not-run row stays
open and is stated in the release/PR description.

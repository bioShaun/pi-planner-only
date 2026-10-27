# Offline baseline execution

Date: 2026-10-26. Scope: optimization plan step 1 only. No commits.

## Inputs and implementation

- Analysis checkout HEAD: `6e2c95a091fd0eb17e0ec3b8915affcebc3c29ab`.
- Existing step 0 changes were present and preserved. No plugin runtime, prompt,
  dependency, global configuration, or historical session file was changed.
- Source directory:
  `/home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--`.
- Enumerated all 51 top-level JSONL files, dated September 24 through October 11.
  Of these, 24 contain 155 delegate calls. The other 27 remain in the output
  inventory, with their own source hashes and usage.
- Matched all 155 calls to one result each using `toolCallId`.
- Matched 149 usage-bearing calls to 149 unique nested child sessions using full
  task, cwd, and the observed call/result interval. No child was counted twice.
  The five refused calls and one model-registry failure have no child usage.
- The old `subagent-artifacts/*_meta.json` files were absent in this directory;
  nested `run-0/session.jsonl` files provided the original child evidence.
- Initial pairing found 143 children. Inspection of the remaining six showed
  trailing newlines in Root tasks that the host trims. Matching now trims only
  task boundary whitespace before comparing the complete task and host footer;
  it does not use fuzzy text, filename similarity, or next-run heuristics.
- Historical host/plugin/subagents load versions remain unknown. Current Pi
  1.4.0 is the verification environment, not a historical sample label.
- `analyze.mjs` is a read-only, dependency-free analysis script. It emits one
  deterministic JSON document. The report preserves each session separately,
  with model/thinking changes, visible configuration fingerprints, intervals,
  calls, result lines, usage coverage and candidate failure successors.
- Logged cost is preserved as logged. Actual invoice billing is unknown.

## Resource preflight

Ran `slot audit` and `slot status` before starting the release suite. Complete
output is in [resource-preflight.md](resource-preflight.md).

Audit found no heavy process bypassing slot. Status reported 46.5G used /
64.0G soft / 76.0G hard, swap limit 0.0G, and 529 processes; displayed job
entries were finished. Release checks ran through `slot cpu`, with
`TMPDIR=/project/tmp`. Analysis involved local bounded logs, not bulk `/data_0`
I/O. No temporary files were placed in `/tmp`.

## Verification

Commands run from the repository root:

```bash
TMPDIR=/project/tmp node --test .scratch/offline-baseline/analyze.test.mjs

TMPDIR=/project/tmp PI_SUBAGENTS_DIR=/project/tmp/pi-planner-host-1.4-contract-20261026/node_modules/pi-subagents slot cpu -- npm run test:release

node .scratch/offline-baseline/analyze.mjs /home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only-- | sha256sum
```

The analysis tests exited 0:

```text
parallel intervals retain overlap instead of adding wall time: passed
parallel calls join out-of-order results by toolCallId: passed
missing or duplicated terminals stay unknown and do not fabricate a gap: passed
handoff gaps exclude intervening user messages: passed
tests 4; pass 4; fail 0; cancelled 0; skipped 0
```

The release command exited 0. Typecheck and all suites passed:

```text
contract.test: ok
git.test: ok
delegate.test: ok
host.test: ok
host-runtime.test: host declarations and installed types aligned at 1.4.0
host-runtime: tests 5; pass 5; fail 0; cancelled 0; skipped 0
handoff.test: ok
status-color.test: ok
index.test: ok
```

This reuses step 0's isolated same-package `PI_SUBAGENTS_DIR` fixture because
the operator's global source installation lacks its optional pi-ai peer.
The global installation remains unchanged. The host-runtime suite uses the
real project Pi 1.4.0 runtime with controlled model/delegation peers; this
step did not rerun a paid model or claim full subprocess reliability.

The CLI analysis separately exited 0 with empty stderr. Its output was
byte-for-byte identical to the saved baseline serialization:

```text
bytes: 805004
sha256: 611aef983d2d255765bf05e12dc57ab2b4fe72fd6c8729f1cdfed02bd5e16258
```

Additional assertions on the actual source corpus passed:

- 51 Root files, 24 delegate-bearing sessions, 155 unique call/result pairs.
- 149 distinct paired child files, no orphan child files in the selected roots.
- All 149 child token totals exactly equal their Root delegate usage totals.
- All 149 child cost totals agree within 1e-8 dollars.
- Missing usage is explicit for all five refusals and the model-registry failure.

Language-server diagnostics reported no errors on both analysis JavaScript files.
The four synthetic tests exercise machine-consumed values and event ordering;
no prose snapshots or existing test changes were introduced.

## Acceptance and boundaries

Step 1 is complete as a historical discovery baseline, with the explicit
unknowns required by the plan. The report, script and machine evidence are
retained in the workspace. Sources are identified by absolute path and full
SHA-256; they are not copied wholesale into the repository.

The 19 timeouts are separated into 16 model replay runs, one deliberate timeout
probe and two ordinary plugin worker runs. Five same-goal re-delegations after
refusal/cancellation were manually checked, costing 1,572,399 tokens and
$0.04074094 in logged usage. This is not a savings estimate.

The 77 observable handoff gaps include tools and waiting; the longest includes
historical benchmark sleep commands. They are not pure Root thinking.
Version gaps, missing billing, unobserved shell-launched models and unlabelled
business rework remain explicit limitations rather than zero-valued measurements.
No controlled performance benefit is claimed.

The next plan step is step 2 (prompt and delegate-description changes), which
was not started.

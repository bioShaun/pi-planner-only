# Host 1.4.0 alignment execution

Date: 2026-10-26. Scope: step 0 of the optimization plan only. No commits.

## Initial state

- Working tree contained only the three untracked research/plan documents from this session.
- Both host declarations: `>=0.84 <1`; development dependency: `*`; lockfile host: 0.84.4.
- Actual operator installation: Pi 1.4.0.
- Existing contract suite checks pi-subagents, not the installed host runtime.

## Resource preflight

Before starting dependency installation, ran `slot audit` and `slot status`.

`slot audit` output:

```text
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
```

`slot status` resource header:

```text
内存 13.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 162   CPU权重 50
```

The displayed cpu job rows were finished. Dependency installation will use `slot cpu`.
Temporary files use `/project/tmp`, not `/tmp`.

## Red evidence

`TMPDIR=/project/tmp node --experimental-strip-types host-runtime.test.mjs`
exited 1 before changing the manifest or installing dependencies:

```text
AssertionError [ERR_ASSERTION]: host runtime tests require the target Pi 1.4.0 installation
actual: '0.84.4'
expected: '1.4.0'
```

The supported host and development dependency will both be exactly 1.4.0.
Node's minimum becomes 22.19.0 to match that host. No untested compatibility
with 0.84 or later host versions is claimed.

## Installation and preliminary verification

- `TMPDIR=/project/tmp slot cpu -- npm install --no-audit --no-fund`: exit 0;
  added 106 packages, removed 126, changed 2 in 25 seconds.
- `TMPDIR=/project/tmp npm run typecheck`: exit 0 against Pi 1.4.0.
- First runtime suite: 3 tests passed using the actual host SDK and extension loader.
  Provider output and the structured-delegation protocol peer are controlled fixtures;
  this is not a paid-model or full pi-subagents child-launch test.
- Added a conflicting writer batch case and strengthened duplicate-terminal coverage
  so a stale terminal is delivered while the next worker holds the lock.

## Release verification resource preflight

Ran `slot audit` and `slot status` again before the release run.

```text
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。

=== heavy.slice 资源用量 ===
内存 50.7G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 201   CPU权重 50
```

All displayed queue entries were finished. The release suite will run through
`slot cpu`, with `TMPDIR=/project/tmp`.

## Verification failures and recovery

The conflicting-batch probe initially observed zero requests when the refusal
arrived: lock acquisition precedes asynchronous Git capture and request emission.
The assertion now subscribes to both refusal and the first request before checking
the launched-child count. No sleep or scheduling assumption is used.

The first release run stopped in the existing contract test with:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@earendil-works/pi-ai'
imported from /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/shared/provider-diagnostics.js
```

The global pi-subagents installation is 0.81.0 and declares pi-ai >=1.2.0 as an
optional peer. Its source tests need that peer even though the bundled extension
can load in Pi. To keep the operator installation untouched, install a packed copy
of that exact local package alongside Pi 1.4.0 under
`/project/tmp/pi-planner-host-1.4-contract-20261026`, using `npm install --install-links`.
The existing `PI_SUBAGENTS_DIR` override will select this fixture. Contract
assertions and default lookup behavior are unchanged.

Before the fixture installation, reran `slot audit` and `slot status`.
Audit found no heavy process bypassing slot. Status reported 54.8G used,
64.0G soft limit, 76.0G hard limit, swap limit 0.0G, and 210 processes.
The fixture installation runs through `slot cpu` with `TMPDIR=/project/tmp`.

The fixture installation exited 0 (124 packages in 20 seconds). It is a packed
copy of the operator's installed pi-subagents 0.81.0, not a replacement global
installation. The corrected four-test suite passed on the operator's actual
Pi 1.4.0 installation. A final coverage check added progress forwarding and
confirmed cancellation, and changed fixture terminal values to the contract's
`cancelled` status.

Before the final release run, `slot audit` again reported no bypassing heavy
process; `slot status` reported 57.1G used / 64.0G soft / 76.0G hard,
0.0G swap limit, 231 processes, with displayed queue entries finished.

## Final acceptance

Step 0 is complete. Both host declarations, the development dependency, and the
lockfile now target exactly Pi 1.4.0; the Node engine minimum is >=22.19.0.
Both READMEs state this support scope. No plugin runtime logic or prompt changed.

Verified byte-for-byte equality of these nine fixture files against the operator
installation: `src/api/delegation.js`, `src/slash/delegation-request.js`,
`src/slash/delegation-adapters.js`, `src/shared/artifacts.js`,
`src/shared/provider-diagnostics.js`, and the worker/scout/oracle/reviewer agent
definitions.

Commands run from the repository root:

```bash
TMPDIR=/project/tmp PI_SUBAGENTS_DIR=/project/tmp/pi-planner-host-1.4-contract-20261026/node_modules/pi-subagents slot cpu -- npm run test:release

TMPDIR=/project/tmp PI_HOST_DIR=/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent node --experimental-strip-types host-runtime.test.mjs
```

Both commands exited 0. The release command passed typecheck and all suites:
contract, git, delegate, host, host-runtime, handoff, status-color, and index.
The new runtime suite passed 5 tests, with 0 failed, cancelled, or skipped, on
both the project dependency and the operator's actual installation:

| Probe | Observed contract |
| --- | --- |
| Independent explorers | Both requests launch before either is released; tool-end events follow completion order while result messages follow assistant call order. |
| Conflicting writer batch | Exactly one child launches; the other call returns `refused`. |
| Progress and confirmed cancellation | Updates reach the host tool event stream; session abort reaches delegate; a `cancelled` terminal releases the lock. |
| Unconfirmed cancellation and late/duplicate terminals | `stop_unconfirmed` retains the lock; a late terminal releases it; a duplicate old terminal cannot release the next worker's lock. |
| Final event and idle | `agent_end` listeners may still be running; the agent becomes idle only after they settle. |

Language-server diagnostics on the final runtime test reported no errors.
The version guard's initial failure is recorded above; no existing test assertions
were deleted, weakened, or skipped.

### Evidence limits and reproducibility

- This is a real-host offline integration test, including actual loading of
  `index.ts`. Provider output and the structured-delegation peer are fixtures;
  it does not establish paid-provider reliability or subprocess termination
  behavior in a complete pi-subagents child run.
- The existing global pi-subagents source installation still lacks a directly
  resolvable optional `pi-ai` peer. A bare release command against that directory
  can therefore fail. Use the recorded `PI_SUBAGENTS_DIR` override; its fixture
  manifest is retained at `/project/tmp/pi-planner-host-1.4-contract-20261026/package.json`.
  This environment issue was isolated without modifying the global installation.
- The tests use event subscriptions with bounded test timeouts. The cancellation
  grace timer is itself the behavior under test; there are no fixed sleeps.
- Existing local fault-injection tests also passed. No compatibility with other
  Pi versions is claimed; no new runtime version guard was added.
- No commits, offline baseline, prompt changes, check v1, telemetry, thinking
  experiment, report references, or parallel writing were performed.

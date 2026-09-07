# Code Context — planner-only plugin scout

## Files Retrieved
1. `index.ts` (lines 898–930) — `/planner-only status` action implementation (default action).
2. `roles.ts` (lines 51–53) — `oracleSuiteMode()` helper (env → `bounded`/`full`).
3. `index.test.mjs` (status tests at lines 400–482 RF-4, 596–605, 1696–1708; usage-log status test ~1696) — status action test coverage.
4. `roles.test.mjs` (lines 318–321) — existing `oracleSuiteMode` unit tests.

## Git
- HEAD branch: `phase-a-08-rerun-4`

## Key Code

### `index.ts` — status action (lines 904–921)
```ts
if (action === "status") {
    const log = usageLogPath();
    const logStatus = log ? `${log} (enabled)` : "disabled";
    const lines = [
        `Planner-only mode is ${isDisabled() ? "off" : "on"} (source: ${guardDecisionSource()}).`,
    ];
    const forcing = envForcingValue();
    if (forcing !== undefined) {
        lines.push(`Environment: PI_PLANNER_ONLY=${forcing} forces planner-only ${envForcesGuard() ? "on" : "off"}.`);
    } else if (existsSync(OFF_MARKER)) {
        lines.push(`Marker: ${OFF_MARKER}`);
    }
    lines.push(`Usage log: ${logStatus}`);
    notify(ctx, lines.join("\n"));
    return;
}
```
Note: no `Oracle suite:` line yet — that's the ticket (`.scratch/oracle-status-line/issues/01-status-oracle-suite.md`). Requires importing `oracleSuiteMode` from `./roles.ts`.

### `roles.ts` — oracleSuiteMode (lines 51–53)
```ts
export function oracleSuiteMode(env: NodeJS.ProcessEnv = process.env): "bounded" | "full" {
	return (env.PI_PLANNER_ONLY_ORACLE ?? "").trim().toLowerCase() === "full" ? "full" : "bounded";
}
```
Also used at `roles.ts:284` (`oracleMode: options.oracleMode ?? oracleSuiteMode()`).

## Architecture
- `index.ts` registers the `planner-only` pi command; default action is `status`. Helpers `usageLogPath()`, `isDisabled()`, `guardDecisionSource()`, `envForcingValue()`, `notify()` are defined in `index.ts` (notify around line 886–896, sends `planner-only-notice`).
- `roles.ts` is the shared helper module (agent roles, contract wrapping, oracle mode) imported by `index.ts` and tested by `roles.test.mjs`.
- Issue spec: `.scratch/oracle-status-line/issues/01-status-oracle-suite.md` — add `Oracle suite: ${oracleSuiteMode()}` line and tests near current status assertions in `index.test.mjs` (~line 1696).

## Start Here
`index.ts` around lines 898–921 (status action) plus `roles.ts:51` — then extend `index.test.mjs` near line 1696.
# Code Context

## Files Retrieved
1. `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2/index.ts` (lines 899-920) — `/planner-only` command registration and the `status` action handler.
2. `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2/roles.ts` (lines 50-52) — `oracleSuiteMode()` definition.
3. `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2/index.test.mjs` (lines 400-482, 570-610) — RF-4 and T04/headless status test assertions. Other status assertions: lines 707-709, 860.

## Current git branch
`phase-a-08-rerun-2`

## Key Code

### `oracleSuiteMode()` — roles.ts:50-52
```ts
export function oracleSuiteMode(env: NodeJS.ProcessEnv = process.env): "bounded" | "full" {
	return (env.PI_PLANNER_ONLY_ORACLE ?? "").trim().toLowerCase() === "full" ? "full" : "bounded";
}
```
Note: case-insensitive — `"FULL"` also maps to `"full"` (tested at roles.test.mjs:320). Used at roles.ts:284 as default for `options.oracleMode`.

### Status action — index.ts:899-920
```ts
pi.registerCommand("planner-only", {
	description: "Show, enable, or temporarily disable planner-only mode; inspect task lifecycle",
	handler: async (args, ctx) => {
		const parts = args.trim().split(/\s+/).filter(Boolean);
		const action = (parts[0] ?? "status").toLowerCase();
		const store = orchestrator.store;

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
Related helpers/constants: `OFF_MARKER` (index.ts:34, `<AGENT_DIR>/planner-only.off`), `guardDecisionSource()`, `envForcingValue()`, `envForcesGuard()`, `envDisablesGuard()`, `usageLogPath()` (index.ts:280). Output via `notify(ctx, ...)`, which routes to `ui.notify` in headed mode or a `planner-only-notice` custom message headless (index.ts:895).

### Status test assertions — index.test.mjs
RF-4 (lines 400-482, spawned child probe):
- line 446-447: `await d1.commands.get("planner-only").handler("status", ctx1);` then `assert.match(notices1.at(-1), /Planner-only mode is on \(source: env\)/);`
- line 457-458: D2 — `assert.match(notices2.at(-1), /Planner-only mode is off \(source: marker\)/);`
- line 468-469: D3 — `assert.match(notices3.at(-1), /Planner-only mode is on \(source: default\)/);`
- line 481-482: `assert.equal(rf4Probe.status, 0, ...)` and `assert.match(rf4Probe.stdout, /planner-only rf4: PASS/);`

T04/headless (lines ~596-605, inside a second spawned probe):
- line 597: `await commands.get("planner-only").handler("status", ctx);` → `assert.match(sent.at(-1).content, /Planner-only mode is off \(source: env\)/);` and `assert.match(sent.at(-1).content, /PI_PLANNER_ONLY=0 forces planner-only off/);`
- marker case: `assert.match(sent.at(-1).content, /Planner-only mode is off \(source: marker\)/);` plus `assert.ok(existsSync(markerPath));`

Also: line 709 asserts canonical task id printed in status render (`/status must print a canonical task id/`); line 860 asserts task status prints canonical holder id. Oracle-mode tests live in `roles.test.mjs:318-321`.

## Architecture
- `index.ts` is the pi plugin entry: registers the `/planner-only` command, `session_start` handler, tool restriction guard, and usage logging. Status sources are resolved via `guardDecisionSource()` between env var `PI_PLANNER_ONLY`, the `planner-only.off` marker file, and the default-on guard.
- `roles.ts` exports role inference, contract markers, `oracleSuiteMode()`, and `wrapWorkerContract`/`wrapOracleContract` used by the orchestrator's delegation flow (`roles.ts:284` defaults oracle mode from env).
- `index.test.mjs` tests run via node test runner / spawnSync child probes importing `./index.ts` directly; notices captured via `ui.notify` (headed) or `sendMessage` custom notices (headless).

## Start Here
Open `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2/index.ts` at lines 899-920 (status action) — this is where any status-output change must land; matching assertions are in `index.test.mjs` lines 400-482 and 570-610.
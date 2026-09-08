# Code Context — planner-only plugin recon

Repo root: `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r6` (flat plugin layout, sources at repo root)

## Files Retrieved

1. `index.ts` (lines 901-928) — `/planner-only status` command handler; the place to add the `Oracle suite:` line.
2. `roles.ts` (lines 51-53) — `oracleSuiteMode()` helper that reads `PI_PLANNER_ONLY_ORACLE`.
3. `roles.ts` (lines 234, 284) — how the oracle mode is consumed (`options.oracleMode ?? oracleSuiteMode()` in Validator wrapping).
4. `index.test.mjs` (lines 396-476, 555-606, 1692-1701) — status-related test coverage.
5. `package.json` (lines 47-52) — test scripts.

## Key Code

### Status handler (`index.ts` 901-928, already imports from roles.ts)
```ts
const action = (parts[0] ?? "status").toLowerCase();
...
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
No `Oracle suite:` line yet — that's the ticket (`.scratch/oracle-status-line/issues/01-status-oracle-suite.md`).

### oracleSuiteMode (`roles.ts` 51-53)
```ts
export function oracleSuiteMode(env: NodeJS.ProcessEnv = process.env): "bounded" | "full" {
	return (env.PI_PLANNER_ONLY_ORACLE ?? "").trim().toLowerCase() === "full" ? "full" : "bounded";
}
```
Consumed at `roles.ts:284` (`oracleMode: options.oracleMode ?? oracleSuiteMode()`); also referenced in `review.ts:456` prompt text. Note: `roles.ts:234` documents `options.oracleMode` as "Override oracle suite mode; defaults to PI_PLANNER_ONLY_ORACLE."

## Test coverage for status (`index.test.mjs`)

The suite is plain top-level script code (no test framework); assertions inline, plus `spawnSync` subprocess probes. Status-relevant blocks:

1. **"RF-4: D1 & D2 per-session force-on and status source reporting"** (comment header at ~line 399; assertions at lines 447, 458, 469):
   - `/Planner-only mode is on \(source: env\)/`, `/off \(source: marker\)/`, `/on \(source: default\)/` — run in a spawnSync probe asserting `console.log("planner-only rf4: PASS")`.
2. **"headless status names the effective state and its source"** (T05b spawnSync probe, ~lines 598-606): asserts `/Planner-only mode is off \(source: env\)/` and `/off \(source: marker\)/` in headless mode.
3. **"U-5 — Usage reporting, decision block usage line, and soft budget warning"** (section header ~line 1693; status block lines 1696-1701):
   ```js
   // /planner-only status includes usage log path and enabled state
   notices.length = 0;
   await commands.get("planner-only").handler("status", ctx);
   assert.match(notices.at(-1).message, /Planner-only mode is on/);
   assert.match(notices.at(-1).message, /Usage log: .*usage\.jsonl \(enabled\)/);
   ```
   This U-5 inline block is the natural place to extend per the issue ("extend index.test.mjs near the current status assertions").

## How tests are run (`package.json` 47-52)

- `npm test` — runs each `*.test.mjs` with `node --experimental-strip-types <file>` in sequence (policy, roles, task, report, review, notify, usage, orchestrate, evidence, git-audit, **index**, workspace-snapshot, architecture, naming).
- `npm run test:e2e` — `node --experimental-strip-types e2e.pi-subagents.test.mjs` (needs `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` per `test:release`).
- `npm run typecheck` — `tsc --noEmit`. Run the index test alone via `node --experimental-strip-types index.test.mjs`.

## Notes / risks

- Tests create temp dirs under `process.cwd()` (`.planner-only-test-*`) and set `PI_CODING_AGENT_DIR`; run from repo root.
- Ticket: add `Oracle suite: bounded|full` line to the status handler using `oracleSuiteMode()` from `roles.ts` (import already exists? verify — index.ts imports from roles.ts; add to import list if `oracleSuiteMode` isn't already imported). Cover default (bounded) and `PI_PLANNER_ONLY_ORACLE=full` → `full` in index.test.mjs near U-5 assertions.

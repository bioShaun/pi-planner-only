import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const guard = await import("./budget-guard-core.mjs").catch(() => undefined);
const terra = { model: "gpt-6.1-terra", input: [{ role: "user", content: "probe" }], max_output_tokens: 64000 };
const fixture = () => {
	const dir = mkdtempSync(join(tmpdir(), "native-lite-budget-"));
	return { dir, ledger: join(dir, "ledger.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
const meta = (ledgerPath, sessionId = "root-test") => ({ provider: "tcuni", sessionId, ledgerPath });

test("provider requests must reserve within the shared hard budget before transport", async () => {
	assert.ok(guard?.reserveProviderRequest, "missing pre-request reserve behavior: no shared budget guard implementation");
});

test("initial reserve and output cap are accounted conservatively", async () => {
	if (!guard?.reserveProviderRequest) return;
	const f = fixture();
	try {
		await guard.createLedger(f.ledger, { initialReserveUsd: 1, sessionId: "prep-run", now: "2026-10-27T12:00:00Z" });
		const result = await guard.reserveProviderRequest(terra, meta(f.ledger));
		assert.equal(result.payload.max_output_tokens, 16384);
		assert.ok(result.reservedUsd > 0.09 && result.reservedUsd < 0.1);
		const lowerOutput = guard.estimateReservation({ ...terra, max_output_tokens: 1000 }, "gpt-6.1-terra");
		assert.equal(lowerOutput.payload.max_output_tokens, 1000, "the guard must not raise the caller output limit");
		const state = await guard.readLedger(f.ledger);
		assert.ok(Math.abs(state.reservedUsd - 1 - result.reservedUsd) < 1e-9);
		assert.equal("prompt" in state.events[0], false);
	} finally { f.cleanup(); }
});

test("unknown models, missing or malformed ledgers, and cap crossing fail closed", async () => {
	if (!guard?.reserveProviderRequest) return;
	const f = fixture();
	try {
		await assert.rejects(guard.reserveProviderRequest({ ...terra, model: "gpt-6-unknown" }, meta(f.ledger)), /model/i);
		await assert.rejects(guard.reserveProviderRequest({ ...terra, future_provider_option: true }, meta(f.ledger)), /unknown provider request field/i);
		await assert.rejects(guard.reserveProviderRequest(terra, { ...meta(join(f.dir, "missing.json")) }), /ledger/i);
		await assert.rejects(guard.reserveProviderRequest(terra, { ...meta(f.ledger), provider: "other" }), /provider/i);
		await guard.createLedger(f.ledger, { initialReserveUsd: 15.95 });
		await assert.rejects(guard.reserveProviderRequest(terra, meta(f.ledger)), /budget|limit/i);
		const badPath = join(f.dir, "bad.json");
		await (await import("node:fs/promises")).writeFile(badPath, "{}\n");
		await assert.rejects(guard.reserveProviderRequest(terra, meta(badPath)), /ledger/i);
	} finally { f.cleanup(); }
});

test("multimodal input and provider extra-charge features fail closed", () => {
	if (!guard?.estimateReservation) return;
	assert.throws(() => guard.estimateReservation({
		...terra,
		input: [{ role: "user", content: [{ type: "input_image", image_url: "https://invalid.test/image" }] }],
	}, "gpt-6.1-terra"), /non-text input/i);
	assert.throws(() => guard.estimateReservation({ ...terra, tools: [{ type: "web_search_preview" }] }, "gpt-6.1-terra"), /extra-charge tools/i);
	assert.throws(() => guard.estimateReservation({ ...terra, service_tier: "priority" }, "gpt-6.1-terra"), /service-tier/i);
	assert.doesNotThrow(() => guard.estimateReservation({ ...terra, tools: [{ type: "function", name: "delegate" }] }, "gpt-6.1-terra"));
});

test("concurrent child reservations serialize across processes", async () => {
	if (!guard?.reserveProviderRequest) return;
	const f = fixture();
	try {
		await guard.createLedger(f.ledger, { initialReserveUsd: 15.85 });
		const moduleUrl = new URL("./budget-guard-core.mjs", import.meta.url).href;
		const args = meta(f.ledger, "child");
		const code = `import(${JSON.stringify(moduleUrl)}).then(async g=>{await g.reserveProviderRequest(${JSON.stringify(terra)},${JSON.stringify(args)});process.exit(0)}).catch(()=>process.exit(73))`;
		const { spawn } = await import("node:child_process");
		const run = () => new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, PI_PROVIDER: "tcuni" } });
			child.once("error", reject);
			child.once("close", (code) => resolve(code));
		});
		const exits = await Promise.all([run(), run()]);
		assert.deepEqual([...exits].sort(), [0, 73]);
		const state = await guard.readLedger(f.ledger);
		assert.ok(state.reservedUsd < 16);
	} finally { f.cleanup(); }
});

test("failed or unknown-usage requests keep their reservation; they are never refunded", async () => {
	if (!guard?.reserveProviderRequest) return;
	const f = fixture();
	try {
		await guard.createLedger(f.ledger, { initialReserveUsd: 1 });
		const moduleUrl = new URL("./budget-guard-core.mjs", import.meta.url).href;
		const args = meta(f.ledger, "timed-out-child");
		const code = `import(${JSON.stringify(moduleUrl)}).then(async g=>{await g.reserveProviderRequest(${JSON.stringify(terra)},${JSON.stringify(args)});process.exit(124)}).catch(()=>process.exit(73))`;
		const { spawn } = await import("node:child_process");
		const exitCode = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, PI_PROVIDER: "tcuni" } });
			child.once("error", reject);
			child.once("close", resolve);
		});
		assert.equal(exitCode, 124, "fault injection simulates a timed-out child after reservation");
		const afterFailure = await guard.readLedger(f.ledger);
		assert.ok(afterFailure.reservedUsd > 1, "timeout must not release the committed reserve");
		assert.equal(typeof afterFailure.events.at(-1).payloadHash, "string");
		assert.equal(afterFailure.events.at(-1).sessionId, "timed-out-child");
	} finally { f.cleanup(); }
});

test("pi-subagents requires the guard extension for every Pi child runner", async () => {
	const { pathToFileURL } = await import("node:url");
	const { join } = await import("node:path");
	const packageDir = process.env.PI_SUBAGENTS_DIR ?? join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents");
	const api = await import(pathToFileURL(join(packageDir, "bundle/required-child-extensions.js")).href);
	const { resolvePiLaunchToolPlan } = await import(pathToFileURL(join(packageDir, "bundle/child-tool-plan.js")).href);
	const registration = api.registerRequiredChildExtensions({
		sessionId: `budget-test-${process.pid}`,
		extensions: [{ id: "native-lite-budget-guard-test", path: new URL("./budget-guard.ts", import.meta.url).pathname }],
		requireForAllRunners: true,
	});
	try {
		const snapshot = globalThis[Symbol.for("pi-subagents.required-child-extensions.v1")].bySession.get(`budget-test-${process.pid}`);
		assert.equal(snapshot[0].path, new URL("./budget-guard.ts", import.meta.url).pathname);
		assert.equal(snapshot[0].requireForAllRunners, true);
		assert.equal(Object.isFrozen(snapshot), true);
		for (const mode of ["native", "lite"]) {
			const plan = resolvePiLaunchToolPlan({ cwd: process.cwd(), tools: ["read"], requiredExtensions: snapshot });
			assert.ok(plan.extensionArgs.includes(snapshot[0].path), `${mode} Pi child launch must include the required guard extension`);
		}
	} finally { registration.dispose(); }
});

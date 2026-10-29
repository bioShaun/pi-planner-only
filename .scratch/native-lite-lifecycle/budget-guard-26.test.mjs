import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const guard = await import("./budget-guard-core.mjs");
const baseline = await import(pathToFileURL(join(process.cwd(), ".scratch/native-lite-lifecycle/evidence/budget-26/budget-guard-core.16.mjs")).href);
const tempRoot = process.env.TMPDIR ?? "/project/tmp";
await mkdir(tempRoot, { recursive: true });
const root = await mkdtemp(join(tempRoot, "budget-guard-26-"));
const terra = { model: "gpt-6.1-terra", input: "a short fixture request", max_output_tokens: 16384 };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const meta = ledgerPath => ({ provider: "tcuni", sessionId: "budget-26-test", ledgerPath, now: "2026-10-28T00:00:00Z" });
const fixtureLedger = (reservedUsd, sessionId) => {
	const events = [{ model: "tcuni/gpt-6-luna", reserveUsd: reservedUsd, sessionId, timestamp: "2026-10-27T00:00:00Z", payloadHash: sha(sessionId) }];
	const body = { version: 1, reservedUsd, events };
	return { ...body, checksum: sha(JSON.stringify(body)) };
};

test.after(async () => rm(root, { recursive: true, force: true }));

test("saved legacy guard preserves the old $16 refusal baseline", async () => {
	const ledgerPath = join(root, "legacy-16.json");
	await baseline.createLedger(ledgerPath, { initialReserveUsd: 15.95, sessionId: "legacy-16-seed" });
	const before = await readFile(ledgerPath);
	await assert.rejects(baseline.reserveProviderRequest(terra, meta(ledgerPath)), /at or above \$16 reserve cap/);
	assert.deepEqual(await readFile(ledgerPath), before);
	assert.deepEqual(await readdir(root), ["legacy-16.json"]);
});

test("revised guard accepts a valid request with existing reservations between $16 and $26", async () => {
	assert.equal(guard.BUDGET_USD, 26);
	const ledgerPath = join(root, "within-26.json");
	await guard.createLedger(ledgerPath, { initialReserveUsd: 16.25, sessionId: "within-26-seed" });
	const result = await guard.reserveProviderRequest(terra, meta(ledgerPath));
	const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
	assert.equal(result.payload.max_output_tokens, 16384);
	assert.equal(ledger.events.length, 2);
	assert.ok(ledger.reservedUsd > 16 && ledger.reservedUsd < 26);
	assert.equal(ledger.checksum, sha(JSON.stringify({ version: ledger.version, reservedUsd: ledger.reservedUsd, events: ledger.events })));
	assert.deepEqual((await readdir(root)).sort(), ["legacy-16.json", "within-26.json"]);
});

test("request reaching or crossing $26 is refused without changing ledger bytes", async () => {
	const estimate = guard.estimateReservation(terra, terra.model).reserveUsd;
	for (const [name, delta] of [["at-26", 0], ["over-26", 0.000001]]) {
		const ledgerPath = join(root, `${name}.json`);
		await writeFile(ledgerPath, `${JSON.stringify(fixtureLedger(26 - estimate + delta, `${name}-seed`))}\n`, { flag: "wx" });
		const before = await readFile(ledgerPath);
		await assert.rejects(guard.reserveProviderRequest(terra, meta(ledgerPath)), /at or above \$26 reserve cap/);
		assert.deepEqual(await readFile(ledgerPath), before, name);
		await assert.rejects(readFile(`${ledgerPath}.lock`), error => error.code === "ENOENT");
	}
});

test("model, provider, payload-shape, and pricing restrictions remain enforced", async () => {
	const ledgerPath = join(root, "rejections.json");
	await guard.createLedger(ledgerPath, { initialReserveUsd: 1, sessionId: "rejections-seed" });
	const before = await readFile(ledgerPath);
	await assert.rejects(guard.reserveProviderRequest({ ...terra, model: "gpt-6-unknown" }, meta(ledgerPath)), /unknown model/);
	await assert.rejects(guard.reserveProviderRequest(terra, { ...meta(ledgerPath), provider: "other" }), /provider outside allowlist/);
	await assert.rejects(guard.reserveProviderRequest({ ...terra, future_provider_option: true }, meta(ledgerPath)), /unknown provider request field/);
	await assert.rejects(guard.reserveProviderRequest({ ...terra, input: [{ type: "input_image", image_url: "fixture" }] }, meta(ledgerPath)), /non-text input/);
	await assert.rejects(guard.reserveProviderRequest({ ...terra, service_tier: "priority" }, meta(ledgerPath)), /service-tier/);
	await assert.rejects(guard.reserveProviderRequest({ ...terra, max_output_tokens: 0 }, meta(ledgerPath)), /invalid max_output_tokens/);
	assert.deepEqual(await readFile(ledgerPath), before);
});

test("concurrent reservations serialize at the revised $26 ceiling", async () => {
	const ledgerPath = join(root, "concurrent-26.json");
	await writeFile(ledgerPath, `${JSON.stringify(fixtureLedger(25.85, "concurrent-seed"))}\n`, { flag: "wx" });
	const moduleUrl = new URL("./budget-guard-core.mjs", import.meta.url).href;
	const args = meta(ledgerPath);
	const code = `import(${JSON.stringify(moduleUrl)}).then(async g=>{await g.reserveProviderRequest(${JSON.stringify(terra)},${JSON.stringify(args)});process.exit(0)}).catch(()=>process.exit(73))`;
	const run = () => new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" });
		child.once("error", reject);
		child.once("close", resolve);
	});
	const codes = await Promise.all([run(), run()]);
	assert.deepEqual(codes.sort((a, b) => a - b), [0, 73]);
	const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
	assert.equal(ledger.events.length, 2);
	assert.ok(ledger.reservedUsd < 26);
	assert.equal(ledger.checksum, sha(JSON.stringify({ version: ledger.version, reservedUsd: ledger.reservedUsd, events: ledger.events })));
	await assert.rejects(readFile(`${ledgerPath}.lock`), error => error.code === "ENOENT");
});

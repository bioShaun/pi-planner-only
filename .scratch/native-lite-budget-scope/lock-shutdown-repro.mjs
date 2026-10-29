import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLedger } from "../native-lite-lifecycle/budget-guard-core.mjs";

const script = fileURLToPath(import.meta.url);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

if (process.argv[2] === "holder") {
	const ledgerPath = process.env.PI_LOCK_HOLDER_LEDGER;
	const lockPath = `${ledgerPath}.lock`;
	const fs = await import("node:fs");
	const { syncBuiltinESMExports } = await import("node:module");
	const realOpen = fs.default.promises.open;
	fs.default.promises.open = async (path, ...args) => {
		const handle = await realOpen(path, ...args);
		if (path === lockPath && args[0] === "wx") {
			const info = await lstat(lockPath);
			process.stdout.write(`${JSON.stringify({ event: "actual-guard-lock-created", inode: info.ino, size: info.size })}\n`);
			await new Promise(resolve => process.stdin.once("data", resolve));
		}
		return handle;
	};
	syncBuiltinESMExports();
	const { reserveProviderRequest } = await import("../native-lite-lifecycle/budget-guard-core.mjs");
	await reserveProviderRequest({ model: "gpt-6.1-terra", input: "isolated runner shutdown fixture", max_output_tokens: 1 }, {
		provider: "tcuni", sessionId: process.env.PI_LOCK_HOLDER_SESSION, ledgerPath,
		now: "2026-10-28T00:00:00.000Z",
	});
	process.stdout.write(`${JSON.stringify({ event: "actual-guard-reservation-complete" })}\n`);
	process.exit(0);
}

const root = process.env.PI_NATIVE_LITE_LOCK_SHUTDOWN_ROOT;
assert.ok(root?.startsWith("/project/tmp/pi-native-lite-budget-scope/lock-shutdown-"));
await import("node:fs/promises").then(({ mkdir }) => mkdir(root, { recursive: true }));

async function runScenario(name, shutdown) {
	const dir = await mkdtemp(join(root, `${name}-`));
	const ledgerPath = join(dir, "ledger.json");
	await createLedger(ledgerPath, { initialReserveUsd: 1, sessionId: `${name}-history` });
	const before = await readFile(ledgerPath);
	const child = spawn(process.execPath, [script, "holder"], {
		cwd: process.cwd(),
		env: { ...process.env, PI_LOCK_HOLDER_LEDGER: ledgerPath, PI_LOCK_HOLDER_SESSION: `${name}-request` },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", chunk => { stderr += chunk; });
	const lines = createInterface({ input: child.stdout });
	const first = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`${name} child did not acquire the actual guard lock: ${stderr}`)), 5000);
		lines.once("line", line => { clearTimeout(timeout); resolve(JSON.parse(line)); });
		child.once("error", error => { clearTimeout(timeout); reject(error); });
	});
	assert.equal(first.event, "actual-guard-lock-created");
	assert.equal(first.size, 0);
	if (shutdown) child.kill("SIGTERM");
	else child.stdin.write("continue\n");
	const exit = await new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
	lines.close();
	const after = await readFile(ledgerPath);
	let lockExists = true;
	try { await lstat(`${ledgerPath}.lock`); }
	catch (error) { if (error.code === "ENOENT") lockExists = false; else throw error; }
	if (shutdown) {
		assert.equal(exit.signal, "SIGTERM", `${name} termination: ${stderr}`);
		assert.deepEqual(after, before);
		assert.equal(lockExists, true);
	} else {
		assert.equal(exit.code, 0, `${name} completion: ${stderr}`);
		assert.notDeepEqual(after, before);
		assert.equal(lockExists, false);
	}
	return {
		name, shutdown, childExit: exit, beforeLedgerSha256: sha(before), afterLedgerSha256: sha(after),
		lockPath: `${ledgerPath}.lock`, lockExists, lockInodeBeforeExit: first.inode,
		providerDispatchCount: 0,
	};
}

const terminated = await runScenario("runner-shutdown", true);
const completed = await runScenario("normal-completion", false);
console.log(JSON.stringify({ terminated, completed, result: "actual guard leaves O_EXCL lock after process termination before await resumes; normal finally path removes it" }, null, 2));

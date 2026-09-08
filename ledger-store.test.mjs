import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { createTaskSpec, TaskStore } from "./task.ts";

const fsCjs = createRequire(import.meta.url)("fs");

const cwd = process.cwd();
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

function sandbox() {
	return mkdtempSync(join(cwd, ".planner-only-ledger-"));
}

function listFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else out.push(path);
		}
	};
	if (fs.existsSync(root)) walk(root);
	return out.sort();
}

function makeRecord(taskId, extra = {}) {
	const spec = createTaskSpec({ objective: "ledger snapshot", cwd }, taskId);
	spec.cumulativeBudget = { tokens: 50000, costUsd: 0.25 };
	const store = new TaskStore({ now: () => new Date("2026-09-08T12:00:00.000Z") });
	const record = store.create(spec);
	return Object.assign(record, extra);
}

function snapshotPath(dir, taskId) {
	return join(dir, "planner-only", "ledger", `${taskId}.json`);
}

{
	const dir = sandbox();
	try {
		const record = makeRecord("T-20260908-001");
		const ledger = new LedgerSnapshotStore(dir);
		ledger.write(record);
		const path = snapshotPath(dir, record.taskId);
		assert.equal(fs.existsSync(path), true, "A1: snapshot path is <dir>/planner-only/ledger/<taskId>.json");
		const envelope = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(envelope.version, 1, "A2: envelope.version is 1");
		assert.match(envelope.writtenAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "A3: writtenAt is ISO-8601");
		assert.equal(envelope.task.taskId, record.taskId, "A4: envelope.task.taskId matches");
		assert.deepEqual(envelope.task.spec.cumulativeBudget, { tokens: 50000, costUsd: 0.25 }, "A5: spec.cumulativeBudget survives the snapshot");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const previous = process.env.PI_CODING_AGENT_DIR;
	const dir = sandbox();
	const canary = join(dir, "CANARY_AGENT");
	mkdirSync(canary);
	process.env.PI_CODING_AGENT_DIR = canary;
	try {
		const record = makeRecord("T-20260908-env");
		new LedgerSnapshotStore(dir).write(record);
		assert.equal(fs.existsSync(join(canary, "planner-only")), false, "A6: constructor uses the passed dir, not PI_CODING_AGENT_DIR");
		assert.equal(fs.existsSync(snapshotPath(dir, record.taskId)), true, "A7: snapshot lands under the constructor dir");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	const storeRoot = join(dir, "store");
	mkdirSync(storeRoot);
	const ledger = new LedgerSnapshotStore(storeRoot);
	const good = makeRecord("T-20260908-ok");
	const silence = (...args) => {
		void args;
	};
	const origError = console.error;
	console.error = silence;
	try {
		const before = new Set(listFiles(dir));
		for (const taskId of ["", "foo/bar", "T-2026../../etc/x", "../escape"]) {
			try {
				ledger.write({ ...good, taskId });
			} catch {
				// invalid ids must throw; the assertion is that they still create no files
			}
		}
		const created = listFiles(dir).filter((path) => !before.has(path));
		assert.deepEqual(created, [], "A12: rejected taskIds create no files anywhere under the sandbox");
		assert.throws(() => ledger.write({ ...good, taskId: "" }), /invalid ledger taskId/, "A8: empty taskId throws before any path is built");
		assert.throws(() => ledger.write({ ...good, taskId: "foo/bar" }), /invalid ledger taskId/, "A9: taskId with slash throws");
		assert.throws(() => ledger.write({ ...good, taskId: "T-2026../../etc/x" }), /invalid ledger taskId/, "A10: traversal-shaped taskId throws");
		assert.throws(() => ledger.write({ ...good, taskId: "../escape" }), /invalid ledger taskId/, "A11: taskId containing .. and slash throws");
	} finally {
		console.error = origError;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	const record = makeRecord("T-20260908-atom");
	const ledger = new LedgerSnapshotStore(dir);
	ledger.write(record);
	const finalPath = snapshotPath(dir, record.taskId);
	const first = readFileSync(finalPath, "utf8");
	assert.equal(JSON.parse(first).version, 1, "A13: first snapshot is valid JSON");

	const origStringify = JSON.stringify;
	JSON.stringify = () => {
		throw new Error("serialize boom");
	};
	const origError = console.error;
	console.error = () => {};
	try {
		assert.doesNotThrow(() => ledger.write(makeRecord("T-20260908-atom")), "A14: serialize failure does not throw out of write()");
		assert.equal(readFileSync(finalPath, "utf8"), first, "A15: serialize failure leaves the previous snapshot bytes untouched");
		assert.equal(JSON.parse(readFileSync(finalPath, "utf8")).task.taskId, "T-20260908-atom", "A16: previous snapshot is still parseable");
		assert.ok(ledger.lastWriteError, "A17: lastWriteError is set after serialize failure");
	} finally {
		JSON.stringify = origStringify;
		console.error = origError;
	}

	const observedFinalDuringWrite = [];
	const writeTargets = [];
	const origWrite = fsCjs.writeFileSync;
	fsCjs.writeFileSync = function patchedWrite(path, data, encoding) {
		writeTargets.push(String(path));
		origWrite.call(fsCjs, path, "PARTIAL", encoding);
		observedFinalDuringWrite.push(readFileSync(finalPath, "utf8"));
		throw new Error("injected write failure");
	};
	console.error = () => {};
	try {
		ledger.write(makeRecord("T-20260908-atom"));
		assert.equal(writeTargets.some((path) => path === finalPath), false, "A18: writeFileSync is never pointed at the final snapshot path");
		assert.equal(writeTargets.length > 0, true, "A19: a temp write was attempted");
		assert.equal(writeTargets[0].startsWith(join(dir, "planner-only", "ledger") + "/"), true, "A20: the temp file is in the same directory as the final snapshot");
		assert.equal(writeTargets[0].includes(String(process.pid)), true, "A21: the temp file name includes the pid");
		assert.deepEqual(observedFinalDuringWrite, [first], "A22: final path stays the old complete snapshot while the temp write runs");
		assert.equal(readFileSync(finalPath, "utf8"), first, "A23: after a failed write the old snapshot is still the complete original");
		assert.equal(JSON.parse(readFileSync(finalPath, "utf8")).task.spec.cumulativeBudget.tokens, 50000, "A24: failed write does not leave a half-written final file");
	} finally {
		fsCjs.writeFileSync = origWrite;
		console.error = origError;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	const ledger = new LedgerSnapshotStore(dir);
	const origWrite = fsCjs.writeFileSync;
	const origError = console.error;
	let warns = 0;
	console.error = () => {
		warns += 1;
	};
	fsCjs.writeFileSync = function () {
		throw new Error("disk full");
	};
	try {
		assert.doesNotThrow(() => ledger.write(makeRecord("T-20260908-w1")), "A25: I/O failure does not throw");
		assert.doesNotThrow(() => ledger.write(makeRecord("T-20260908-w2")), "A26: a second I/O failure still does not throw");
		assert.ok(ledger.lastWriteError, "A27: lastWriteError is exposed after I/O failure");
		assert.match(String(ledger.lastWriteError), /disk full/, "A28: lastWriteError carries the I/O error");
		assert.equal(warns, 1, "A29: the instance warns at most once per session");
	} finally {
		fsCjs.writeFileSync = origWrite;
		console.error = origError;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	try {
		const spec = createTaskSpec({ objective: "wired sink", cwd }, "T-20260908-orch");
		spec.cumulativeBudget = { tokens: 1000, costUsd: 1 };
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const created = orch.store.create(spec);
		assert.equal(fs.existsSync(snapshotPath(dir, created.taskId)), true, "A30: Orchestrator with ledgerDir and no injected store persists on create");
		orch.store.transition(created.taskId, "executing");
		const envelope = JSON.parse(readFileSync(snapshotPath(dir, created.taskId), "utf8"));
		assert.equal(envelope.task.state, "executing", "A31: touch() persist captures later mutations");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	try {
		const injected = new TaskStore();
		const spec = createTaskSpec({ objective: "injected store", cwd }, "T-20260908-inj");
		const orch = new PlannerOrchestrator({ gitRunner, store: injected, ledgerDir: dir });
		orch.store.create(spec);
		assert.equal(fs.existsSync(join(dir, "planner-only")), false, "A32: injected deps.store plus ledgerDir must not construct a disk sink");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const spec = createTaskSpec({ objective: "no ledgerDir", cwd }, "T-20260908-none");
	const leaked = join(cwd, "planner-only", "ledger", `${spec.taskId}.json`);
	try {
		const orch = new PlannerOrchestrator({ gitRunner });
		orch.store.create(spec);
		assert.equal(fs.existsSync(leaked), false, "A33: omitting ledgerDir does not persist into cwd");
	} finally {
		rmSync(leaked, { force: true });
	}
}

console.log("planner-only ledger-store: PASS");

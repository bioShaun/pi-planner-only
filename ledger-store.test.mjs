import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
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
		const first = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const firstTask = first.store.create(createTaskSpec({ objective: "first generated task", cwd }));
		const second = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const restored = second.restoreFromLedger();
		assert.equal(restored.restored, 1, "A34: the first generated Task is restored");
		const secondTask = second.store.create(createTaskSpec({ objective: "second generated task", cwd }));
		assert.notEqual(secondTask.taskId, firstTask.taskId, "A35: generated ids do not reuse restored Tasks");
		assert.equal(second.store.require(firstTask.taskId).spec.objective, "first generated task", "A36: the restored Task remains unchanged");
		assert.equal(secondTask.spec.objective, "second generated task", "A37: the new spec stays associated with its new id");
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

{
	const dir = sandbox();
	const origError = console.error;
	let warns = 0;
	console.error = () => {
		warns += 1;
	};
	try {
		const missing = new LedgerSnapshotStore(join(dir, "no-such-agent"));
		const empty = missing.readAll();
		assert.deepEqual(empty, { records: [], corrupt: [] }, "B1: missing ledger dir returns empty records and corrupt");
		assert.equal(warns, 0, "B2: missing ledger dir does not warn");
	} finally {
		console.error = origError;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	try {
		const record = makeRecord("T-20260908-b3");
		const ledger = new LedgerSnapshotStore(dir);
		ledger.write(record);
		const ledgerDir = join(dir, "planner-only", "ledger");
		writeFileSync(join(ledgerDir, `.tmp-${process.pid}-99`), "partial", "utf8");
		writeFileSync(join(ledgerDir, `.tmp-${process.pid}-99.json`), "{}", "utf8");
		writeFileSync(join(ledgerDir, "notes.txt"), "ignore me", "utf8");
		const { records, corrupt } = ledger.readAll();
		assert.equal(records.length, 1, "B3: a valid snapshot is returned in records");
		assert.equal(records[0].taskId, "T-20260908-b3", "B4: restored record keeps the snapshot taskId");
		assert.deepEqual(corrupt, [], "B5: tmp leftovers and non-json files are not corrupt");
		assert.equal(existsSync(join(ledgerDir, `.tmp-${process.pid}-99`)), true, "B6: readAll does not delete .tmp leftovers");
		assert.equal(existsSync(join(ledgerDir, "notes.txt")), true, "B7: readAll does not delete non-json files");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	try {
		const ledger = new LedgerSnapshotStore(dir);
		ledger.write(makeRecord("T-20260908-keep"));
		const ledgerDir = join(dir, "planner-only", "ledger");
		writeFileSync(join(ledgerDir, "@@@.json"), "not-json", "utf8");
		writeFileSync(join(ledgerDir, "T-20260908-parse.json"), "this is not json", "utf8");
		writeFileSync(join(ledgerDir, "T-20260908-ver.json"), JSON.stringify({ version: 2, task: { taskId: "T-20260908-ver" } }), "utf8");
		writeFileSync(join(ledgerDir, "T-20260908-notask.json"), JSON.stringify({ version: 1, writtenAt: "2026-09-08T00:00:00.000Z" }), "utf8");
		writeFileSync(join(ledgerDir, "T-20260908-mismatch.json"), JSON.stringify({ version: 1, task: { taskId: "T-other" } }), "utf8");
		const { records, corrupt } = ledger.readAll();
		assert.equal(records.some((r) => r.taskId === "T-20260908-keep"), true, "B8: a neighbouring valid snapshot still restores");
		const byId = Object.fromEntries(corrupt.map((c) => [c.taskId, c.reason]));
		assert.match(byId["@@@"] ?? "", /filename is not a safe taskId/, "B9: unsafe filename stem is corrupt");
		assert.match(byId["T-20260908-parse"] ?? "", /unparseable JSON/, "B10: unparseable JSON is corrupt");
		assert.match(byId["T-20260908-ver"] ?? "", /unsupported version/, "B11: version !== 1 is corrupt");
		assert.match(byId["T-20260908-notask"] ?? "", /missing task/, "B12: missing task is corrupt");
		assert.match(byId["T-20260908-mismatch"] ?? "", /task\.taskId does not match filename/, "B13: task.taskId !== stem is corrupt");
		assert.equal(existsSync(join(ledgerDir, "T-20260908-parse.json")), true, "B14: readAll does not delete a corrupt file");
		assert.equal(existsSync(join(ledgerDir, "T-20260908-ver.json")), true, "B15: readAll does not delete an unsupported-version file");
	} finally {
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
	try {
		assert.throws(() => ledger.write({ ...makeRecord("T-20260908-ok"), taskId: "" }), /invalid ledger taskId/, "B16: empty taskId still throws");
		assert.equal(warns, 0, "B17: invalid taskId does not consume the I/O warn quota");
		fsCjs.writeFileSync = function () {
			throw new Error("disk full");
		};
		assert.doesNotThrow(() => ledger.write(makeRecord("T-20260908-io1")), "B18: I/O failure after an invalid id still does not throw");
		assert.equal(warns, 1, "B19: I/O failure after an invalid id still warns once");
		assert.ok(ledger.writeErrorFor("T-20260908-io1"), "B20: writeErrorFor records the failed taskId");
		assert.equal(ledger.writeErrorFor("T-20260908-other"), undefined, "B21: write failure is scoped to that taskId");
		fsCjs.writeFileSync = origWrite;
		ledger.write(makeRecord("T-20260908-io1"));
		assert.equal(ledger.writeErrorFor("T-20260908-io1"), undefined, "B22: a later successful write clears that taskId's failure mark");
		assert.ok(ledger.lastWriteError, "B23: lastWriteError remains as a diagnostic after the successful rewrite");
		assert.match(String(ledger.lastWriteError), /disk full/, "B24: lastWriteError still carries the last I/O error");
	} finally {
		fsCjs.writeFileSync = origWrite;
		console.error = origError;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = sandbox();
	const origWrite = fsCjs.writeFileSync;
	let writeCalls = 0;
	fsCjs.writeFileSync = function patchedWrite(...args) {
		writeCalls += 1;
		return origWrite.apply(this, args);
	};
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const record = makeRecord("T-20260908-q1");
		const notListed = ledger.isQuarantined(record.taskId);
		assert.equal(notListed, false, "Q1: a taskId is not quarantined until registered");

		ledger.write(record);
		const path = snapshotPath(dir, record.taskId);
		writeFileSync(path, "this is not json", "utf8");
		const before = readFileSync(path, "utf8");
		const ledgerDir = join(dir, "planner-only", "ledger");
		const beforeNames = readdirSync(ledgerDir).sort();
		writeCalls = 0;

		ledger.quarantine(record.taskId, "unparseable JSON");
		const listed = ledger.isQuarantined(record.taskId);
		assert.equal(listed, true, "Q2: quarantine registers the taskId");
		const otherListed = ledger.isQuarantined("T-20260908-other");
		assert.equal(otherListed, false, "Q3: quarantine is scoped to that taskId");

		assert.doesNotThrow(() => ledger.write(record), "Q4: write of a quarantined taskId does not throw");
		const afterWrite = readFileSync(path, "utf8");
		assert.equal(afterWrite, before, "Q5: write of a quarantined taskId does not change the snapshot bytes");
		const afterNames = readdirSync(ledgerDir).sort();
		assert.deepEqual(afterNames, beforeNames, "Q6: write of a quarantined taskId creates no temp files");
		assert.equal(writeCalls, 0, "Q6b: write of a quarantined taskId does not call writeFileSync");
		const qErr = ledger.writeErrorFor(record.taskId);
		assert.ok(qErr, "Q7: writeErrorFor records the quarantine");
		assert.match(String(qErr), /quarantin/i, "Q8: the write-health reason names quarantine, not a disk fault");

		const neighbor = makeRecord("T-20260908-q2");
		ledger.write(neighbor);
		assert.equal(existsSync(snapshotPath(dir, neighbor.taskId)), true, "Q9: a neighbouring taskId still writes");
		assert.equal(readFileSync(path, "utf8"), before, "Q10: writing a neighbour does not rewrite the quarantined file");

		const fresh = new LedgerSnapshotStore(dir);
		assert.equal(fresh.isQuarantined(record.taskId), false, "Q11: quarantine does not persist to disk");
		const { corrupt } = ledger.readAll();
		assert.equal(corrupt.some((item) => item.taskId === record.taskId), true, "Q12: readAll still reports the corrupt file");
		assert.equal(readFileSync(path, "utf8"), before, "Q13: readAll does not repair the quarantined file");
	} finally {
		fsCjs.writeFileSync = origWrite;
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("planner-only ledger-store: PASS");

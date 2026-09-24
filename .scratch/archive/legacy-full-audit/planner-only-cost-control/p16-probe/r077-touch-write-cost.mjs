// Ticket 16 legacy item: every touch() writes the whole TaskRecord synchronously.
// Measure it before deciding whether 16-b needs dirty-flagging or throttling.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { LedgerSnapshotStore } from "../../../ledger-store.ts";
import { createTaskSpec, TaskStore } from "../../../task.ts";

const dir = mkdtempSync(join(process.cwd(), ".p16-probe-"));
const cwd = process.cwd();

function report(taskId, n) {
	return {
		version: 1, taskId, status: "completed",
		summary: `round ${n}: ` + "x".repeat(400),
		changedFiles: Array.from({ length: 12 }, (_, i) => `src/module-${i}.ts`),
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: { cwd, taskId, workerRunId: `call-${n}`, baseGitRef: "abc1234", finalGitRef: "def5678",
			gitStatusHash: "h".repeat(64), changedPaths: Array.from({ length: 12 }, (_, i) => `src/module-${i}.ts`),
			gitAvailable: true, generatedAt: "2026-09-08T10:00:00.000Z" },
		risks: [], unresolved: [],
	};
}

for (const reports of [0, 3, 10, 30]) {
	const ledger = new LedgerSnapshotStore(dir);
	const store = new TaskStore({ onPersist: (r) => ledger.write(r) });
	const spec = createTaskSpec({ objective: "measure", cwd }, `T-2026090${reports === 0 ? 8 : 9}-r${reports}`);
	const task = store.create(spec);
	for (let i = 0; i < reports; i++) task.reports.push(report(task.taskId, i));

	const N = 200;
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < N; i++) store.persist(task);
	const t1 = process.hrtime.bigint();
	const perWrite = Number(t1 - t0) / N / 1e6;
	const bytes = statSync(join(dir, "planner-only", "ledger", `${task.taskId}.json`)).size;
	console.log(`reports=${String(reports).padStart(2)}  snapshot=${String(bytes).padStart(7)} B  per touch()=${perWrite.toFixed(3)} ms`);
}
rmSync(dir, { recursive: true, force: true });

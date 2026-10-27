import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const batchRoot = "/project/tmp/pi-native-lite-20261028T054700+0800";
const worktrees = process.env.PI_RETRY1_WORKTREES ?? join(batchRoot, "retry1-worktrees");
const resultsRoot = process.env.PI_RETRY1_RESULTS_ROOT ?? join(batchRoot, "results", "retry1");
const frozenBriefRoot = "/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/preflight";

test("each actual arm cwd and result directory match the task brief's path contract", async () => {
	const scenarioBriefs = new Map();
	for (const arm of ["S1-native", "S1-lite", "S2-lite", "S2-native"]) {
		const actualCwd = resolve(join(worktrees, arm));
		const brief = await readFile(join(worktrees, arm, "input", "brief.md"), "utf8");
		scenarioBriefs.set(arm, brief);
		const firstLine = brief.split(/\r?\n/, 1)[0];
		const resultBase = firstLine.match(/under `([^`]+)\/<pair>-<mode>\//i)?.[1];
		const cwdBase = firstLine.match(/worktree CWD `([^`]+)\/<pair>-<mode>`/i)?.[1];
		assert.ok(resultBase, `${arm}: brief must declare an arm-derived result path`);
		assert.ok(cwdBase, `${arm}: brief must declare an arm-derived worktree CWD`);
		assert.equal(actualCwd, resolve(join(cwdBase, arm)), `${arm}: actual checkout must equal its brief-derived cwd`);
		const declaredResults = resolve(join(resultBase, arm));
		assert.equal(resolve(join(resultsRoot, arm)), declaredResults, `${arm}: actual results directory must equal the brief-derived results path`);
	}
	const digest = value => createHash("sha256").update(value).digest("hex");
	assert.equal(digest(scenarioBriefs.get("S1-native")), digest(scenarioBriefs.get("S1-lite")), "S1 retry1 briefs must remain byte-identical");
	assert.equal(digest(scenarioBriefs.get("S2-native")), digest(scenarioBriefs.get("S2-lite")), "S2 retry1 briefs must remain byte-identical");
	for (const [scenario, arm] of [["S1", "S1-native"], ["S2", "S2-native"]]) {
		const normalized = scenarioBriefs.get(arm)
			.replace(`${batchRoot}/results/retry1`, "/project/tmp/pi-native-lite-pairs/results")
			.replace(`${batchRoot}/retry1-worktrees/<pair>-<mode>`, "/project/tmp/pi-native-lite-pairs/<pair>/<mode>")
			.replace(`${batchRoot}/retry1-common/S2-candidate.diff`, "/project/tmp/pi-native-lite-pairs/common/S2-candidate.diff");
		assert.equal(normalized, await readFile(join(frozenBriefRoot, `${scenario}-brief.md`), "utf8"), `${scenario}: only retry1 path contract may differ from frozen brief`);
	}
});

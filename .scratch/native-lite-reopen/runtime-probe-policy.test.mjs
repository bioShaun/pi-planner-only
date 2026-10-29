import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let policy;
try { policy = await import("./runtime-probe-policy.mjs"); }
catch { policy = {}; }
const directory = dirname(fileURLToPath(import.meta.url));

test("probe completion requires the final complete models-management result", () => {
	assert.equal(typeof policy.isFinalModelsManagementResult, "function");
});

test("an interim Running subagent message is not a models result", t => {
	if (!policy.isFinalModelsManagementResult) return t.skip("probe result policy not available");
	assert.equal(policy.isFinalModelsManagementResult({
		role: "custom", customType: "subagent-slash-result", content: "Running subagent...",
		details: { result: { details: { mode: "single" } } },
	}), false);
});

test("the final complete management output is accepted and incomplete role output is rejected", t => {
	if (!policy.isFinalModelsManagementResult) return t.skip("probe result policy not available");
	const complete = {
		role: "custom", customType: "subagent-slash-result",
		content: "Subagent models\nCurrent session model: tcuni/gpt-6.1-terra\nworker tcuni/gpt-6-luna medium\noracle tcuni/gpt-6-luna medium\nreviewer tcuni/gpt-6-luna medium",
		details: { result: { details: { mode: "management" } } },
	};
	assert.equal(policy.isFinalModelsManagementResult(complete), true);
	assert.equal(policy.isFinalModelsManagementResult({ ...complete, content: complete.content.replace("reviewer", "other") }), false);
});

test("runtime probe runner waits for the final management message before closing RPC stdin", async () => {
	const source = await readFile(join(directory, "runtime-probe-runner.mjs"), "utf8");
	assert.ok(source.includes("isFinalModelsManagementResult(event.message)"));
	assert.ok(source.includes("customType === \"subagent-slash-result\""));
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	ConcurrencyController,
	DEFAULT_CONCURRENCY_LIMIT,
	loadConcurrencyDefault,
	parseConcurrencyLimit,
	saveConcurrencyDefault,
} from "./concurrency.ts";

assert.equal(parseConcurrencyLimit("3"), 3);
assert.equal(parseConcurrencyLimit("0"), undefined);
assert.equal(parseConcurrencyLimit("1.5"), undefined);

const controller = new ConcurrencyController();
assert.equal(controller.status().limit, DEFAULT_CONCURRENCY_LIMIT);
assert.equal(controller.status().source, "default");
assert.ok(controller.reserve({ id: "r1", role: "explorer", capability: "reader", workspaces: ["/repo"] }).reservation);
assert.ok(controller.reserve({ id: "r2", role: "explorer", capability: "reader", workspaces: ["/repo"] }).reservation);
assert.equal(controller.reserve({ id: "w", role: "worker", capability: "writer", workspaces: ["/repo"] }).refusal?.code, "WORKSPACE_CONFLICT");
assert.ok(controller.reserve({ id: "w2", role: "worker", capability: "writer", workspaces: ["/other"] }).reservation);
assert.equal(controller.reserve({ id: "w3", role: "worker", capability: "writer", workspaces: ["/third"] }).reservation, undefined);
assert.equal(controller.reserve({ id: "w3", role: "worker", capability: "writer", workspaces: ["/third"] }).refusal?.code, "CONCURRENCY_LIMIT_REACHED");
controller.release("r1");
controller.release("r2");
controller.release("w2");

const root = mkdtempSync(join(process.cwd(), ".planner-only-concurrency-test-"));
try {
	const config = join(root, "planner-only", "concurrency.json");
	assert.equal(loadConcurrencyDefault(config).source, "default");
	assert.deepEqual(saveConcurrencyDefault(config, 5), { ok: true });
	assert.deepEqual(loadConcurrencyDefault(config), { limit: 5, source: "saved" });
} finally {
	rmSync(root, { recursive: true, force: true });
}

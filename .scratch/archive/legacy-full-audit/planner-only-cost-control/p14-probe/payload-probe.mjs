// p14 probe 2: does a payload built by our own applyRoleDelegation validate
// against the host's SubagentParams schema, and do the negatives fail?
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Check } from "typebox/value";
import { applyRoleDelegation, stripDelegationKeys } from "../../../roles.ts";

const pkgDir = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "npm", "node_modules", "pi-subagents");
const workDir = mkdtempSync(join(process.cwd(), ".planner-only-probe-"));
try {
	const pkgCopy = join(workDir, "pi-subagents");
	cpSync(pkgDir, pkgCopy, { recursive: true });
	mkdirSync(join(workDir, "node_modules"), { recursive: true });
	for (const entry of readdirSync(join(pkgDir, ".."), { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		try { symlinkSync(join(pkgDir, "..", entry.name), join(workDir, "node_modules", entry.name), "dir"); } catch {}
	}
	const { createSubagentParamsSchema } = await import(pathToFileURL(join(pkgCopy, "src", "extension", "schemas.ts")).href);
	const schema = createSubagentParamsSchema();

	const validator = { agent: "worker", context: "fork", task: "probe validator" };
	applyRoleDelegation(validator, { role: "validator" });
	console.log("PROBE validator before strip:", JSON.stringify(validator));
	console.log("PROBE Check(validator, keys not stripped):", Check(schema, validator));
	stripDelegationKeys(validator);
	console.log("PROBE validator after strip:", JSON.stringify(validator));
	console.log("PROBE Check(validator):", Check(schema, validator));

	const worker = { agent: "worker", context: "fork", task: "probe worker" };
	applyRoleDelegation(worker, { role: "worker", taskId: "T-20260908-001", reportsCount: 1 });
	stripDelegationKeys(worker);
	console.log("PROBE worker:", JSON.stringify(worker).slice(0, 300));
	console.log("PROBE Check(worker):", Check(schema, worker));

	console.log("PROBE Check(toolBudget missing hard):", Check(schema, { ...worker, toolBudget: { soft: 5 } }));
	console.log("PROBE Check(toolBudget hard=0):", Check(schema, { ...worker, toolBudget: { hard: 0 } }));
	console.log("PROBE Check(usageBudget tokens missing hard):", Check(schema, { ...worker, usageBudget: { tokens: { soft: 1 } } }));
	console.log("PROBE Check(usageBudget extra key):", Check(schema, { ...worker, usageBudget: { tokens: { hard: 1 }, nope: 1 } }));
	console.log("PROBE Check(top-level unknown key):", Check(schema, { ...worker, __floorLimits: { toolBudget: { value: 20, source: "floor" } } }));
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

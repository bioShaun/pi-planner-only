// p14 probe: can §F import the packaged (non-exported) src/extension/schemas.ts
// the same way the e2e stages the package, and assert the budget parameter shape?
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const pkgDir = join(agentDir, "npm", "node_modules", "pi-subagents");
const workDir = mkdtempSync(join(process.cwd(), ".planner-only-probe-"));
try {
	const pkgCopy = join(workDir, "pi-subagents");
	cpSync(pkgDir, pkgCopy, { recursive: true });
	const realNodeModules = join(pkgDir, "..");
	mkdirSync(join(workDir, "node_modules"), { recursive: true });
	for (const entry of readdirSync(realNodeModules, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		try { symlinkSync(join(realNodeModules, entry.name), join(workDir, "node_modules", entry.name), "dir"); } catch {}
	}
	const schemasPath = join(pkgCopy, "src", "extension", "schemas.ts");
	const mod = await import(pathToFileURL(schemasPath).href);
	console.log("PROBE exports:", Object.keys(mod).filter((k) => /Subagent|create/.test(k)).join(","));
	const schema = mod.createSubagentParamsSchema();
	const props = schema.properties ?? {};
	console.log("PROBE toolBudget:", JSON.stringify(props.toolBudget));
	console.log("PROBE usageBudget:", JSON.stringify(props.usageBudget));
	// Can we validate a real plugin payload against the host schema?
	const tb = await import("typebox");
	console.log("PROBE typebox keys:", Object.keys(tb).slice(0, 20).join(","));
	let value = null;
	try { value = await import("typebox/value"); console.log("PROBE typebox/value keys:", Object.keys(value).slice(0, 20).join(",")); }
	catch (err) { console.log("PROBE typebox/value FAILED:", err.code ?? err.message); }
	if (value?.Check) {
		const good = { agent: "worker", task: "t", toolBudget: { hard: 20 }, usageBudget: { tokens: { hard: 40000 }, costUsd: { hard: 0.1 } } };
		const bad = { agent: "worker", task: "t", toolBudget: { soft: 5 } };
		const bad2 = { agent: "worker", task: "t", usageBudget: { tokens: { hard: 40000 }, extra: 1 } };
		console.log("PROBE Check(good):", value.Check(schema, good));
		console.log("PROBE Check(bad no hard):", value.Check(schema, bad));
		console.log("PROBE Check(bad extra prop):", value.Check(schema, bad2));
	}
	console.log("PROBE installed version:", JSON.parse(readFileSync(join(pkgCopy, "package.json"), "utf8")).version);
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

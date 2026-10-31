import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const expectedTools = ["read", "grep", "find", "ls", "watchdog_diff", "contact_supervisor", "git_review"];

export async function checkReviewerConfig(cwd = process.cwd(), options = {}) {
	const root = options.piSubagentsDir ?? process.env.PI_SUBAGENTS_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents");
	const { discoverAgents, clearAgentDiscoveryCache } = await import(pathToFileURL(join(root, "src/agents/agents.js")).href);
	const { resolvePiLaunchToolPlan } = await import(pathToFileURL(join(root, "src/runs/shared/child-tool-plan.js")).href);
	const project = resolve(cwd);
	clearAgentDiscoveryCache();
	const reviewer = discoverAgents(project, "both").agents.find((agent) => agent.name === "reviewer");
	if (!reviewer) return { tools: [], subagentOnlyExtensions: [], issues: ["reviewer agent not found"] };
	const plan = resolvePiLaunchToolPlan({
		cwd: project, agentName: reviewer.name, tools: reviewer.tools, excludeTools: reviewer.excludeTools,
		allowNestedSubagents: reviewer.allowNestedSubagents, extensions: reviewer.extensions,
		subagentOnlyExtensions: reviewer.subagentOnlyExtensions, mcpDirectTools: reviewer.mcpDirectTools,
		fast: reviewer.fast, model: reviewer.model, permissionRules: reviewer.permission,
	});
	const tools = plan.effectiveToolAllowlist;
	const issues = [];
	if (!plan.explicitToolAllowlist || tools.length !== expectedTools.length || expectedTools.some((tool) => !tools.includes(tool))) {
		issues.push(`reviewer tools must equal ${expectedTools.join(", ")}; effective: ${tools.join(", ") || "(none)"}`);
	}
	const forbidden = tools.filter((tool) => ["bash", "edit", "write"].includes(tool));
	if (forbidden.length) issues.push(`reviewer has forbidden tools: ${forbidden.join(", ")}`);
	const subagentOnlyExtensions = (reviewer.subagentOnlyExtensions ?? []).map((entry) => {
		const expanded = entry === "~" ? homedir() : entry.startsWith("~/") ? join(homedir(), entry.slice(2)) : entry;
		return isAbsolute(expanded) ? expanded : resolve(project, expanded);
	});
	const entries = subagentOnlyExtensions.filter((entry) => basename(entry) === "reviewer-git.ts");
	if (!entries.some((entry) => existsSync(entry) && statSync(entry).isFile())) {
		issues.push(`reviewer-git.ts extension missing or does not exist: ${entries.join(", ") || "(not configured)"}`);
	}
	return { tools, subagentOnlyExtensions, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv.length > 3) throw new Error("usage: node scripts/check-reviewer-config.mjs [cwd]");
		const result = await checkReviewerConfig(process.argv[2]);
		console.log(`reviewer tools: ${result.tools.join(", ")}`);
		console.log(`subagentOnlyExtensions: ${result.subagentOnlyExtensions.join(", ") || "(none)"}`);
		if (result.issues.length) {
			for (const issue of result.issues) console.error(issue);
			process.exitCode = 1;
		} else console.log("reviewer configuration: ok");
	} catch (error) {
		console.error(`reviewer configuration check failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

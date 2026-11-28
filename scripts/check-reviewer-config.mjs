import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const expectedTools = ["read", "grep", "find", "ls", "watchdog_diff", "contact_supervisor", "git_review"];

async function publicPreflight(root) {
	const requireFromSubagents = createRequire(join(root, "noop.js"));
	return import(requireFromSubagents.resolve("pi-subagents/preflight"));
}

export async function checkReviewerConfig(cwd = process.cwd(), options = {}) {
	const root = options.piSubagentsDir ?? process.env.PI_SUBAGENTS_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents");
	const { resolveSubagentLaunchContract } = await publicPreflight(root);
	const project = resolve(cwd);
	const result = await resolveSubagentLaunchContract({
		agent: "reviewer",
		cwd: project,
		task: "reviewer configuration probe",
		context: "fresh",
		intercomBridge: { mode: "off" },
	});
	if (!result.ok) return { tools: [], subagentOnlyExtensions: [], issues: [`reviewer agent not found: ${result.code}${result.message ? ` (${result.message})` : ""}`] };
	const tools = result.contract.tools.effectiveAllowlist;
	const issues = [];
	if (!result.contract.tools.explicitAllowlist || tools.length !== expectedTools.length || expectedTools.some((tool) => !tools.includes(tool))) {
		issues.push(`reviewer tools must equal ${expectedTools.join(", ")}; effective: ${tools.join(", ") || "(none)"}`);
	}
	const forbidden = tools.filter((tool) => ["bash", "edit", "write"].includes(tool));
	if (forbidden.length) issues.push(`reviewer has forbidden tools: ${forbidden.join(", ")}`);
	// Public preflight reports the child extensions after settings and frontmatter are merged;
	// it intentionally does not expose which layer supplied each entry.
	const subagentOnlyExtensions = result.contract.tools.configuredExtensions.map((entry) => {
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

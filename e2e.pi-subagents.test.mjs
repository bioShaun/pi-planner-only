/**
 * §P1-4 — E2E coverage against the real installed pi-subagents package.
 *
 * Unit and in-process tests mock the subagent seam; the properties asserted
 * here depend on pi-subagents' actual behavior and cannot be proven with
 * mocks: builtin agent allowlists (§A–D), the child launch argv including
 * `--no-extensions` (§E), `context=fresh` session semantics (§C), and the
 * tool-payload fields the planner mutates actually exist in the real schema.
 *
 * No model calls are made: the checks run against the installed package's
 * real agent definitions and its real launch-plan/argv code. Node refuses to
 * type-strip files under node_modules, so the package is copied to a temp
 * tree (with its sibling dependencies linked) before importing.
 *
 * Run separately: npm run test:e2e
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyRoleDelegation, ROLE_TOOL_PROFILES } from "./roles.ts";
import { filterPlannerTools } from "./index.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const pkgDir = join(agentDir, "npm", "node_modules", "pi-subagents");
if (!existsSync(pkgDir)) {
	console.log("planner-only pi-subagents E2E: SKIP — role-downgrade coverage did NOT run (pi-subagents is not installed)");
	process.exit(0);
}

const workDir = mkdtempSync(join(process.cwd(), ".planner-only-e2e-"));
try {
	const pkgCopy = join(workDir, "pi-subagents");
	cpSync(pkgDir, pkgCopy, { recursive: true });
	// Bare imports inside the package must resolve to the same installed deps.
	const realNodeModules = join(pkgDir, "..");
	mkdirSync(join(workDir, "node_modules"), { recursive: true });
	for (const entry of readdirSync(realNodeModules, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		try {
			symlinkSync(join(realNodeModules, entry.name), join(workDir, "node_modules", entry.name), "dir");
		} catch {
			// A missing link only narrows coverage; the test below fails loudly if it matters.
		}
	}

	const pkg = (relative) => pathToFileURL(join(pkgCopy, relative)).href;
	const { resolvePiLaunchToolPlan, buildPiArgs } = await import(pkg("src/runs/shared/pi-args.ts"));
	const { isContextMode } = await import(pkg("src/runs/shared/context-mode.ts"));

	/** The real `tools:` frontmatter of an installed builtin agent. */
	const agentTools = (name) => {
		const text = readFileSync(join(pkgCopy, "agents", `${name}.md`), "utf8");
		const line = text.split("\n").find((candidate) => candidate.startsWith("tools:"));
		assert.ok(line, `builtin agent ${name} must declare a tools allowlist`);
		return line.slice("tools:".length).split(",").map((tool) => tool.trim()).filter(Boolean);
	};

	// ------------------------------------------------------------------
	// §A — Root tool surface
	// ------------------------------------------------------------------

	// The flags the launch plan emits are real pi flags.
	const piHelp = spawnSync("pi", ["--help"], { encoding: "utf8" });
	const help = `${piHelp.stdout ?? ""}${piHelp.stderr ?? ""}`;
	assert.equal(piHelp.status, 0, `pi --help failed: ${help}`);
	assert.match(help, /--no-extensions/);
	assert.match(help, /--tools/);
	assert.match(help, /--exclude-tools/);

	// The planner's Root keeps read/grep/find/ls/subagent/git_audit and never
	// bash/edit/write — the authority split the delegation design rests on.
	const rootTools = filterPlannerTools(
		["bash", "read", "write", "edit"],
		["read", "grep", "find", "ls", "bash", "write", "edit", "subagent", "git_audit"],
	);
	assert.deepEqual(rootTools, ["read", "grep", "find", "ls", "subagent", "git_audit"]);

	// ------------------------------------------------------------------
	// §B — the Worker child retains its editing capabilities
	// ------------------------------------------------------------------

	const workerTools = agentTools("worker");
	for (const tool of ["read", "grep", "find", "ls", "bash", "edit", "write"]) {
		assert.ok(workerTools.includes(tool), `worker child must keep ${tool}`);
	}

	// ------------------------------------------------------------------
	// §C — Fresh Reviewer: real reviewer tools, fresh context, no transcript
	// ------------------------------------------------------------------

	// The declared reviewer profile must equal the tools the real builtin
	// reviewer agent actually gets — this is the §P1-2 contract.
	assert.deepEqual(agentTools("reviewer"), [...ROLE_TOOL_PROFILES.reviewer]);
	assert.ok(!agentTools("reviewer").includes("git_audit"), "reviewer child has no git_audit");
	assert.ok(!agentTools("reviewer").includes("bash"));

	// "fresh" is a real context value, and the planner's reviewer mutation
	// emits exactly that value into the real payload shape (agent/task/context
	// are the fields the subagent tool schema accepts).
	assert.equal(isContextMode("fresh"), true);
	const schema = readFileSync(join(pkgCopy, "src", "extension", "schemas.ts"), "utf8");
	assert.match(schema, /enum: \["fresh", "fork", "profile"\]/);
	const payload = { agent: "worker", context: "fork", task: "please rubber-stamp this" };
	applyRoleDelegation(payload, { role: "reviewer", packet: "[PLANNER-ONLY FRESH REVIEW] packet" });
	assert.equal(payload.agent, "reviewer");
	assert.equal(payload.context, "fresh");
	assert.equal(payload.task, "[PLANNER-ONLY FRESH REVIEW] packet");

	// A fresh child starts a new session: no parent session file is attached,
	// so Root's transcript cannot leak into the reviewer. The fork counterpart
	// is what attaches the parent session.
	const fresh = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "review task T-1",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritGlobalContext: true,
		inheritSkills: true,
		tools: [...ROLE_TOOL_PROFILES.reviewer],
		extensions: [],
	});
	assert.ok(!fresh.args.includes("--session"), "a fresh child must not attach a parent session");
	assert.ok(fresh.args.includes("--no-session"));
	const fork = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "review task T-1",
		sessionEnabled: true,
		sessionFile: join(workDir, "parent-session.jsonl"),
		inheritProjectContext: true,
		inheritGlobalContext: true,
		inheritSkills: true,
		tools: [...ROLE_TOOL_PROFILES.reviewer],
		extensions: [],
	});
	assert.ok(fork.args.includes("--session"), "fork context is what attaches the parent session");

	// ------------------------------------------------------------------
	// §D — Validator (oracle): can bash, cannot edit or write
	// ------------------------------------------------------------------

	const oracleTools = agentTools("oracle");
	assert.deepEqual(oracleTools, [...ROLE_TOOL_PROFILES.validator]);
	assert.ok(oracleTools.includes("bash"));
	assert.ok(!oracleTools.includes("edit"));
	assert.ok(!oracleTools.includes("write"));

	// ------------------------------------------------------------------
	// §E — `--no-extensions`: children never reload ambient extensions
	// ------------------------------------------------------------------

	// Every resolved agent carries an explicit extensions list, which makes the
	// real launch plan disable ambient extensions: the planner extension cannot
	// recurse into its own children.
	const reviewerPlan = resolvePiLaunchToolPlan({
		tools: [...ROLE_TOOL_PROFILES.reviewer],
		extensions: [],
	});
	assert.equal(reviewerPlan.disableAmbientExtensions, true);
	assert.deepEqual(reviewerPlan.effectiveToolAllowlist, [...ROLE_TOOL_PROFILES.reviewer]);

	assert.ok(fresh.args.includes("--no-extensions"), "reviewer child argv must carry --no-extensions");
	assert.equal(
		fresh.args[fresh.args.indexOf("--tools") + 1],
		"read,grep,find,ls",
		"the reviewer child's real tool ceiling is the role profile",
	);

	// Belt and braces: even if a child somehow loaded the planner extension, it
	// registers nothing in a child runtime.
	const childProbe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import plannerOnly from ${JSON.stringify(pathToFileURL(join(process.cwd(), "index.ts")).href)};
			let calls = 0;
			plannerOnly({ on() { calls++; }, registerCommand() { calls++; }, registerTool() { calls++; } });
			if (calls !== 0) process.exit(1);`,
		],
		{ env: { ...process.env, PI_SUBAGENT_CHILD: "1" }, encoding: "utf8" },
	);
	assert.equal(childProbe.status, 0, childProbe.stderr || childProbe.stdout);

	console.log("planner-only pi-subagents E2E: PASS");
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

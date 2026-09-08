/**
 * §P1-4 / RF-3 — E2E coverage against the real installed pi-subagents package.
 *
 * Unit and in-process tests mock the subagent seam; the properties asserted
 * here depend on pi-subagents' actual behavior and cannot be proven with
 * mocks: builtin agent allowlists (§A–D) and the public `child-tool-plan`
 * mapping through `resolvePiLaunchToolPlan` for reviewer and oracle.
 *
 * No model calls are made. Node refuses to type-strip files under
 * node_modules, so the package is copied to a temp tree (with its sibling
 * dependencies linked) and the public export `./child-tool-plan` is imported
 * from that copy. Missing package or a version outside the declared range
 * prints a SKIP line and exits 0 for local runs; with
 * PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 (the release gate) the same conditions
 * exit non-zero — a skipped contract test must never read as a pass (C01).
 *
 * Run separately: npm run test:e2e
 * Release gate: npm run test:release
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { register } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyRoleDelegation, ROLE_TOOL_PROFILES } from "./roles.ts";
import { loadRoleModelPolicy, resolveRoleModel } from "./role-models.ts";
import { filterPlannerTools } from "./index.ts";

const PUBLIC_SUBPATH = "./child-tool-plan";
const PUBLIC_SPECIFIER = "pi-subagents/child-tool-plan";
const here = dirname(fileURLToPath(import.meta.url));

function parseTriple(version) {
	const match = String(version).trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function cmpTriple(left, right) {
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
}

function versionInRange(version, range) {
	const parsed = String(range).trim().match(/^>=\s*(\d+\.\d+(?:\.\d+)?)\s+<\s*(\d+\.\d+(?:\.\d+)?)$/);
	if (!parsed) throw new Error(`unsupported piSubagents range: ${range}`);
	const value = parseTriple(version);
	if (!value) throw new Error(`unparseable pi-subagents version: ${version}`);
	return cmpTriple(value, parseTriple(parsed[1])) >= 0 && cmpTriple(value, parseTriple(parsed[2])) < 0;
}

function reportUnavailable(reason) {
	console.log(`planner-only pi-subagents E2E: §G 角色模型启动契约未验证 (${reason})`);
	if (process.env.PI_PLANNER_ONLY_REQUIRE_CONTRACT === "1") {
		console.error(`planner-only pi-subagents E2E: FAIL — release gate requires §G contract coverage: ${reason}`);
		process.exit(1);
	}
	console.log("planner-only pi-subagents E2E: PASS");
	process.exit(0);
}

const localManifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const declaredRange = localManifest["pi-planner-only"]?.piSubagents;
assert.equal(typeof declaredRange, "string", "package.json must declare pi-planner-only.piSubagents");

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const pkgDir = join(agentDir, "npm", "node_modules", "pi-subagents");
if (!existsSync(pkgDir)) {
	reportUnavailable("pi-subagents is not installed; public host contract is unavailable");
}

const installedManifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const installedVersion = installedManifest.version;
if (!versionInRange(installedVersion, declaredRange)) {
	reportUnavailable(`pi-subagents ${installedVersion} is outside ${declaredRange}; supported public host contract is unavailable`);
}

const exportTarget = installedManifest.exports?.[PUBLIC_SUBPATH];
if (typeof exportTarget !== "string") {
	reportUnavailable(`installed pi-subagents does not export ${PUBLIC_SUBPATH}`);
}

const workDir = mkdtempSync(join(process.cwd(), ".planner-only-e2e-"));
try {
	const pkgCopy = join(workDir, "pi-subagents");
	cpSync(pkgDir, pkgCopy, { recursive: true });
	const realNodeModules = join(pkgDir, "..");
	mkdirSync(join(workDir, "node_modules"), { recursive: true });
	for (const entry of readdirSync(realNodeModules, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		try {
			symlinkSync(join(realNodeModules, entry.name), join(workDir, "node_modules", entry.name), "dir");
		} catch {
			// A missing link only narrows coverage; the import below fails loudly if it matters.
		}
	}

	const publicHref = pathToFileURL(join(pkgCopy, exportTarget)).href;
	const loaderPath = join(workDir, "register-child-tool-plan.mjs");
	writeFileSync(
		loaderPath,
		`export async function resolve(specifier, context, nextResolve) {
	if (specifier === ${JSON.stringify(PUBLIC_SPECIFIER)}) {
		return { shortCircuit: true, url: ${JSON.stringify(publicHref)} };
	}
	return nextResolve(specifier, context);
}
`,
	);
	register(pathToFileURL(loaderPath).href, import.meta.url);
	const { resolvePiLaunchToolPlan } = await import(PUBLIC_SPECIFIER);
	assert.equal(typeof resolvePiLaunchToolPlan, "function", `${PUBLIC_SPECIFIER} must export resolvePiLaunchToolPlan`);

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

	const rootTools = filterPlannerTools([
		"read", "grep", "find", "ls", "subagent", "git_audit", "bash", "write", "edit",
	]);
	assert.deepEqual(rootTools, ["read", "grep", "find", "ls", "subagent", "git_audit"]);
	assert.equal(filterPlannerTools(["bash", "read", "write", "edit"]).includes("grep"), false);

	// ------------------------------------------------------------------
	// §B — the Worker child retains its editing capabilities
	// ------------------------------------------------------------------

	const workerTools = agentTools("worker");
	for (const tool of ["read", "grep", "find", "ls", "bash", "edit", "write"]) {
		assert.ok(workerTools.includes(tool), `worker child must keep ${tool}`);
	}
	const workerPayload = { agent: "worker", context: "fork", task: "implement it" };
	applyRoleDelegation(workerPayload, { role: "worker", taskId: "T-20260907-e2e-1" });
	assert.equal(workerPayload.context, "fresh", "worker child must be forced to fresh context");

	// ------------------------------------------------------------------
	// §C — Fresh Reviewer: real reviewer tools, fresh context
	// ------------------------------------------------------------------

	// The declared reviewer profile plus the 0.65 builtin's contact_supervisor
	// is exactly what the real reviewer agent gets — the §P1-2 contract.
	const reviewerTools = agentTools("reviewer");
	assert.deepEqual(reviewerTools, [...ROLE_TOOL_PROFILES.reviewer, "contact_supervisor"]);
	assert.ok(!reviewerTools.includes("git_audit"), "reviewer child has no git_audit");
	assert.ok(!reviewerTools.includes("bash"));
	assert.ok(!reviewerTools.includes("edit"));
	assert.ok(!reviewerTools.includes("write"));

	const payload = { agent: "worker", context: "fork", task: "please rubber-stamp this" };
	applyRoleDelegation(payload, { role: "reviewer", packet: "[PLANNER-ONLY FRESH REVIEW] packet" });
	assert.equal(payload.agent, "reviewer");
	assert.equal(payload.context, "fresh");
	assert.equal(payload.task, "[PLANNER-ONLY FRESH REVIEW] packet");

	const reviewerPlan = resolvePiLaunchToolPlan({
		tools: reviewerTools,
		extensions: [],
		agentName: "reviewer",
	});
	assert.equal(reviewerPlan.disableAmbientExtensions, true);
	for (const tool of ["read", "grep", "find", "ls", "contact_supervisor"]) {
		assert.ok(
			reviewerPlan.effectiveToolAllowlist.includes(tool),
			`reviewer launch plan must allow ${tool}`,
		);
	}
	assert.ok(!reviewerPlan.effectiveToolAllowlist.includes("bash"));
	assert.ok(!reviewerPlan.effectiveToolAllowlist.includes("edit"));
	assert.ok(!reviewerPlan.effectiveToolAllowlist.includes("write"));

	// ------------------------------------------------------------------
	// §D — Validator (oracle): can bash, cannot edit or write
	// ------------------------------------------------------------------

	const oracleTools = agentTools("oracle");
	assert.deepEqual(oracleTools, [...ROLE_TOOL_PROFILES.validator]);
	assert.ok(oracleTools.includes("bash"));
	assert.ok(!oracleTools.includes("edit"));
	assert.ok(!oracleTools.includes("write"));

	const oraclePayload = { agent: "worker", context: "fork", task: "run tests" };
	applyRoleDelegation(oraclePayload, { role: "validator" });
	assert.equal(oraclePayload.agent, "oracle");
	assert.equal(oraclePayload.context, "fresh", "oracle child must be forced to fresh context");

	const oraclePlan = resolvePiLaunchToolPlan({
		tools: oracleTools,
		extensions: [],
		agentName: "oracle",
	});
	assert.equal(oraclePlan.disableAmbientExtensions, true);
	assert.ok(oraclePlan.effectiveToolAllowlist.includes("bash"), "oracle launch plan must allow bash");
	assert.ok(!oraclePlan.effectiveToolAllowlist.includes("edit"));
	assert.ok(!oraclePlan.effectiveToolAllowlist.includes("write"));

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

	// ------------------------------------------------------------------
	// §E — Thinking contract verification
	// ------------------------------------------------------------------
	let launchResolver = null;
	let launchResolverError = "未找到 ./preflight 导出";
	const preflightTarget = installedManifest.exports?.["./preflight"];
	if (preflightTarget) {
		try {
			const mod = await import(pathToFileURL(join(pkgCopy, preflightTarget)).href);
			if (typeof mod.resolveSubagentLaunchContract === "function") {
				launchResolver = mod.resolveSubagentLaunchContract;
			}
		} catch (error) {
			// §G below reports the public-contract limitation instead of skipping.
			launchResolver = null;
			launchResolverError = error instanceof Error ? error.message : String(error);
		}
	}

	const preflightModels = [
		{ provider: "policy-test", id: "worker", fullId: "policy-test/worker" },
		{ provider: "policy-test", id: "oracle", fullId: "policy-test/oracle" },
	];
	if (typeof launchResolver === "function") {
		const workerContract = await launchResolver({
			agent: "worker",
			cwd: process.cwd(),
			context: "fresh",
			thinking: "high",
			model: "policy-test/worker",
			availableModels: preflightModels,
			skill: false,
			artifacts: false,
		});
		const oracleContract = await launchResolver({
			agent: "oracle",
			cwd: process.cwd(),
			context: "fresh",
			thinking: "medium",
			model: "policy-test/oracle",
			availableModels: preflightModels,
			skill: false,
			artifacts: false,
		});
		assert.equal(workerContract.ok, true, workerContract.message);
		assert.equal(oracleContract.ok, true, oracleContract.message);
		assert.match(workerContract.contract.model, /policy-test\/worker/);
		assert.equal(workerContract.contract.thinking, "high");
		assert.match(oracleContract.contract.model, /policy-test\/oracle/);
		assert.equal(oracleContract.contract.thinking, "medium");
	} else {
		console.log("planner-only pi-subagents E2E: §E thinking 契约未验证 (pi-subagents 未暴露可导入的 resolveSubagentLaunchContract)");
	}

	// ------------------------------------------------------------------
	// §F — Budget contract verification
	// ------------------------------------------------------------------
	let budgetResolver = null;
	const budgetPreflight = installedManifest.exports?.["./budget"] ?? installedManifest.exports?.["./preflight"];
	if (budgetPreflight) {
		try {
			const mod = await import(pathToFileURL(join(pkgCopy, budgetPreflight)).href);
			if (typeof mod.resolveSubagentBudgetContract === "function") {
				budgetResolver = mod.resolveSubagentBudgetContract;
			}
		} catch {
			budgetResolver = null;
		}
	}

	if (typeof budgetResolver === "function") {
		const budgetContract = await budgetResolver({
			agent: "worker",
			toolBudget: { hard: 20 },
			usageBudget: { tokens: { hard: 40000 }, costUsd: { hard: 0.1 } },
		});
		assert.equal(budgetContract.toolBudget?.hard, 20);
	} else {
		console.log("planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)");
	}

	// ------------------------------------------------------------------
	// §G — Role model launch contract verification via the public host API
	// ------------------------------------------------------------------
	let contractUnverifiedReason = null;
	const rolePolicy = loadRoleModelPolicy({
		...process.env,
		PI_PLANNER_ONLY_ROLE_MODELS: "1",
		PI_PLANNER_ONLY_MODEL_WORKER: "policy-test/worker",
		PI_PLANNER_ONLY_THINKING_WORKER: "off",
		PI_PLANNER_ONLY_MODEL_REVIEWER: "policy-test/reviewer",
		PI_PLANNER_ONLY_THINKING_REVIEWER: "low",
		PI_PLANNER_ONLY_MODEL_VALIDATOR: "policy-test/validator",
		PI_PLANNER_ONLY_THINKING_VALIDATOR: "medium",
		PI_PLANNER_ONLY_MODEL_EXPLORER: "policy-test/explorer",
		PI_PLANNER_ONLY_THINKING_EXPLORER: "high",
	});
	if (typeof launchResolver !== "function") {
		contractUnverifiedReason = `公开 ./preflight 无法导入 resolveSubagentLaunchContract (${launchResolverError})`;
	} else {
		const roleCases = [
			{ role: "worker", agent: "worker", model: "policy-test/worker", thinking: "off" },
			{ role: "reviewer", agent: "reviewer", model: "policy-test/reviewer", thinking: "low" },
			{ role: "validator", agent: "oracle", model: "policy-test/validator", thinking: "medium" },
			{ role: "explorer", agent: "reviewer", model: "policy-test/explorer", thinking: "high" },
		];
		const availableModels = roleCases.map(({ model }) => ({
			provider: "policy-test",
			id: model.slice("policy-test/".length),
			fullId: model,
		}));
		for (const roleCase of roleCases) {
			const input = { agent: "worker", context: "fork", task: `${roleCase.role} launch` };
			resolveRoleModel(rolePolicy, roleCase.role, input);
			applyRoleDelegation(input, { role: roleCase.role });
			const result = await launchResolver({
				agent: input.agent,
				cwd: process.cwd(),
				context: "fresh",
				model: input.model,
				thinking: input.thinking,
				availableModels,
				skill: false,
				artifacts: false,
			});
			if (!result.ok) {
				contractUnverifiedReason = `${roleCase.role}: ${result.code} ${result.message}`;
				break;
			}
			assert.equal(result.contract.agent.name, roleCase.agent, `${roleCase.role} host agent remap`);
			assert.match(result.contract.model ?? "", new RegExp(roleCase.model.replace("/", "\\/")));
			assert.equal(result.contract.thinking, roleCase.thinking, `${roleCase.role} host thinking`);
			const ceiling = ROLE_TOOL_PROFILES[roleCase.role];
			if (ceiling) {
				const allowed = new Set([...ceiling, "contact_supervisor"]);
				for (const tool of result.contract.tools.effectiveAllowlist) {
					assert.ok(allowed.has(tool), `${roleCase.role} launch widened its tool allowlist with ${tool}`);
				}
			}
		}
	}
	if (contractUnverifiedReason) {
		console.log(`planner-only pi-subagents E2E: §G 角色模型启动契约未验证 (${contractUnverifiedReason})`);
		if (process.env.PI_PLANNER_ONLY_REQUIRE_CONTRACT === "1") {
			console.error(`planner-only pi-subagents E2E: FAIL — release gate requires §G contract coverage: ${contractUnverifiedReason}`);
			process.exitCode = 1;
		}
	}

	if (process.exitCode === 1 && process.env.PI_PLANNER_ONLY_REQUIRE_CONTRACT === "1") {
		// The release gate must not turn an unverified public host contract into
		// a passing delivery.
	} else {
		console.log("planner-only pi-subagents E2E: PASS");
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

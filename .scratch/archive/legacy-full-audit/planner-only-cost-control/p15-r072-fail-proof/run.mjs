import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const goodDir = join(here, "good");
mkdirSync(goodDir, { recursive: true });

const files = {
	floors: join(root, "floors.ts"),
	orchestrate: join(root, "orchestrate.ts"),
	architecture: join(root, "architecture.test.mjs"),
};

function restore() {
	copyFileSync(join(goodDir, "floors.ts"), files.floors);
	copyFileSync(join(goodDir, "orchestrate.ts"), files.orchestrate);
	copyFileSync(join(goodDir, "architecture.test.mjs"), files.architecture);
}

function replaceOnce(path, oldString, newString, label) {
	const before = readFileSync(path, "utf8");
	const count = before.split(oldString).length - 1;
	assert.equal(count, 1, `${label}: expected exactly one occurrence of old_string in ${path}`);
	writeFileSync(path, before.replace(oldString, newString));
}

function runTest(file) {
	return spawnSync("node", ["--experimental-strip-types", file], {
		cwd: root,
		encoding: "utf8",
		env: process.env,
	});
}

copyFileSync(files.floors, join(goodDir, "floors.ts"));
copyFileSync(files.orchestrate, join(goodDir, "orchestrate.ts"));
copyFileSync(files.architecture, join(goodDir, "architecture.test.mjs"));

const cases = [
	{
		id: "W1",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: "	if (raw === undefined) return fallback;",
		newString: "	if (raw === undefined) return true;",
	},
	{
		id: "W2",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: "		costUsd: readEnforcementFlag(env[HOST_ENFORCEMENT_ENV_VARS.COST_USD], HOST_ENFORCEMENT_ENV_VARS.COST_USD, DEFAULT_HOST_ENFORCEMENT.costUsd),",
		newString: "		costUsd: readEnforcementFlag(env[HOST_ENFORCEMENT_ENV_VARS.TOKENS], HOST_ENFORCEMENT_ENV_VARS.TOKENS, DEFAULT_HOST_ENFORCEMENT.costUsd),",
	},
	{
		id: "W3",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: '	if (value === "0") return false;',
		newString: '	if (value === "0") return true;',
	},
	{
		id: "W4",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: `	if (value === "") {
		throw new Error(
			\`Host enforcement configuration error: \${envVar} is set but empty; must be 1 or 0.\`,
		);
	}`,
		newString: `	if (value === "") {
		return false;
	}`,
	},
	{
		id: "W5",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: `	throw new Error(
		\`Host enforcement configuration error: \${envVar}="\${raw}" is invalid; must be 1 or 0.\`,
	);`,
		newString: "	return true;",
	},
	{
		id: "W6",
		file: files.floors,
		test: "floors.test.mjs",
		oldString: `export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object.freeze({
	tokens: false,
	costUsd: false,
});`,
		newString: `export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = {
	tokens: false,
	costUsd: false,
};`,
	},
	{
		id: "W7",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: `			const enforcementNote = (enforced: boolean): string =>
				enforced ? "；宿主在上限处强制停止" : "；宿主未强制该维度，仅事后观测";`,
		newString: `			const enforcementNote = (enforced: boolean): string =>
				enforced ? "；宿主在上限处强制停止" : "";`,
	},
	{
		id: "W8",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: `			const enforcementNote = (enforced: boolean): string =>
				enforced ? "；宿主在上限处强制停止" : "；宿主未强制该维度，仅事后观测";`,
		newString: `			const enforcementNote = (enforced: boolean): string =>
				enforced ? "；宿主未强制该维度，仅事后观测" : "；宿主未强制该维度，仅事后观测";`,
	},
	{
		id: "W9",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: `				if (budget.tokens.limit !== undefined) {
					lines.push(dimensionLine("tokens", budget.tokens, (value) => String(value)) + enforcementNote(enforcement.tokens));
				} else {
					lines.push(dimensionLine("tokens", budget.tokens, (value) => String(value)));
				}`,
		newString: `				lines.push(dimensionLine("tokens", budget.tokens, (value) => String(value)) + enforcementNote(enforcement.tokens));`,
	},
	{
		id: "W10",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: "已计入 tokens=${budget.byRole.root?.tokens ?? 0}、费用 ${money(budget.byRole.root?.costUsd ?? 0)}",
		newString: "已计入 tokens=${budget.tokens.known}、费用 ${money(budget.costUsd.known)}",
	},
	{
		id: "W11",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: '+ (overspent.length > 0 ? `；当前${overspent.join("、")}` : ""),',
		newString: '+ (overspent.length > 0 ? `；当前 ${overspent.join("、")}` : ""),',
	},
	{
		id: "W12",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: '+ (overspent.length > 0 ? `；当前${overspent.join("、")}` : ""),',
		newString: '+ (overspent.length > 0 ? `；当前${overspent.join("，")}` : ""),',
	},
	{
		id: "W13",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: `			if (!budget.configured) {
				lines.push(\`Budget: 未设累计上限（已知消耗 tokens=\${budget.tokens.known}，费用 \${money(budget.costUsd.known)}；未知项 tokens \${budget.tokens.unknownParts} 项、费用 \${budget.costUsd.unknownParts} 项）\`);
			} else {`,
		newString: `			if (!budget.configured) {
				lines.push(\`Budget: 未设累计上限（已知消耗 tokens=\${budget.tokens.known}，费用 \${money(budget.costUsd.known)}；未知项 tokens \${budget.tokens.unknownParts} 项、费用 \${budget.costUsd.unknownParts} 项）\`);
				lines.push(\`  Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=0、费用 $0.0000）\`);
			} else {`,
	},
	{
		id: "W14",
		file: files.orchestrate,
		test: "orchestrate.test.mjs",
		oldString: "剩余 ${format(dimension.remaining ?? 0)}",
		newString: "还剩 ${format(dimension.remaining ?? 0)}",
	},
	{
		id: "W15",
		file: files.floors,
		test: "architecture.test.mjs",
		oldString: `export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object.freeze({
	tokens: false,
	costUsd: false,
});`,
		newString: `export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object.freeze({
	tokens: true,
	costUsd: false,
});`,
	},
	{
		id: "W16",
		file: files.floors,
		test: "architecture.test.mjs",
		oldString: 'export interface HostEnforcement {\n	readonly tokens: boolean;\n	readonly costUsd: boolean;\n}',
		newString: 'export interface HostEnforcement {\n	readonly tokens: boolean;\n	readonly costUsd: boolean;\n}\nimport { unused } from "./index.ts";',
	},
];

const summary = [];
try {
	for (const item of cases) {
		restore();
		replaceOnce(item.file, item.oldString, item.newString, item.id);
		const result = runTest(item.test);
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		const logPath = join(root, `.scratch/planner-only-cost-control/p15-r072-${item.id}-fail.log`);
		writeFileSync(logPath, output);
		const failed = result.status !== 0;
		summary.push({
			id: item.id,
			failed,
			status: result.status,
			logPath,
			head: output.trim().split("\n").slice(-20).join("\n"),
		});
		if (!failed) {
			console.error(`${item.id} DID NOT FAIL`);
		} else {
			console.log(`${item.id} failed as required (exit ${result.status})`);
		}
	}
} finally {
	restore();
}

const floorsGood = readFileSync(join(goodDir, "floors.ts"), "utf8");
const orchGood = readFileSync(join(goodDir, "orchestrate.ts"), "utf8");
const archGood = readFileSync(join(goodDir, "architecture.test.mjs"), "utf8");
assert.equal(readFileSync(files.floors, "utf8"), floorsGood, "floors.ts restored");
assert.equal(readFileSync(files.orchestrate, "utf8"), orchGood, "orchestrate.ts restored");
assert.equal(readFileSync(files.architecture, "utf8"), archGood, "architecture.test.mjs restored");

const missed = summary.filter((item) => !item.failed).map((item) => item.id);
writeFileSync(join(here, "summary.json"), JSON.stringify(summary, null, 2));
if (missed.length > 0) {
	console.error(`these cases stayed green: ${missed.join(", ")}`);
	process.exit(1);
}
console.log("all 16 cases failed independently and sources were restored");

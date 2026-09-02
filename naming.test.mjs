import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const repoDir = resolve(new URL(".", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
const tsFiles = readdirSync(repoDir).filter((name) => extname(name) === ".ts");

assert.equal(pkg.name, "pi-planner-only");
assert.ok(tsFiles.includes("index.ts"));

const candidates = [
	process.env.PI_PLANNER_ONLY_EXTENSION_PATH
		? dirname(process.env.PI_PLANNER_ONLY_EXTENSION_PATH)
		: undefined,
	join(homedir(), ".pi", "agent", "git", "github.com", "bioShaun", "pi-planner-only"),
	join(homedir(), ".pi", "agent", "extensions", "pi-planner-only"),
].filter((path) => typeof path === "string");

const installDir = candidates.find((path) => existsSync(join(path, "index.ts")));
if (installDir) {
	assert.equal(basename(installDir), "pi-planner-only");
	const installed = new Set(readdirSync(installDir));
	for (const name of tsFiles) {
		assert.equal(installed.has(name), true, `extension install is missing ${name}`);
	}
}

console.log("planner-only naming: PASS");

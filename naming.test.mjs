import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const repoDir = resolve(new URL(".", import.meta.url).pathname);
const candidates = [
	process.env.PI_PLANNER_ONLY_EXTENSION_PATH
		? dirname(process.env.PI_PLANNER_ONLY_EXTENSION_PATH)
		: undefined,
	join(homedir(), ".pi", "agent", "git", "github.com", "bioShaun", "pi-planner-only"),
	join(homedir(), ".pi", "agent", "extensions", "pi-planner-only"),
].filter((path) => typeof path === "string");

const installDir = candidates.find((path) => existsSync(join(path, "index.ts")));
assert.ok(
	installDir,
	"pi-planner-only is not installed. Run: pi install https://github.com/bioShaun/pi-planner-only",
);
assert.equal(basename(installDir), "pi-planner-only");

const installed = new Set(readdirSync(installDir));
for (const name of readdirSync(repoDir)) {
	if (extname(name) !== ".ts") continue;
	assert.equal(installed.has(name), true, `extension install is missing ${name}`);
}

console.log("planner-only naming: PASS");

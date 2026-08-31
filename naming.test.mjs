import assert from "node:assert/strict";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";

const installEntry = process.env.PI_PLANNER_ONLY_EXTENSION_PATH ??
	join(homedir(), ".pi", "agent", "extensions", "pi-planner-only", "index.ts");
const expectedRepoEntry = resolve(new URL("./index.ts", import.meta.url).pathname);

assert.equal(basename(dirname(installEntry)), "pi-planner-only");
assert.equal(realpathSync(installEntry), expectedRepoEntry);

console.log("planner-only naming: PASS");

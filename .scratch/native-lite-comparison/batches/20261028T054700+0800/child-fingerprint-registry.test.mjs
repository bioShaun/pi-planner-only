import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const batchId = "20261028T054700+0800";
const wrapper = process.env.PI_NATIVE_LITE_CHILD_WRAPPER ?? resolve(new URL("./required-child-extensions-wrapper.mjs", import.meta.url).pathname);
const fingerprint = resolve(new URL("./request-fingerprint.ts", import.meta.url).pathname);

test("required child registry includes mandatory guard and request fingerprint observer", async () => {
	const source = `
import { pathToFileURL } from "node:url";
const wrapper = await import(pathToFileURL(process.env.PI_NATIVE_LITE_CHILD_WRAPPER).href);
wrapper.registerRequiredChildExtensions({ sessionId: "registry-probe", extensions: [{ id: "native-lite-budget-guard", path: ${JSON.stringify(resolve(new URL("./budget-guard.ts", import.meta.url).pathname))} }], requireForAllRunners: true });
const { resolveRequiredChildExtensions } = await import("/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/bundle/chunk-CTPAE36Y.js");
process.stdout.write(JSON.stringify(resolveRequiredChildExtensions("registry-probe")));
`;
	const env = { ...process.env, PI_NATIVE_LITE_CHILD_WRAPPER: wrapper };
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	const exitCode = await new Promise((resolveExit, reject) => {
		child.once("error", reject);
		child.once("close", resolveExit);
	});
	assert.equal(exitCode, 0, stderr);
	const entries = JSON.parse(stdout);
	assert.deepEqual(entries.map((entry) => entry.id), ["native-lite-budget-guard", "native-lite-request-fingerprint"]);
	assert.ok(entries.every((entry) => entry.requireForAllRunners === true));
	assert.equal(entries[1].path, fingerprint);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const batchId = "20261028T054700+0800";
const root = process.env.PI_NATIVE_LITE_TEST_TMP ?? `/project/tmp/pi-native-lite-${batchId}/tmp`;
const extension = process.env.PI_NATIVE_LITE_FINGERPRINT_EXTENSION ?? resolve(new URL("./request-fingerprint.ts", import.meta.url).pathname);
await import("node:fs/promises").then(({ mkdir }) => mkdir(root, { recursive: true }));

function invoke(logPath) {
	const source = `
const { default: extension } = await import(${JSON.stringify(`file://${extension}`)});
const handlers = {};
extension({ on: (name, handler) => { handlers[name] = handler; } });
const payload = { model: "gpt-6.1-terra", instructions: "private system text", tools: [{ type: "function", name: "private-tool", description: "private tool schema" }], input: "private user content" };
await handlers.before_provider_request({ payload }, { model: { provider: "tcuni", id: payload.model }, sessionManager: { getSessionId: () => "probe-session" } });
`;
	const env = { ...process.env };
	delete env.PI_NATIVE_LITE_FINGERPRINT_LOG;
	if (logPath) env.PI_NATIVE_LITE_FINGERPRINT_LOG = logPath;
	return spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { env, stdio: ["ignore", "pipe", "pipe"] });
}

test("fingerprint observer records separate system, tools and full payload hashes without content", async () => {
	const dir = await mkdtemp(join(root, "fingerprint-test-"));
	const logPath = join(dir, "fingerprints.jsonl");
	try {
		const child = invoke(logPath);
		let stderr = "";
		child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
		const exitCode = await new Promise((resolveExit, reject) => {
			child.once("error", reject);
			child.once("close", resolveExit);
		});
		assert.equal(exitCode, 0, stderr);
		const content = await readFile(logPath, "utf8");
		const record = JSON.parse(content);
		const system = "private system text";
		const tools = [{ type: "function", name: "private-tool", description: "private tool schema" }];
		const payload = { model: "gpt-6.1-terra", instructions: system, tools, input: "private user content" };
		const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
		assert.equal(record.systemSha256, hash(system));
		assert.equal(record.toolsSha256, hash(tools));
		assert.equal(record.payloadSha256, hash(payload));
		assert.equal(record.sessionId, "probe-session");
		assert.equal(record.model, "gpt-6.1-terra");
		assert.equal(record.systemPresent, true);
		assert.equal(record.toolsPresent, true);
		for (const secret of [system, "private-tool", "private tool schema", "private user content"]) assert.ok(!content.includes(secret));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("fingerprint observer fails closed before transport when its log path is missing", async () => {
	const child = invoke(undefined);
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	const exitCode = await new Promise((resolveExit, reject) => {
		child.once("error", reject);
		child.once("close", resolveExit);
	});
	assert.equal(exitCode, 74);
	assert.match(stderr, /fingerprint identity or log path missing/);
});

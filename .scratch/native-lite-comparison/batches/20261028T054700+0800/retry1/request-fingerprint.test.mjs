import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const batchRoot = "/project/tmp/pi-native-lite-20261028T054700+0800";
const retryDir = resolve(new URL(".", import.meta.url).pathname);
const previousObserver = join(retryDir, "request-fingerprint.ts");
const tempRoot = process.env.TMPDIR ?? join(batchRoot, "tmp");

test("observer fingerprints system/developer items from the actual OpenAI Responses builder, not user input", async () => {
	const dir = await mkdtemp(join(tempRoot, "retry1-system-fingerprint-"));
	const logPath = join(dir, "fingerprints.jsonl");
	const observerPath = process.env.PI_RETRY1_OBSERVER_PATH ?? previousObserver;
	const transcriptModule = "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js";
	const responsesModule = "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
	const source = `
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const { default: observer } = await import(pathToFileURL(process.env.PI_RETRY1_OBSERVER_PATH).href);
const { normalizeContext } = await import(${JSON.stringify(`file://${transcriptModule}`)});
const { convertResponsesMessages, convertResponsesTools } = await import(${JSON.stringify(`file://${responsesModule}`)});
const system = "SYNTHETIC_SYSTEM_DO_NOT_LOG";
const user = "SYNTHETIC_USER_DO_NOT_TREAT_AS_SYSTEM";
const tool = { name: "lookup", description: "SYNTHETIC_TOOL_SCHEMA_DO_NOT_LOG", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } };
const model = { provider: "tcuni", api: "openai-responses", id: "gpt-6.1-terra", input: ["text"], reasoning: true, compat: { supportsDeveloperRole: true, supportsMidConvoSystemMessages: false, supportsAdditionalTools: false, supportsToolSearch: false, supportsStrictMode: true, supportsOpenAIGrammarTools: false } };
const context = normalizeContext({ systemPrompt: system, tools: [tool], messages: [{ role: "user", content: user }] });
const input = convertResponsesMessages(model, context, new Set(), { supportsMidConvoSystemMessages: false });
const tools = convertResponsesTools([tool], { supportsStrictMode: true, supportsOpenAIGrammarTools: false });
const payload = { model: model.id, input, tools, max_output_tokens: 16384 };
const inputSystem = input.filter(item => item?.role === "system" || item?.role === "developer");
const inputUser = input.filter(item => item?.role === "user");
const inputTools = input.filter(item => item?.type === "additional_tools" || item?.type === "tool_search_output");
const hash = value => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
const expectedSystemSha256 = hash({ instructions: null, inputSystemMessages: inputSystem });
const expectedToolsSha256 = hash({ tools, inputToolMessages: inputTools });
const handlers = {};
observer({ on: (name, handler) => { handlers[name] = handler; } });
await handlers.before_provider_request({ payload }, { model, sessionManager: { getSessionId: () => "retry1-probe-session" } });
process.stdout.write(JSON.stringify({ roles: input.map(item => item?.role).filter(Boolean), userCount: inputUser.length, systemCount: inputSystem.length, expectedSystemSha256, expectedToolsSha256 }));
`;
	const env = { ...process.env, PI_RETRY1_OBSERVER_PATH: observerPath, PI_NATIVE_LITE_FINGERPRINT_LOG: logPath };
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
	try {
		const exitCode = await new Promise((resolveExit, reject) => {
			child.once("error", reject);
			child.once("close", resolveExit);
		});
		assert.equal(exitCode, 0, stderr);
		const built = JSON.parse(stdout);
		const record = JSON.parse(await readFile(logPath, "utf8"));
		assert.ok(built.roles.includes("developer"), "actual builder must encode initial system prompt in developer input");
		assert.equal(built.userCount, 1);
		assert.ok(built.systemCount > 0);
		assert.equal(record.systemPresent, true, "system prompt may be in input when instructions field is absent");
		assert.equal(record.systemSha256, built.expectedSystemSha256);
		assert.equal(record.toolsPresent, true);
		assert.equal(record.toolsSha256, built.expectedToolsSha256);
		const raw = await readFile(logPath, "utf8");
		for (const secret of ["SYNTHETIC_SYSTEM_DO_NOT_LOG", "SYNTHETIC_USER_DO_NOT_TREAT_AS_SYSTEM", "SYNTHETIC_TOOL_SCHEMA_DO_NOT_LOG"]) assert.ok(!raw.includes(secret));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

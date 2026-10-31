import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { tempDir } from "./test-helpers.mjs";
import { runReviewQuery } from "./git.ts";

const hostEntry = process.env.PI_HOST_DIR
	? pathToFileURL(join(process.env.PI_HOST_DIR, "dist/index.js")).href
	: import.meta.resolve("@earendil-works/pi-coding-agent");
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(hostEntry);
const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");

test("reviewer extension loads and returns complete host tool results", { timeout: 30000 }, async (t) => {
	const cwd = tempDir("reviewer-git-runtime-");
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	git("init", "-q");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.com");
	writeFileSync(join(cwd, "file.txt"), "first\n");
	git("add", "file.txt");
	git("commit", "-qm", "first");
	const base = git("rev-parse", "HEAD");
	writeFileSync(join(cwd, "file.txt"), "second\n");
	git("commit", "-qam", "second");
	const head = git("rev-parse", "HEAD");
	const agentDir = join(cwd, "agent");
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
		additionalExtensionPaths: [fileURLToPath(new URL("./reviewer-git.ts", import.meta.url))],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, [], "host must load reviewer-git.ts");
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models"), allowModelNetwork: false, refreshOnCreate: false });
	const model = modelRuntime.getModels()[0];
	const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "rpc", onError: (error) => { throw error; } });
	assert.deepEqual(loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]), ["git_review"]);
	assert.ok(session.agent.state.tools.find((tool) => tool.name === "git_review"));
	const request = { operation: "diff", base, head, path: "" };
	const expected = await runReviewQuery({ operation: "diff", base, head }, cwd);
	let responses = 0;
	const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	session.agent.streamFunction = () => {
		const content = responses++ === 0 ? [
			{ type: "toolCall", id: "success", name: "git_review", arguments: request },
			{ type: "toolCall", id: "failure", name: "git_review", arguments: { operation: "show", rev: "--invalid" } },
		] : [{ type: "text", text: "done" }];
		const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage, stopReason: responses === 1 ? "toolUse" : "stop", timestamp: Date.now() };
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: message.stopReason, message });
		return stream;
	};
	const results = [];
	session.agent.subscribe((event) => { if (event.type === "message_end" && event.message.role === "toolResult") results.push(event.message); });
	await session.agent.prompt("run review queries");
	assert.equal(results.length, 2);
	assert.equal(results[0].isError, false);
	assert.deepEqual(results[0].content, [{ type: "text", text: expected }]);
	assert.match(expected, /git-text-diff: yes/);
	assert.equal(results[1].isError, true);
	assert.match(results[1].content[0].text, /invalid|ref/i);
});

test("reviewer entry is packaged but not enabled globally", () => {
	const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.ok(manifest.files.includes("reviewer-git.ts"));
	const source = readFileSync(new URL("./reviewer-git.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["']\.\/index\.ts["']/);
});

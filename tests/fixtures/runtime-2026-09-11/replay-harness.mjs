import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorkerReport } from "../../../report.ts";
import { parseSubagentNotify } from "../../../notify.ts";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name) {
	assert.match(name, /^[a-z0-9-]+\.json$/, "fixture names must be local JSON files");
	return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

function replaceTokens(value, tokens) {
	if (typeof value === "string") {
		return value.replace(/\$\{(TEMP_ROOT|WORKSPACE)\}/g, (_, name) => tokens[name]);
	}
	if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
	}
	return value;
}

function assertInside(root, path) {
	const resolved = resolve(path);
	const rel = relative(resolve(root), resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`fixture path escapes replay root: ${path}`);
	}
	return resolved;
}

/**
 * Make one isolated replay tree. Fixture paths are resolved only after this
 * function is called, so checked-in JSON never depends on a machine path.
 */
export function createReplayWorkspace() {
	const root = mkdtempSync(join(process.cwd(), ".planner-only-runtime-replay-"));
	const workspace = join(root, "workspace");
	mkdirSync(workspace, { recursive: true });
	const tokens = { TEMP_ROOT: root, WORKSPACE: workspace };
	return {
		root,
		workspace,
		materialize(value) {
			return replaceTokens(value, tokens);
		},
		path(value) {
			if (typeof value !== "string") throw new TypeError("fixture path must be a string");
			return assertInside(root, replaceTokens(value, tokens));
		},
		writeText(pathValue, text) {
			const path = assertInside(root, replaceTokens(pathValue, tokens));
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
			return path;
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

export function replayReport(text, expectedTaskId) {
	return extractWorkerReport(text, expectedTaskId ? { expectedTaskId } : undefined);
}

export function replayNotification(text) {
	return parseSubagentNotify(text);
}

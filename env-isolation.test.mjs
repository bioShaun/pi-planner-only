import "./test-helpers.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

/** Non-default legal values for every PI_PLANNER_ONLY* key read by loadConfig. */
const POISON = {
	PI_PLANNER_ONLY: "1",
	PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: "200000",
	PI_PLANNER_ONLY_TIMEOUT_MS: "1234",
	PI_PLANNER_ONLY_MAX_TOKENS: "1000",
	PI_PLANNER_ONLY_START_TIMEOUT_MS: "1000",
	PI_PLANNER_ONLY_CANCEL_GRACE_MS: "10",
	PI_PLANNER_ONLY_HANDOFF: "auto",
	PI_PLANNER_ONLY_MODE: "lite",
	PI_PLANNER_ONLY_STRICT: "1",
	PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT: "1",
};

if (process.env.ENV_ISOLATION_CHILD === "1") {
	const leaked = Object.keys(process.env).filter((key) => key === "PI_PLANNER_ONLY" || key.startsWith("PI_PLANNER_ONLY_"));
	assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
	assert.deepEqual(leaked, []);
} else {
	const child = spawnSync(process.execPath, ["--experimental-strip-types", import.meta.filename], {
		env: { ...process.env, ...POISON, ENV_ISOLATION_CHILD: "1" },
		encoding: "utf8",
	});
	assert.equal(child.status, 0, `${child.stdout ?? ""}\n${child.stderr ?? ""}`);
}

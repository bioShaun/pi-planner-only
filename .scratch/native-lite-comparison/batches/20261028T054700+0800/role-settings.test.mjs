import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = process.env.PI_NATIVE_LITE_ROLE_SETTINGS_ROOT ?? "/project/tmp/pi-native-lite-20261028T054700+0800/worktrees";

test("all discovered comparison child roles are pinned to Luna medium in every arm", async () => {
	for (const arm of ["S1-native", "S1-lite", "S2-lite", "S2-native"]) {
		const settings = JSON.parse(await readFile(`${root}/${arm}/.pi/settings.json`, "utf8"));
		for (const role of ["worker", "scout", "oracle", "reviewer", "delegate", "evidence-auditor"]) {
			assert.deepEqual(settings.subagents.agentOverrides[role], { model: "tcuni/gpt-6-luna", thinking: "medium" }, `${arm}/${role}`);
		}
	}
});

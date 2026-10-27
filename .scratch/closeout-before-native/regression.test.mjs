import assert from "node:assert/strict";
import test from "node:test";
import { plannerPrompt } from "../../index.ts";

for (const strict of [false, true]) {
	test(`acceptance checks diffs and output (${strict ? "strict" : "non-strict"})`, () => {
		const prompt = plannerPrompt(strict);
		assert.match(prompt, /check\s+diffs\s+and\s+output\s+before\s+accepting/i, "acceptance must check both diffs and output");
		assert.ok(prompt.length < 1500, `prompt length ${prompt.length} must be below 1500`);
		console.log(`prompt length: ${prompt.length}`);
	});
}

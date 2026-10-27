#!/usr/bin/env node
// Summarize one Pi --mode json session for the step-2 prompt acceptance.
// Reads the JSONL on argv[2] and prints JSON: turns, delegate calls, results,
// final reply, provider errors, and whether delegate calls shared one turn.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
	console.error("usage: node analyze.mjs <session.jsonl>");
	process.exit(2);
}

const turns = [];
const errors = [];
let session;
let finalText = "";

for (const line of readFileSync(path, "utf8").split("\n")) {
	if (!line.trim()) continue;
	let event;
	try { event = JSON.parse(line); } catch { continue; }
	if (event.type === "session") session = event;
	if (event.type === "message_end" && event.message?.role === "assistant") {
		if (event.message.stopReason === "error") errors.push(event.message.errorMessage ?? "unknown error");
		const text = (event.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
		if (event.message.stopReason === "stop" && text) finalText = text;
	}
	if (event.type !== "turn_end") continue;
	const message = event.message ?? {};
	const calls = (message.content ?? []).filter((c) => c.type === "toolCall").map((c) => ({
		id: c.id,
		name: c.name,
		role: c.arguments?.role,
		cwd: c.arguments?.cwd,
		task: c.arguments?.task,
	}));
	const results = (event.toolResults ?? []).map((r) => ({
		callId: r.toolCallId,
		tool: r.toolName,
		text: (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""),
	}));
	turns.push({
		stopReason: message.stopReason,
		timestamp: message.timestamp,
		durationMs: message.durationMs,
		calls,
		results,
	});
}

const delegateCalls = [];
for (let turn = 0; turn < turns.length; turn++) {
	for (const call of turns[turn].calls) {
		if (call.name !== "delegate") continue;
		const result = turns[turn].results.find((r) => r.callId === call.id) ?? null;
		delegateCalls.push({
			turn,
			role: call.role,
			cwd: call.cwd,
			task: call.task,
			status: result?.text.split("\n")[0] ?? null,
			refused: /^delegate refused:/.test(result?.text ?? ""),
			report: result?.text ?? null,
		});
	}
}

const batches = turns
	.map((t, i) => ({ turn: i, delegates: t.calls.filter((c) => c.name === "delegate").length }))
	.filter((t) => t.delegates > 1);

console.log(JSON.stringify({
	path,
	session: session ? { id: session.id, cwd: session.cwd, timestamp: session.timestamp, version: session.version } : null,
	delegateCalls,
	parallelDelegateTurns: batches,
	errors,
	finalText,
	turns: turns.map((t, i) => ({ turn: i, stopReason: t.stopReason, calls: t.calls.map((c) => ({ name: c.name, role: c.role })), results: t.results.length })),
}, null, 2));

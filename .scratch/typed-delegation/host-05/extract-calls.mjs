// Usage: node extract-calls.mjs <file.jsonl|file.json> [--full]
// Prints every toolCall / toolResult found in pi JSON-mode output or a session jsonl.
import { readFileSync } from "node:fs";
const [file, flag] = process.argv.slice(2);
const full = flag === "--full";
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const clip = (s, n = full ? 100000 : 700) => (s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);
let i = 0;
for (const line of lines) {
	let o; try { o = JSON.parse(line); } catch { continue; }
	const msg = o.message ?? (o.type === "message" ? o.message : undefined) ?? (o.role ? o : undefined);
	if (!msg) continue;
	if (o.type && o.type !== "message_end" && o.type !== "message") continue;
	const ts = o.timestamp ?? msg.timestamp ?? "";
	if (msg.role === "assistant" && Array.isArray(msg.content)) {
		for (const c of msg.content) {
			if (c.type === "toolCall") console.log(`#${++i} ${ts} toolCall name=${c.name} id=${c.id}\n   args=${clip(JSON.stringify(c.arguments))}`);
			else if (c.type === "text" && c.text?.trim()) console.log(`#${++i} ${ts} assistant text: ${clip(c.text.trim(), full ? 100000 : 400)}`);
		}
	} else if (msg.role === "toolResult") {
		const text = (msg.content ?? []).map((c) => c.text ?? "").join("");
		console.log(`#${++i} ${ts} toolResult tool=${msg.toolName} id=${msg.toolCallId} isError=${JSON.stringify(msg.isError)}\n   text=${clip(text)}\n   details=${clip(JSON.stringify(msg.details ?? null))}`);
	} else if (msg.role === "user") {
		const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((c) => c.text ?? "").join("");
		console.log(`#${++i} ${ts} user: ${clip(text, 300)}`);
	}
}

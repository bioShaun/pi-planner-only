import fs from "node:fs";

const dir = `${process.env.HOME}/.pi/agent/planner-only/ledger`;
const CAP = 64;
const recs = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
	let task;
	try {
		task = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")).task;
	} catch {
		continue;
	}
	if (!task) continue;
	const eligible = (task.cwd && String(task.cwd).trim() !== "") || task.spec;
	if (!eligible) continue;
	recs.push({ f, id: task.taskId, cwd: task.cwd ?? "", state: task.state, at: task.updatedAt, v: task.spec?.validation });
}
recs.sort((a, b) => (Date.parse(b.at) - Date.parse(a.at)) || a.id.localeCompare(b.id));
const rank = new Map(recs.map((r, i) => [r.id, i + 1]));

console.log("eligible records:", recs.length, "| cap:", CAP);
const t11 = rank.get("T-20260911-001");
console.log("T-20260911-001 rank:", t11 ?? "not ranked", "=> restored into session store?", (t11 ?? Infinity) <= CAP);
console.log("T-20260914-001 rank:", rank.get("T-20260914-001") ?? "not ranked");
console.log("T-20260913-046 rank:", rank.get("T-20260913-046") ?? "not ranked");

const usable = (v) => Array.isArray(v?.commands) && v.commands.some((c) => typeof c === "string" && c.trim() !== "");
const bad = recs.filter((r) => r.v?.required === true && !usable(r.v));
console.log("");
console.log("=== required:true with no usable commands ===");
for (const r of bad) {
	const rk = rank.get(r.id) ?? 0;
	console.log(`rank ${String(rk).padStart(3)} | restored=${rk <= CAP ? "YES" : "no "} | ${r.id} | state=${r.state} | cwd=${r.cwd}`);
}
console.log("(total:", bad.length, ")");

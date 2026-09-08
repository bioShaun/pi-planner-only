import { readFileSync, readdirSync } from "node:fs";
import { validateWorkerReport, normalizeWorkerReport } from "../../../report.ts";

const dir = ".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts";
function scanBalancedObjects(text) {
	const found = [];
	for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
		let depth = 0, inString = false, escaped = false;
		for (let i = start; i < text.length; i += 1) {
			const c = text[i];
			if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; continue; }
			if (c === '"') inString = true;
			else if (c === "{") depth += 1;
			else if (c === "}") { depth -= 1; if (depth === 0) { found.push(text.slice(start, i + 1)); break; } }
		}
	}
	return found;
}
for (const prefix of ["68b5f76e", "a5b8f153", "e567653d"]) {
	const file = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith("_output.md"));
	const text = readFileSync(`${dir}/${file}`, "utf8");
	const cands = [text.trim(), ...[...text.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)```/g)].map((m) => m[1]?.trim()).filter(Boolean), ...scanBalancedObjects(text)];
	console.log(`\n===== ${prefix} =====`);
	let best;
	for (const c of [...new Set(cands)]) {
		let parsed;
		try { parsed = JSON.parse(c); } catch { continue; }
		if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed) && ("taskId" in parsed || "status" in parsed))) continue;
		const norm = normalizeWorkerReport(parsed, {});
		const errs = validateWorkerReport(norm.report);
		const keys = Object.keys(parsed).join(",");
		console.log(`  cand keys=[${keys}] errors=${errs.length}: ${errs.slice(0, 3).join(" | ")}`);
		if (!best || errs.length < best.n) best = { n: errs.length, keys, errs };
	}
	console.log(`  -> winner keys=[${best?.keys}] reported: ${best?.errs[0]}`);
}

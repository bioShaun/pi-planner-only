import type { TaskPacket, TaskRole, TaskSpec, WorkerReport } from "./types.ts";

/**
 * §13 — capability profiles live in task.ts (the write-lock owner) so agent
 * remapping and write coordination share one source of truth; re-exported
 * above. Worker is unbounded (the selected agent keeps its own tools).
 * Restricted roles are enforced by remapping to a builtin agent whose
 * allowlist matches the profile. Foreground children do not load ambient
 * extensions, so this is the per-child tool ceiling the parent can actually
 * apply. Background children may load ambient extensions; this extension
 * no-ops when PI_SUBAGENT_CHILD=1.
 *
 * Reviewer children therefore have no `git_audit`: that tool is registered
 * by this extension and is not on the reviewer allowlist. Root passes
 * a bounded Git evidence packet instead (§P1-2).
 */

/** Builtin pi-subagents agents whose declared tools match the role profile. */
export const ROLE_AGENTS: Record<TaskRole, string | undefined> = {
	explorer: "scout",
	reviewer: "reviewer",
	validator: "oracle",
	worker: undefined,
};

// IS-02 — the agent→role table is owned by task.ts (identity and the repair
// contract live there) and re-exported under the historical name so agent
// remapping and the TaskSpec repair renderer cannot drift apart.


export function oracleSuiteMode(env: NodeJS.ProcessEnv = process.env): "bounded" | "full" {
	return (env.PI_PLANNER_ONLY_ORACLE ?? "").trim().toLowerCase() === "full" ? "full" : "bounded";
}


export function missingTaskSpecValidationCommands(
	spec: TaskSpec | undefined,
	report: WorkerReport | undefined,
): string[] {
	const required = spec?.validation?.commands ?? [];
	if (!required.length) return [];
	const covered = new Set(
		(report?.validation ?? [])
			.filter((item) => Boolean(item.command) && item.inferred !== true && item.status === "passed" && item.exitCode === 0)
			.map((item) => item.command as string),
	);
	return required.filter((cmd) => !covered.has(cmd));
}


export function lastWorkerValidationPassed(report: WorkerReport | undefined): boolean {
	if (!report) return false;
	if (!report.validation.length) return false;
	return report.validation.every((item) => item.inferred !== true && item.status === "passed" && item.exitCode === 0);
}


/**
 * Build the worker/explorer packet without asking a model to summarize the
 * Root's prose. When a valid embedded spec is found, only that exact JSON
 * slice is removed; if it cannot be isolated, the original prompt is kept.
 */
export function buildTaskPacket(
	spec: TaskSpec,
	prompt: string,	details: { candidateText?: string; candidate?: Record<string, unknown> } = {},
): string {
	let instructions = prompt.trim();
	const existingValue = (() => {
		try {
			return JSON.parse(instructions) as Partial<TaskPacket>;
		} catch {
			return undefined;
		}
	})();
	const existing = existingValue && existingValue.version === 1 && existingValue.spec && Array.isArray(existingValue.knownFacts) && Array.isArray(existingValue.artifactRefs)
		? existingValue
		: details.candidate && details.candidate.version === 1 && details.candidate.spec
			&& Array.isArray(details.candidate.knownFacts) && Array.isArray(details.candidate.artifactRefs)
			? details.candidate as Partial<TaskPacket>
			: undefined;
	if (existing) {
		const knownFacts = Array.isArray(existing.knownFacts)
			? existing.knownFacts.filter((item): item is string => typeof item === "string")
			: [];
		const artifactRefs = Array.isArray(existing.artifactRefs)
			? existing.artifactRefs.filter((item): item is string => typeof item === "string")
			: [];
		return JSON.stringify({
			version: 1,
			spec,
			instructions: typeof existing.instructions === "string" ? existing.instructions : "",
			knownFacts,
			artifactRefs,
		} satisfies TaskPacket, null, 2);
	}
	if (details.candidateText) {
		const start = prompt.indexOf(details.candidateText);
		if (start >= 0) {
			instructions = `${prompt.slice(0, start)}${prompt.slice(start + details.candidateText.length)}`
				.replace(/```(?:json|jsonc)?\s*\n?\s*```/g, "")
				.replace(/UNRELATED_ROOT_CONVERSATION_HISTORY_MARKER_[A-Za-z0-9_-]+/g, "")
				.trim();
		}
	}
	const submitted = details.candidate;
	const submittedFacts = submitted && Array.isArray(submitted.knownFacts)
		? submitted.knownFacts.filter((item): item is string => typeof item === "string")
		: [];
	const submittedRefs = submitted && Array.isArray(submitted.artifactRefs)
		? submitted.artifactRefs.filter((item): item is string => typeof item === "string")
		: [];
	const knownFacts = submittedFacts.length > 0
		? submittedFacts
		: [...(spec.constraints ?? []), ...(spec.acceptanceCriteria ?? [])];
	const artifactRefs = submittedRefs.length > 0
		? submittedRefs
		: [...(spec.scope?.allowedPaths ?? [])];
	return JSON.stringify({
		version: 1,
		spec,
		instructions,
		knownFacts,
		artifactRefs,
	} satisfies TaskPacket, null, 2);
}

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runReviewQuery } from "./git.ts";

export default function reviewerGit(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "git_review",
		label: "Git Review",
		description: "Read committed Git content: log lists commits in merge-base(base, head)..head; diff lists changed files or reads a path's patch; show reads commit metadata or a path at rev. Results are paginated: for offset > 1 return the contentId from page 1, and continue until next offset: none. Report INCOMPLETE when content cannot be read in full. This is not a sandbox: it trusts the operator's local Git configuration. Its protections cover only the git_review execution path, not other tools. It prevents parameter-driven writes, program execution and repository relocation and disables external diff, textconv, fsmonitor, signature verification, lazy fetch and replacement objects on this path. Residual inputs such as system attributes, .git/info/attributes and local diff driver configuration can affect output; changes are exposed by contentId.",
		promptSnippet: "git_review: log, diff overview or file patch, and show committed content. For offset > 1 supply page 1's contentId; read until next offset: none or report INCOMPLETE. Not a sandbox; trusts local Git configuration and protects only its own execution path; residual attributes and configuration changes are exposed by contentId.",
		parameters: Type.Object({
			operation: Type.Union([Type.Literal("log"), Type.Literal("diff"), Type.Literal("show")]),
			base: Type.Optional(Type.String()),
			head: Type.Optional(Type.String()),
			rev: Type.Optional(Type.String()),
			path: Type.Optional(Type.String()),
			offset: Type.Optional(Type.Integer({ minimum: 1 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
			contentId: Type.Optional(Type.String()),
		}, { additionalProperties: false }),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const request = { ...params };
			for (const key of ["base", "head", "rev", "path", "contentId"] as const) {
				if (request[key] === "") request[key] = undefined;
			}
			const text = await runReviewQuery(request, ctx.cwd, { signal });
			return { content: [{ type: "text", text }], details: {} };
		},
	});
}

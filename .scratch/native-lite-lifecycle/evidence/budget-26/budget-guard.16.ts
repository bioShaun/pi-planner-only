import { reserveProviderRequest, BUDGET_EXIT_CODE } from "./budget-guard-core.mjs";
import { fileURLToPath } from "node:url";

export default function budgetGuard(pi: any): void {
	let childExtensionRegistration: { dispose(): void } | undefined;
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		try {
			const modulePath = process.env.PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS;
			const sessionId = ctx.sessionManager?.getSessionId?.();
			if (!modulePath || !sessionId) throw new Error("required child extension registry or session id missing");
			const { registerRequiredChildExtensions } = await import(modulePath);
			childExtensionRegistration = registerRequiredChildExtensions({
				sessionId,
				extensions: [{ id: "native-lite-budget-guard", path: fileURLToPath(import.meta.url) }],
				requireForAllRunners: true,
			});
		} catch {
			process.stderr.write("native-lite budget guard could not require itself for every child runner\n");
			process.exit(BUDGET_EXIT_CODE);
		}
	});
	pi.on("session_shutdown", () => childExtensionRegistration?.dispose());
	pi.on("before_provider_request", async (event: { payload: unknown }, ctx: any) => {
		try {
			const model = ctx.model;
			const sessionId = ctx.sessionManager?.getSessionId?.();
			if (!model?.provider || !model.id || !sessionId) throw new Error("active provider model or session identity missing");
			if (!event.payload || typeof event.payload !== "object" || (event.payload as { model?: unknown }).model !== model.id) {
				throw new Error("provider payload model does not match active Pi model");
			}
			const result = await reserveProviderRequest(event.payload, {
				provider: model.provider,
				sessionId,
				ledgerPath: process.env.PI_NATIVE_LITE_BUDGET_LEDGER,
			});
			return result.payload;
		} catch (error) {
			process.stderr.write(`native-lite budget guard denied provider request: ${error instanceof Error ? error.message : "invalid request"}\n`);
			process.exit(BUDGET_EXIT_CODE);
		}
	});
}

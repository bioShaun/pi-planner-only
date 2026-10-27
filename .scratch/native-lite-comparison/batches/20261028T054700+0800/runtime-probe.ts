import { resolveRequiredChildExtensions } from "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/bundle/chunk-CTPAE36Y.js";

export default (pi: any) => {
	pi.on("session_start", (_event: unknown, ctx: any) => {
		const sessionId = ctx.sessionManager.getSessionId();
		ctx.ui.notify(JSON.stringify({
			probe: "native-lite-batch-runtime",
			mode: process.env.PI_PLANNER_ONLY_MODE,
			sessionId,
			activeTools: pi.getActiveTools(),
			allTools: pi.getAllTools().map((tool: any) => ({ name: tool.name, exposure: tool.exposure })),
			requiredChildExtensions: resolveRequiredChildExtensions(sessionId),
			requiredChildExtensionsModule: process.env.PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS,
		}), "info");
	});
};

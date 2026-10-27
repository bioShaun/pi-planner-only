export default (pi: any) => {
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		const tools = pi.getAllTools().map((tool: any) => ({ name: tool.name, exposure: tool.exposure }));
		ctx.ui.notify(JSON.stringify({ tools, active: pi.getActiveTools() }), "info");
	});
};

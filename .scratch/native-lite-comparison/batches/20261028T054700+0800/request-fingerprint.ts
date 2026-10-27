import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export default function requestFingerprint(pi: any): void {
	pi.on("before_provider_request", async (event: { payload: unknown }, ctx: any) => {
		const logPath = process.env.PI_NATIVE_LITE_FINGERPRINT_LOG;
		const model = ctx.model;
		const sessionId = ctx.sessionManager?.getSessionId?.();
		if (!logPath || !model?.provider || !model.id || !sessionId || !event.payload || typeof event.payload !== "object") {
			process.stderr.write("native-lite request fingerprint identity or log path missing\n");
			process.exit(74);
		}
		const payload = event.payload as Record<string, unknown>;
		const record = {
			at: new Date().toISOString(),
			provider: model.provider,
			model: model.id,
			sessionId,
			systemPresent: Object.hasOwn(payload, "instructions"),
			systemSha256: fingerprint(payload.instructions),
			toolsPresent: Object.hasOwn(payload, "tools"),
			toolsSha256: fingerprint(payload.tools),
			payloadSha256: fingerprint(payload),
		};
		try {
			await appendFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
		} catch (error) {
			process.stderr.write(`native-lite request fingerprint log failed: ${error instanceof Error ? error.message : "unknown"}\n`);
			process.exit(74);
		}
	});
}

import { registerRequiredChildExtensions as register } from "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/bundle/required-child-extensions.js";

const fingerprintExtension = new URL("./request-fingerprint.ts", import.meta.url).pathname;

export function registerRequiredChildExtensions(input) {
	return register({
		...input,
		extensions: [...input.extensions, { id: "native-lite-request-fingerprint", path: fingerprintExtension }],
		requireForAllRunners: true,
	});
}

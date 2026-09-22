#!/usr/bin/env node
// Run a command with project-local temp dirs.
// os.tmpdir() follows TMPDIR; Git must not walk from those dirs into this checkout.

import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = resolve(root, ".scratch");
const requested = resolve(scratch, "test-tmp");
mkdirSync(requested, { recursive: true });

const scratchReal = realpathSync(scratch);
const tmp = realpathSync(requested);
const fromScratch = relative(scratchReal, tmp);
if (fromScratch !== "test-tmp" && !fromScratch.startsWith(`test-tmp${sep}`)) {
	console.error(`refusing TMPDIR outside .scratch/test-tmp: ${tmp}`);
	process.exit(1);
}

const ceilingSep = process.platform === "win32" ? ";" : ":";
const ceiling = [tmp, process.env.GIT_CEILING_DIRECTORIES]
	.filter(Boolean)
	.join(ceilingSep);

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error("usage: with-project-tmpdir.mjs <command> [args...]");
	process.exit(2);
}

const child = spawn(args[0], args.slice(1), {
	stdio: "inherit",
	env: {
		...process.env,
		TMPDIR: tmp,
		TMP: tmp,
		TEMP: tmp,
		GIT_CEILING_DIRECTORIES: ceiling,
	},
});

child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

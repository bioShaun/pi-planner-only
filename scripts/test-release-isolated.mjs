import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repo = realpathSync(resolve(import.meta.dirname, ".."));
let dir;
try {
	if (!process.env.TMPDIR) throw new Error("TMPDIR must name an existing directory outside the repository");
	const temp = realpathSync(process.env.TMPDIR);
	const rel = relative(repo, temp);
	if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`))) throw new Error("TMPDIR must be outside the repository");
	dir = mkdtempSync(join(temp, "pi-planner-release-"));
	for (const file of ["package.json", "package-lock.json"]) cpSync(join(repo, "fixtures", "isolated-release", file), join(dir, file));
	const run = (args, options) => {
		const result = spawnSync("npm", args, { stdio: "inherit", ...options });
		if (result.error) throw result.error;
		if (result.signal) throw new Error(`npm terminated by ${result.signal}`);
		return result.status;
	};
	const installStatus = run(["ci", "--no-audit", "--no-fund"], { cwd: dir });
	if (installStatus !== 0) process.exitCode = installStatus;
	else {
		const source = join(dir, "node_modules", "pi-subagents");
		for (const path of ["src/api/delegation.js", "src/slash/delegation-request.js", "src/slash/delegation-adapters.js", "src/shared/artifacts.js", "agents"]) {
			if (!existsSync(join(source, path))) throw new Error(`isolated pi-subagents missing ${path}`);
		}
		process.exitCode = run(["run", "test:release"], { cwd: repo, env: { ...process.env, PI_SUBAGENTS_DIR: source } });
	}
} catch (error) {
	console.error(`isolated release: ${error.message}`);
	process.exitCode = 1;
} finally {
	if (dir) {
		try { rmSync(dir, { recursive: true, force: true }); }
		catch (error) { console.error(`isolated release: cleanup failed for ${dir}: ${error.message}`); process.exitCode ||= 1; }
	}
}

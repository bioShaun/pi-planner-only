/**
 * Local adapter for the pi-subagents artifact layout, limited to the files
 * this plugin reads after a child did not complete.
 *
 * The delegation response carries no artifact paths, so this is the only
 * place that encodes where pi-subagents writes them. Based on
 * pi-subagents@0.71.0 `src/shared/artifacts.js` (getArtifactsDir,
 * getArtifactPaths), `src/shared/types.js` (TEMP_ROOT_DIR, resolveTempScopeId),
 * `src/shared/utils.js` (getAgentDir) and `src/extension/config.js`
 * (getConfigPath, `artifactDir`). contract.test.mjs checks the resolved paths
 * against the installed package.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ARTIFACT_DIRS = ["session", "temp", "project"] as const;
export type ArtifactDir = (typeof ARTIFACT_DIRS)[number];
export const DEFAULT_ARTIFACT_DIR: ArtifactDir = "session";

export interface ArtifactPaths {
	outputPath: string;
	transcriptPath: string;
}

export interface ArtifactLocation {
	runId: string;
	agent: string;
	/** Root's session file; hosts the `session` layout. */
	sessionFile?: string;
	/** Working directory the child ran in; hosts the `project` layout. */
	cwd: string;
	artifactDir?: ArtifactDir;
	env?: NodeJS.ProcessEnv;
}

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

function isArtifactDir(value: unknown): value is ArtifactDir {
	return typeof value === "string" && (ARTIFACT_DIRS as readonly string[]).includes(value);
}

/** pi-subagents' agent dir: `PI_CODING_AGENT_DIR` (with `~` expansion) or `~/.pi/agent`. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.HOME || env.USERPROFILE || homedir();
	const configured = env.PI_CODING_AGENT_DIR;
	if (configured === "~") return home;
	if (configured?.startsWith("~/") || configured?.startsWith("~\\")) return join(home, configured.slice(2));
	return configured || join(home, ".pi", "agent");
}

/** The `artifactDir` preference from pi-subagents' config.json; the upstream default when absent or unreadable. */
export function loadArtifactDir(env: NodeJS.ProcessEnv = process.env): ArtifactDir {
	const configPath = join(piAgentDir(env), "extensions", "subagent", "config.json");
	try {
		if (!existsSync(configPath)) return DEFAULT_ARTIFACT_DIR;
		const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
		if (parsed && typeof parsed === "object" && "artifactDir" in parsed && isArtifactDir(parsed.artifactDir)) return parsed.artifactDir;
	} catch {
		/* unreadable config: upstream falls back to defaults too */
	}
	return DEFAULT_ARTIFACT_DIR;
}

function tempScopeId(env: NodeJS.ProcessEnv): string {
	const sanitize = (value: string) => value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
	if (typeof process.getuid === "function") return `uid-${process.getuid()}`;
	for (const key of ["USERNAME", "USER", "LOGNAME"]) {
		const value = env[key];
		if (value) return `user-${sanitize(value)}`;
	}
	try {
		const name = userInfo().username;
		if (name) return `user-${sanitize(name)}`;
	} catch {
		/* fall through to the home directory */
	}
	return `home-${sanitize(env.USERPROFILE ?? env.HOME ?? homedir())}`;
}

/** pi-subagents' temp artifact dir: `$PI_SUBAGENTS_TEMP_ROOT/artifacts` or `<tmpdir>/pi-subagents-<scope>/artifacts`. */
export function tempArtifactsDir(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.PI_SUBAGENTS_TEMP_ROOT?.trim();
	const root = configured ? resolve(configured) : join(tmpdir(), `pi-subagents-${tempScopeId(env)}`);
	return join(root, "artifacts");
}

/** Mirrors upstream getArtifactsDir(sessionFile, projectCwd, dirPreference). */
export function artifactsDir(sessionFile: string | undefined, cwd: string, artifactDir: ArtifactDir, env: NodeJS.ProcessEnv = process.env): string {
	const sessionDir = sessionFile ? join(dirname(sessionFile), "subagent-artifacts") : undefined;
	switch (artifactDir) {
		case "session":
			return sessionDir ?? tempArtifactsDir(env);
		case "temp":
			return tempArtifactsDir(env);
		case "project":
			if (cwd) return join(cwd, ".pi", "subagents", "artifacts");
			return sessionDir ?? tempArtifactsDir(env);
	}
}

/**
 * Where pi-subagents wrote the child's output and transcript for a single
 * (non-fan-out) run. `undefined` when the runId is not a plain name, so a
 * host-supplied id can never become a path segment.
 */
export function resolveArtifacts(location: ArtifactLocation): ArtifactPaths | undefined {
	const { runId, agent, sessionFile, cwd } = location;
	if (!SAFE_RUN_ID.test(runId)) return undefined;
	const env = location.env ?? process.env;
	const dir = artifactsDir(sessionFile, cwd, location.artifactDir ?? DEFAULT_ARTIFACT_DIR, env);
	const base = join(dir, `${runId}_${agent.replace(/[^\w.-]/g, "_")}_0`);
	return { outputPath: `${base}_output.md`, transcriptPath: `${base}_transcript.jsonl` };
}

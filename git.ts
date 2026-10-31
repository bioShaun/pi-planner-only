/**
 * Root's Git access: fixed argv, never a shell.
 *
 * Repository config must not make Root run programs: every call disables
 * fsmonitor, and every diff disables external diff drivers and textconv.
 *
 * `--no-optional-locks` (git >= 2.15) only keeps Root from taking index.lock;
 * it is added when `git --version` says it is supported, and dropped on older
 * git (e.g. 1.8) or when the probe fails. Env vars are not an option: pi.exec
 * cannot pass them.
 */
import { clip } from "./format.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);

/** Bounded output avoids relying on pi.exec's output transport for review input. */
const reviewGit: GitRunner = async (args, cwd) => {
	try {
		const result = await execFileAsync("git", ["-c", "core.warnAmbiguousRefs=true", ...args], { cwd, encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 30_000, env: { ...process.env, LC_ALL: "C" } });
		if (/warning: refname .* is ambiguous/i.test(result.stderr.toString("utf8"))) throw new Error(result.stderr.toString("utf8").trim());
		return { stdout: new TextDecoder("utf-8", { fatal: true }).decode(result.stdout), stderr: result.stderr.toString("utf8"), code: 0 };
	} catch (error) {
		const e = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: Buffer };
		if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("git output exceeded 1 MiB execution limit");
		if (e.killed) throw new Error("git execution timed out");
		if (typeof e.code === "number") return { stdout: "", stderr: (e.stderr?.toString("utf8") ?? "").slice(0, 1000), code: e.code };
		throw new Error(`git execution failed: ${(e.message ?? String(error)).slice(0, 1000)}`);
	}
};

export interface ReviewRange { root: string; base: string; head: string; mergeBase: string; diff: string }

type ReviewCommand = (cwd: string, args: string[]) => Promise<string>;

async function normalizeReviewRef(command: ReviewCommand, root: string, input: string, field: "base" | "head" | "rev" = "base"): Promise<string> {
	if (typeof input !== "string" || !input || input.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(input)) throw new Error(`invalid ${field} ref`);
	let ref = input;
	if (!/^(?:HEAD(?:~[0-9]+)?|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(input)) {
		await command(root, ["check-ref-format", "--allow-onelevel", input]);
		ref = (await command(root, ["rev-parse", "--symbolic-full-name", "--verify", input])).trim();
		if (!/^refs\/(?:heads|remotes|tags)\//.test(ref)) throw new Error(`${field} must be a branch, remote, tag, or full object ID`);
	}
	return ref;
}

export async function resolveReviewCommit(command: ReviewCommand, root: string, input: string, normalized = false, field: "base" | "head" | "rev" = "base"): Promise<string> {
	const ref = normalized ? input : await normalizeReviewRef(command, root, input, field);
	const result = (await command(root, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(result)) throw new Error("invalid resolved commit");
	return result;
}

export async function reviewMergeBase(command: ReviewCommand, root: string, base: string, head: string): Promise<string> {
	let output: string;
	try { output = await command(root, ["merge-base", "--all", base, head]); }
	catch (error) {
		if ((error as { gitCode?: number }).gitCode === 1) throw new Error("no merge base for committed range");
		throw error;
	}
	const bases = output.trim().split("\n").filter(Boolean);
	if (!bases.length) throw new Error("no merge base for committed range");
	if (bases.length > 1) throw new Error("multiple merge bases for committed range");
	return bases[0];
}

export function validateReviewPath(path: unknown): asserts path is string {
	if (typeof path !== "string" || !path || path.startsWith("/") || /[\x00-\x1f\x7f]/.test(path) || path.split("/").some(part => part === "." || part === "..")) throw new Error("invalid path");
}

export interface ReviewQueryRequest {
	operation: "log" | "diff" | "show";
	base?: string; head?: string; rev?: string; path?: string;
	offset?: number; limit?: number; contentId?: string;
}
type ReviewQueryRunner = (args: readonly string[], cwd: string, options: { signal?: AbortSignal; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr?: string; code: number }>;

export const REVIEW_QUERY_COMMANDS = ["rev-parse", "check-ref-format", "merge-base", "log", "diff", "show", "ls-tree", "cat-file"] as const;
export async function reviewQueryCommand(command: ReviewCommand, cwd: string, args: string[]): Promise<string> {
	if (!(REVIEW_QUERY_COMMANDS as readonly string[]).includes(args[0])) throw new Error("git command not allowed");
	return command(cwd, args);
}
const REVIEW_QUERY_PREFIX = ["--no-pager", "--no-lazy-fetch", "--no-replace-objects", "--literal-pathspecs", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.warnAmbiguousRefs=true", "-c", "core.attributesFile=/dev/null"];
const QUERY_MAX_OUTPUT = 1024 * 1024;
const REVIEW_DIFF_SAFE = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", "--no-relative"];
const REVIEW_DIFF_PATCH = ["--unified=3", "--diff-algorithm=myers", "--indent-heuristic", "--src-prefix=a/", "--dst-prefix=b/"];

async function reviewShowPath(command: ReviewCommand, root: string, rev: string, path: string): Promise<{ body: string; symlink: boolean }> {
	const output = await command(root, ["ls-tree", "-z", "--full-tree", rev, "--", path]);
	if (!output) throw new Error(`${JSON.stringify(path)}: path not found`);
	const match = /^(100644|100755|120000|040000|160000) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/.exec(output);
	if (!match || match[4] !== path) throw new Error(`${JSON.stringify(path)}: invalid or multiple ls-tree records`);
	const [, mode, type, oid] = match;
	if (mode === "160000" && type === "commit") throw new Error(`${JSON.stringify(path)}: gitlink cannot be read`);
	if (mode === "040000" && type === "tree") {
		const listing = await command(root, ["ls-tree", "-z", "--full-tree", oid]);
		if (!listing) return { body: "", symlink: false };
		const records = listing.split("\0");
		if (records.pop() !== "") throw new Error(`${JSON.stringify(path)}: invalid tree listing`);
		const lines = records.map(record => {
			const entry = /^(100644|100755|120000|040000|160000) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)$/.exec(record);
			if (!entry || (entry[1] === "040000" ? entry[2] !== "tree" : entry[1] === "160000" ? entry[2] !== "commit" : entry[2] !== "blob")) throw new Error(`${JSON.stringify(path)}: invalid tree listing`);
			return `${entry[1]} ${entry[2]} ${entry[3]} ${JSON.stringify(entry[4])}`;
		});
		return { body: lines.join("\n") + "\n", symlink: false };
	}
	if (!["100644", "100755", "120000"].includes(mode) || type !== "blob") throw new Error(`${JSON.stringify(path)}: invalid ls-tree mode or type`);
	const body = await command(root, ["cat-file", "blob", oid]);
	if (body.includes("\0")) throw new Error(`${JSON.stringify(path)}: binary blob cannot be read as text`);
	return { body, symlink: mode === "120000" };
}

async function reviewShowStats(command: ReviewCommand, root: string, rev: string): Promise<{ body: string; parent: string }> {
	const parents = (await command(root, ["show", "-s", "--no-show-signature", "--format=%P", rev])).trim();
	if (parents && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})(?: (?:[0-9a-f]{40}|[0-9a-f]{64}))*$/.test(parents)) throw new Error("invalid commit parents");
	const parent = parents ? parents.split(" ")[0] : "empty-tree";
	let compare = parent;
	if (parent === "empty-tree") {
		const format = (await command(root, ["rev-parse", "--show-object-format"])).trim();
		if (format === "sha1") compare = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
		else if (format === "sha256") compare = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
		else throw new Error(`unsupported object format: ${format}`);
	}
	const metadata = await command(root, ["show", "-s", "--no-show-signature", "--format=fuller", rev]);
	const numstat = await command(root, ["diff", ...REVIEW_DIFF_SAFE, "--numstat", "-z", compare, rev, "--"]);
	const records = numstat ? numstat.split("\0") : [];
	if (numstat && records.pop() !== "") throw new Error("invalid show numstat output");
	const lines = records.map(record => {
		const stat = /^(\d+|-)\t(\d+|-)\t([^\0]+)$/.exec(record);
		if (!stat || (stat[1] === "-") !== (stat[2] === "-")) throw new Error("invalid show numstat record");
		return `${stat[1] === "-" ? "-" : `+${stat[1]}`} ${stat[2] === "-" ? "-" : `-${stat[2]}`} ${JSON.stringify(stat[3])}`;
	});
	return { body: `${metadata}${metadata.endsWith("\n") ? "" : "\n"}first-parent: ${parent}\n${lines.length ? lines.join("\n") + "\n" : ""}`, parent };
}

async function reviewFilePatch(command: ReviewCommand, root: string, base: string, head: string, path: string): Promise<string> {
	try {
		const raw = await command(root, ["diff", ...REVIEW_DIFF_SAFE, "--raw", "-z", "--no-abbrev", base, head, "--", path]);
		if (!raw) return "";
		const records = raw.split("\0");
		const record = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]$/.exec(records[0]);
		if (records.length !== 3 || records[2] !== "" || records[1] !== path || !record) throw new Error("invalid or non-file raw diff output");
		if (record[1] === "160000" || record[2] === "160000") throw new Error("gitlink cannot be reviewed as text");
		for (const oid of new Set([record[3], record[4]])) {
			if (/^0+$/.test(oid)) continue;
			const blob = await command(root, ["cat-file", "blob", oid]);
			if (blob.includes("\0")) throw new Error("binary blob cannot be reviewed as text");
		}
		const numstat = await command(root, ["diff", ...REVIEW_DIFF_SAFE, "--numstat", "-z", base, head, "--", path]);
		const stat = /^(\d+|-)\t(\d+|-)\t([^\0]+)\0$/.exec(numstat);
		if (!stat || stat[3] !== path || (stat[1] === "-") !== (stat[2] === "-")) throw new Error("invalid numstat output");
		if (stat[1] === "-") throw new Error("binary diff cannot be reviewed as text");
		return await command(root, ["diff", ...REVIEW_DIFF_SAFE, ...REVIEW_DIFF_PATCH, base, head, "--", path]);
	} catch (error) {
		throw new Error(`${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function reviewDiffOverview(command: ReviewCommand, root: string, base: string, head: string): Promise<string> {
	const raw = await command(root, ["diff", ...REVIEW_DIFF_SAFE, "--raw", "-z", "--no-abbrev", base, head, "--"]);
	const numstat = await command(root, ["diff", ...REVIEW_DIFF_SAFE, "--numstat", "-z", base, head, "--"]);
	const records = raw ? raw.split("\0") : [];
	const stats = numstat ? numstat.split("\0") : [];
	if (raw && records.pop() !== "" || numstat && stats.pop() !== "" || records.length !== stats.length * 2) throw new Error("invalid diff overview output");
	let binary = 0, gitlinks = 0;
	const lines: string[] = [];
	for (let i = 0; i < stats.length; i++) {
		const record = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/.exec(records[i * 2]);
		const stat = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(stats[i]);
		if (!record || !stat || records[i * 2 + 1] !== stat[3] || (stat[1] === "-") !== (stat[2] === "-")) throw new Error("invalid diff overview record");
		const isBinary = stat[1] === "-", gitlink = record[1] === "160000" || record[2] === "160000";
		if (isBinary) binary++;
		if (gitlink) gitlinks++;
		const additions = isBinary ? "-" : `+${stat[1]}`;
		const deletions = isBinary ? "-" : `-${stat[2]}`;
		lines.push(`${record[5]} ${additions} ${deletions}${isBinary ? " binary" : ""}${gitlink ? " gitlink" : ""} git-text-diff: ${isBinary ? "no" : "yes"} ${JSON.stringify(stat[3])}`);
	}
	lines.push(`binary: ${binary}; gitlink: ${gitlinks}; 逐文件读取尚未验证`);
	return lines.join("\n") + "\n";
}

export const reviewQueryRunner: ReviewQueryRunner = async (args, cwd, options) => {
	try {
		const result = await execFileAsync("git", args, { cwd, env: options.env, signal: options.signal, encoding: "buffer", maxBuffer: QUERY_MAX_OUTPUT, timeout: 30_000 });
		return { stdout: new TextDecoder("utf-8", { fatal: true }).decode(result.stdout), stderr: result.stderr.toString("utf8"), code: 0 };
	} catch (error) {
		const e = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: Buffer };
		const stderr = e.stderr?.toString("utf8").slice(0, 1000) || "";
		if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error(`git output exceeded 1 MiB: ${stderr}`);
		if (e.name === "AbortError") throw new Error(`git aborted: ${stderr}`);
		if (e.killed) throw new Error(`git execution timed out: ${stderr}`);
		throw Object.assign(new Error(`git execution failed: ${(stderr || e.message || String(error)).slice(0, 1000)}`), { gitCode: typeof e.code === "number" ? e.code : undefined });
	}
};

const queryVersions = new WeakMap<ReviewQueryRunner, Promise<void>>();

export async function runReviewQuery(request: ReviewQueryRequest, cwd: string, options: { signal?: AbortSignal; runner?: ReviewQueryRunner } = {}): Promise<string> {
	if (!request || typeof request !== "object" || Object.keys(request).some(key => !["operation", "base", "head", "rev", "path", "offset", "limit", "contentId"].includes(key))) throw new Error("invalid query fields");
	if (!["log", "diff", "show"].includes(request.operation)) throw new Error("invalid operation");
	if (request.path !== undefined) validateReviewPath(request.path);
	for (const value of [request.base, request.head, request.rev, request.contentId]) if (value !== undefined && typeof value !== "string") throw new Error("invalid query field");
	const offset = request.offset ?? 1, limit = request.limit ?? 1000;
	if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("invalid offset or limit");
	if (request.operation === "show" && (request.base !== undefined || request.head !== undefined || !request.rev)) throw new Error("show requires rev and does not accept base or head");
	if (request.operation !== "show" && request.rev !== undefined) throw new Error(`${request.operation} does not accept rev`);
	if (request.operation === "log" && request.path !== undefined) throw new Error("log does not accept path");
	if (request.operation !== "show" && (!request.base || !request.head)) throw new Error("base and head required");
	const runner = options.runner ?? reviewQueryRunner;
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
	Object.assign(env, { LC_ALL: "C", GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" });
	const invoke = async (args: readonly string[], dir: string) => {
		if (options.signal?.aborted) throw new Error("git aborted");
		const controller = new AbortController();
		const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		const interrupted = new Promise<never>((_, reject) => {
			onAbort = () => reject(new Error("git aborted"));
			options.signal?.addEventListener("abort", onAbort, { once: true });
			timer = setTimeout(() => { reject(new Error("git execution timed out")); controller.abort(); }, 30_000);
		});
		let result: Awaited<ReturnType<ReviewQueryRunner>>;
		try { result = await Promise.race([runner(args, dir, { env, signal }), interrupted]); }
		finally { if (timer) clearTimeout(timer); if (onAbort) options.signal?.removeEventListener("abort", onAbort); }
		if (Buffer.byteLength(result.stdout) > QUERY_MAX_OUTPUT) throw new Error("git output exceeded 1 MiB");
		if (/warning: refname .* is ambiguous/i.test(result.stderr ?? "")) throw new Error((result.stderr ?? "").slice(0, 1000));
		if (result.code !== 0) throw Object.assign(new Error(`git failed: ${(result.stderr || result.stdout || `exit ${result.code}`).slice(0, 1000)}`), { gitCode: result.code });
		return result.stdout;
	};
	let version = queryVersions.get(runner);
	if (!version) {
		version = invoke(["--version"], cwd).then(out => {
			const match = /git version (\d+)\.(\d+)/.exec(out);
			if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 45)) throw new Error("需要 Git ≥ 2.45");
		});
		queryVersions.set(runner, version);
		version.catch(error => { if (/abort|timed out/i.test(String(error)) && queryVersions.get(runner) === version) queryVersions.delete(runner); });
	}
	await version;
	let attr: string | undefined;
	const command: ReviewCommand = (dir, args) => reviewQueryCommand((cwd, accepted) => invoke([...REVIEW_QUERY_PREFIX, ...(attr ? [`--attr-source=${attr}`] : []), ...accepted], cwd), dir, args);
	const root = (await command(cwd, ["rev-parse", "--show-toplevel"])).trim();
	let body: string, identity: string, headerFields: string;
	if (request.operation === "show") {
		const rev = await resolveReviewCommit(command, root, request.rev!, false, "rev");
		attr = rev;
		identity = JSON.stringify(["show", rev, request.path ?? null]);
		if (request.path === undefined) {
			const result = await reviewShowStats(command, root, rev); body = result.body; headerFields = `rev=${rev} parent=${result.parent}`;
		} else {
			const result = await reviewShowPath(command, root, rev, request.path); body = result.symlink ? `symlink\n${result.body}` : result.body; headerFields = `rev=${rev} path=${request.path}`;
		}
	} else {
		const head = await resolveReviewCommit(command, root, request.head!, false, "head");
		const base = await resolveReviewCommit(command, root, request.base!);
		attr = head;
		const mergeBase = await reviewMergeBase(command, root, base, head);
		body = request.operation === "log"
			? await command(root, ["log", "--no-show-signature", "--format=%H %s", `${mergeBase}..${head}`, "--"])
			: request.path === undefined ? await reviewDiffOverview(command, root, mergeBase, head) : await reviewFilePatch(command, root, mergeBase, head, request.path);
		identity = JSON.stringify([request.operation, base, head, mergeBase, request.operation === "diff" ? request.path ?? null : null]);
		headerFields = `base=${base} head=${head} merge-base=${mergeBase}`;
	}
	const contentId = `sha256:${createHash("sha256").update(identity).update("\0").update(body).digest("hex")}`;
	if (offset > 1 && request.contentId !== contentId) throw new Error("内容已变化或缺少 contentId，请从 offset 1 重读");
	const lines = body ? body.split("\n") : [];
	const noNewline = !!body && !body.endsWith("\n");
	if (body.endsWith("\n")) lines.pop();
	if (offset > lines.length && lines.length) throw new Error("offset exceeds content");
	const header = `git_review ${request.operation}: ${headerFields} contentId=${contentId}`;
	const selected: string[] = [];
	for (let i = offset - 1; i < lines.length && selected.length < Math.min(limit, 998); i++) {
		const line = lines[i] + (noNewline && i === lines.length - 1 ? " (no newline at end)" : "");
		const end = i + 1;
		const footer = `lines ${offset}-${end} of ${lines.length}; next offset: ${end < lines.length ? end + 1 : "none"}`;
		if (Buffer.byteLength([header, ...selected, line, footer].join("\n")) > 40 * 1024) {
			if (!selected.length) throw new Error(`line ${i + 1} exceeds page size (${request.path === undefined ? request.operation : JSON.stringify(request.path)})`);
			break;
		}
		selected.push(line);
	}
	const end = offset + selected.length - 1;
	const footer = lines.length ? `lines ${offset}-${end} of ${lines.length}; next offset: ${end < lines.length ? end + 1 : "none"}` : "lines 0-0 of 0; next offset: none";
	return [header, ...selected, footer].join("\n");
}

async function reviewCommand(cwd: string, args: string[]): Promise<string> {
	const result = await reviewGit([...(await gitSafePrefix(reviewGit, cwd)), ...args], cwd);
	if (result.code !== 0) throw Object.assign(new Error(`git ${args[0]} failed: ${result.stderr || result.stdout}`), { gitCode: result.code });
	return result.stdout;
}

export async function checkReviewCheckout(root: string, head: string): Promise<void> {
	const actual = (await reviewCommand(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
	if (actual !== head) throw new Error("HEAD changed");
	const status = await reviewCommand(root, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
	if (status) throw new Error("worktree is not clean");
}

export async function prepareReviewRange(cwd: string, input: string): Promise<ReviewRange> {
	const ref = await normalizeReviewRef(reviewCommand, cwd, input);
	const root = (await reviewCommand(cwd, ["rev-parse", "--show-toplevel"])).trim();
	const head = (await reviewCommand(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
	await checkReviewCheckout(root, head);
	const base = await resolveReviewCommit(reviewCommand, root, ref, true);
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(base) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) throw new Error("invalid resolved commit");
	const mergeBase = await reviewMergeBase(reviewCommand, root, base, head);
	const flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none"];
	const raw = await reviewCommand(root, ["diff", "--raw", "-z", "--no-abbrev", ...flags, mergeBase, head, "--"]);
	const records = raw.split("\0");
	const blobs = new Set<string>();
	for (let i = 0; i < records.length - 1; i += 2) {
		const record = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]$/.exec(records[i]);
		if (!record || !records[i + 1]) throw new Error("invalid raw diff output");
		if (record[1] === "160000" || record[2] === "160000") throw new Error("gitlink changes cannot be reviewed as text");
		for (const id of [record[3], record[4]]) if (!/^0+$/.test(id)) blobs.add(id);
	}
	for (const id of blobs) {
		let blob: string;
		try { blob = await reviewCommand(root, ["cat-file", "blob", id]); }
		catch (error) { throw new Error(`changed blob cannot be inspected (1 MiB maximum): ${String(error)}`); }
		if (blob.includes("\0")) throw new Error("binary changes cannot be reviewed as text");
	}
	const numstat = await reviewCommand(root, ["diff", "--numstat", ...flags, mergeBase, head, "--"]);
	if (/^-\s+-\s/m.test(numstat)) throw new Error("binary changes cannot be reviewed as text");
	const diff = await reviewCommand(root, ["diff", ...flags, mergeBase, head, "--"]);
	if (!diff) throw new Error("empty range diff");
	if (diff.includes("\0")) throw new Error("binary changes cannot be reviewed as text");
	if (Buffer.byteLength(diff, "utf8") > 32 * 1024) throw new Error("range diff exceeds 32 KiB");
	return { root, base, head, mergeBase, diff };
}

export type GitRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<{ stdout: string; stderr?: string; code: number }>;

export const FSMONITOR_OFF = ["-c", "core.fsmonitor=false"] as const;
export const GIT_SAFE_PREFIX = ["--no-optional-locks", ...FSMONITOR_OFF] as const;
const DIFF_SAFE = ["--no-ext-diff", "--no-textconv"] as const;

export const GIT_AUDIT_OPERATIONS = ["status", "diff-stat", "diff", "log"] as const;
export type GitAuditOperation = (typeof GIT_AUDIT_OPERATIONS)[number];

export const MAX_GIT_OUTPUT_CHARS = 12_000;
const REF_PATTERN = /^(?:[0-9a-f]{7,40}|HEAD(?:~\d{1,3})?)$/;

export interface GitAuditRequest {
	operation: GitAuditOperation;
	base?: string;
	path?: string;
	maxEntries?: number;
}

/** True when `git --version` output reports 2.15 or later. */
export function supportsNoOptionalLocks(versionOutput: string): boolean {
	const m = /git version (\d+)\.(\d+)/.exec(versionOutput);
	if (!m) return false;
	const [major, minor] = [Number(m[1]), Number(m[2])];
	return major > 2 || (major === 2 && minor >= 15);
}

const prefixes = new WeakMap<GitRunner, Promise<readonly string[]>>();

/** The safe argv prefix for this runner; `git --version` is probed once per runner. */
export function gitSafePrefix(run: GitRunner, cwd: string): Promise<readonly string[]> {
	let prefix = prefixes.get(run);
	if (!prefix) {
		prefix = Promise.resolve()
			.then(() => run(["--version"], cwd))
			.then((r) => (r.code === 0 && supportsNoOptionalLocks(r.stdout) ? GIT_SAFE_PREFIX : FSMONITOR_OFF))
			.catch(() => FSMONITOR_OFF);
		prefixes.set(run, prefix);
	}
	return prefix;
}

async function git(run: GitRunner, args: readonly string[], cwd: string) {
	return run([...(await gitSafePrefix(run, cwd)), ...args], cwd);
}

/** `rev-parse --is-inside-work-tree`; false when git fails or reports "false" (inside .git). */
export async function isWorkTree(run: GitRunner, cwd: string): Promise<boolean> {
	const r = await git(run, ["rev-parse", "--is-inside-work-tree"], cwd);
	return r.code === 0 && r.stdout.trim() !== "false";
}

export const notWorkTree = (cwd: string) => `${cwd} is not inside a git work tree; pass cwd=<repo>`;

/** Build the argv for one git_audit operation, or explain why it is refused. */
export function auditArgv(request: GitAuditRequest): { ok: true; args: string[] } | { ok: false; error: string } {
	const { operation, base, path } = request;
	if (base !== undefined && !REF_PATTERN.test(base)) {
		return { ok: false, error: "base must be a commit sha (7-40 hex) or HEAD, HEAD~N" };
	}
	if (path !== undefined && (!path.trim() || path.startsWith("-"))) {
		return { ok: false, error: "path must be non-empty and must not start with '-'" };
	}
	const pathArgs = path ? ["--", path] : [];
	switch (operation) {
		case "status":
			return { ok: true, args: ["status", "--porcelain", "--branch", "--untracked-files=all", ...pathArgs] };
		case "diff-stat":
			return { ok: true, args: ["diff", "--stat", ...DIFF_SAFE, ...(base ? [base] : []), ...pathArgs] };
		case "diff":
			return { ok: true, args: ["diff", ...DIFF_SAFE, ...(base ? [base] : []), ...pathArgs] };
		case "log": {
			const n = Math.min(Math.max(Math.trunc(request.maxEntries ?? 10), 1), 50);
			return { ok: true, args: ["log", "--oneline", `-n${n}`, ...pathArgs] };
		}
		default:
			return { ok: false, error: `unknown operation ${String(operation)}` };
	}
}

export async function runGitAudit(run: GitRunner, request: GitAuditRequest, cwd: string): Promise<{ ok: boolean; text: string }> {
	const argv = auditArgv(request);
	if (!argv.ok) return { ok: false, text: `git_audit refused: ${argv.error}` };
	if (!(await isWorkTree(run, cwd))) return { ok: false, text: notWorkTree(cwd) };
	const result = await git(run, argv.args, cwd);
	if (result.code !== 0) return { ok: false, text: `git ${request.operation} failed: ${(result.stderr || result.stdout).trim()}` };
	return { ok: true, text: clip(result.stdout.trimEnd() || "(no output)", MAX_GIT_OUTPUT_CHARS) };
}

/** What the workspace looked like when a delegation started. */
export interface WorkBase {
	/** false: cwd is not in a git work tree; undefined: unknown (git threw). */
	inWorkTree?: boolean;
	head?: string;
	dirtyBefore: number;
	/**
	 * Content fingerprint (blob id, or "absent") of every path that was already
	 * uncommitted; undefined when not captured (too many paths, git failed).
	 */
	dirty?: Record<string, string>;
	/** Work-tree root; status/diff paths are relative to it, so later calls run there. */
	root?: string;
	operationsBefore?: string[];
}

const operationRefs = [
	["MERGE_HEAD", "merge"],
	["REBASE_HEAD", "rebase"],
	["CHERRY_PICK_HEAD", "cherry-pick"],
	["REVERT_HEAD", "revert"],
] as const;

async function gitOperations(run: GitRunner, cwd: string): Promise<string[]> {
	const found: string[] = [];
	for (const [ref, name] of operationRefs) {
		try {
			const result = await git(run, ["rev-parse", "-q", "--verify", ref], cwd);
			if (result.code === 0 && /^[0-9a-f]{40,64}$/i.test(result.stdout.trim())) found.push(name);
		} catch {
			// An unavailable probe is not evidence of an operation.
		}
	}
	return found;
}

/** Above this many uncommitted paths, fingerprinting is skipped and the summary keeps the plain note. */
export const MAX_FINGERPRINT_PATHS = 500;
/** Above this many changed paths, the diff stat runs without a pathspec. */
const MAX_PATHSPEC_PATHS = 200;
/** Above this many files in one commit, the committed-files echo lists the first 100 plus `… N more`. */
const MAX_COMMIT_FILES = 100;
const ABSENT = "absent";

/** Paths from `status --porcelain -z`: `XY path\0`, renames/copies add `old\0` after the new path. */
export function parseStatusZ(out: string): string[] {
	const parts = out.split("\0");
	const paths: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (entry.length < 4 || entry[2] !== " ") continue;
		const xy = entry.slice(0, 2);
		paths.push(entry.slice(3));
		if (xy.includes("R") || xy.includes("C")) i++;
	}
	return paths;
}

/** Blob id per path via `hash-object` (works on git 1.8); a path that cannot be hashed is "absent". */
async function fingerprint(run: GitRunner, cwd: string, paths: string[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	if (!paths.length) return out;
	const all = await git(run, ["hash-object", "--", ...paths], cwd);
	const ids = all.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
	if (all.code === 0 && ids.length === paths.length) {
		paths.forEach((p, i) => { out[p] = ids[i]; });
		return out;
	}
	// One missing path fails the whole call: hash one by one.
	for (const p of paths) {
		const one = await git(run, ["hash-object", "--", p], cwd);
		out[p] = one.code === 0 && one.stdout.trim() ? one.stdout.trim() : ABSENT;
	}
	return out;
}

export async function captureBase(run: GitRunner, cwd: string): Promise<WorkBase> {
	if (!(await isWorkTree(run, cwd))) return { inWorkTree: false, dirtyBefore: 0 };
	const operationsBefore = await gitOperations(run, cwd);
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code !== 0) return { inWorkTree: true, dirtyBefore: 0, operationsBefore };
	const top = await git(run, ["rev-parse", "--show-toplevel"], cwd);
	const root = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;
	const status = await git(run, ["status", "--porcelain", "-z", "--untracked-files=all"], root);
	if (status.code !== 0) return { inWorkTree: true, head: head.stdout.trim(), dirtyBefore: 0, root, operationsBefore };
	const paths = parseStatusZ(status.stdout);
	const base: WorkBase = { inWorkTree: true, head: head.stdout.trim(), dirtyBefore: paths.length, root, operationsBefore };
	if (paths.length <= MAX_FINGERPRINT_PATHS) base.dirty = await fingerprint(run, root, paths).catch(() => undefined);
	return base;
}

const listPaths = (paths: string[], max = 10) =>
	paths.slice(0, max).join(", ") + (paths.length > max ? `, … ${paths.length - max} more` : "");

/** How the paths that were already uncommitted at the base relate to the child's work. */
export interface ChangedPaths {
	/** Same content as before and not committed by the child: the child did not touch them. */
	untouched: Set<string>;
	/** Content changed, or committed by the child: their diff includes the earlier edits. */
	touchedDirty: string[];
}

/**
 * Pure reconciliation of the base fingerprints against the current ones.
 * A path the child committed is never "untouched", even if its work-tree
 * content is unchanged. Order of `touchedDirty` follows `before`.
 */
export function classifyChangedPaths(
	before: Record<string, string>,
	now: Record<string, string>,
	committed: ReadonlySet<string>,
): ChangedPaths {
	const untouched = new Set<string>();
	const touchedDirty: string[] = [];
	for (const p of Object.keys(before)) {
		if (now[p] === before[p] && !committed.has(p)) untouched.add(p);
		else touchedDirty.push(p);
	}
	return { untouched, touchedDirty };
}

const splitZ = (out: string) => out.split("\0").filter(Boolean);

/** `log --oneline base..HEAD` lines, or undefined when HEAD did not move or the log failed. */
async function listNewCommits(run: GitRunner, cwd: string, baseHead: string): Promise<string | undefined> {
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code !== 0 || head.stdout.trim() === baseHead) return undefined;
	const log = await git(run, ["log", "--oneline", "-n20", `${baseHead}..HEAD`], cwd);
	return log.code === 0 && log.stdout.trim() ? log.stdout.trimEnd() : "";
}

/**
 * Re-fingerprint the paths dirty at the base and classify them; undefined when
 * the base has no fingerprints or the current state cannot be determined.
 */
async function reconcileDirtyPaths(run: GitRunner, root: string, base: WorkBase, moved: boolean): Promise<ChangedPaths | undefined> {
	const before = base.dirty;
	if (!before || !base.head) return undefined;
	const now = await fingerprint(run, root, Object.keys(before)).catch(() => undefined);
	if (!now) return undefined;
	let committed = new Set<string>();
	if (moved) {
		const inCommits = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, base.head, "HEAD"], root);
		if (inCommits.code !== 0) return undefined; // cannot tell what the commits touched: keep the plain note
		committed = new Set(splitZ(inCommits.stdout));
	}
	return classifyChangedPaths(before, now, committed);
}

/**
 * `diff --stat` since the base, restricted to paths the child touched; undefined
 * when nothing remains. Above MAX_PATHSPEC_PATHS the pathspec is dropped.
 */
async function diffStatArgv(run: GitRunner, root: string, baseHead: string, untouched: ReadonlySet<string>): Promise<string[] | undefined> {
	const statArgs = ["diff", "--stat", ...DIFF_SAFE, baseHead];
	if (!untouched.size) return statArgs;
	const names = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, baseHead], root);
	if (names.code !== 0) return statArgs;
	const remaining = splitZ(names.stdout).filter((p) => !untouched.has(p));
	if (!remaining.length) return undefined;
	return remaining.length > MAX_PATHSPEC_PATHS ? statArgs : [...statArgs, "--", ...remaining];
}

async function diffStat(run: GitRunner, root: string, baseHead: string, untouched: ReadonlySet<string>): Promise<string> {
	const argv = await diffStatArgv(run, root, baseHead, untouched);
	const stat = argv ? await git(run, argv, root) : undefined;
	return stat && stat.code === 0 && stat.stdout.trim() ? `Diff since ${baseHead.slice(0, 8)}:\n${stat.stdout.trimEnd()}` : "Tracked files: no changes.";
}

/** Untracked, non-ignored files minus the ones the child did not touch. */
async function listUntracked(run: GitRunner, root: string, untouched: ReadonlySet<string>): Promise<string[]> {
	const untracked = await git(run, ["ls-files", "--others", "--exclude-standard", "-z"], root);
	return untracked.code === 0 ? splitZ(untracked.stdout).filter((p) => !untouched.has(p)) : [];
}

function dirtyNotes(base: WorkBase, changed: ChangedPaths | undefined): string[] {
	if (!changed) {
		return base.dirtyBefore > 0 ? [`Note: ${base.dirtyBefore} path(s) were already uncommitted before this delegation; the diff includes them.`] : [];
	}
	const lines: string[] = [];
	// Count only: listing the same unrelated dirty paths after every delegation cost Root ~700 chars a turn (ticket 10).
	if (changed.untouched.size) lines.push(`Unchanged by the child: ${changed.untouched.size} pre-existing uncommitted path(s), excluded above.`);
	if (changed.touchedDirty.length) {
		lines.push(`Note: ${changed.touchedDirty.length} path(s) were already uncommitted before this delegation and changed again; their diff includes the earlier edits: ${listPaths(changed.touchedDirty)}`);
	}
	return lines;
}

/** Changes since the base: new commits, tracked diff stat, untracked files. */
export async function summarizeWork(run: GitRunner, cwd: string, base: WorkBase, maxChars = 3_000): Promise<string> {
	if (base.inWorkTree === false) {
		return `Workspace changes: ${cwd} is not a git work tree — if the child edited another repository, pass that repository as cwd next time.`;
	}
	if (!base.head) return "Workspace changes: not a git repository (or no commits); inspect the files directly.";
	const lines: string[] = [];
	const operations = [...new Set([...(base.operationsBefore ?? []), ...await gitOperations(run, cwd)])];
	if (operations.length) lines.push(`Note: ${operations.join(", ")} operation(s) were detected before or after delegation; the diff may include changes brought in or replayed by the operation, not only the child's work.`);
	// All path-level calls run at the work-tree root, where status/diff paths are anchored.
	const root = base.root ?? cwd;
	const commits = await listNewCommits(run, cwd, base.head);
	if (commits) lines.push("New commits:", commits);
	const changed = await reconcileDirtyPaths(run, root, base, commits !== undefined);
	const untouched = changed?.untouched ?? new Set<string>();
	lines.push(await diffStat(run, root, base.head, untouched));
	const files = await listUntracked(run, root, untouched);
	if (files.length) {
		lines.push(`Untracked files (${files.length}):`, ...files.slice(0, 30), ...(files.length > 30 ? [`… ${files.length - 30} more`] : []));
	}
	lines.push(...dirtyNotes(base, changed));
	return clip(lines.join("\n"), maxChars);
}

/** Stage and commit. Without paths, all changes (including untracked) are staged. */
export async function gitCommit(run: GitRunner, cwd: string, message: string, paths?: string[]): Promise<{ ok: boolean; text: string }> {
	if (!message.trim()) return { ok: false, text: "git_commit refused: message is empty" };
	if (paths?.some((p) => !p.trim() || p.startsWith("-"))) {
		return { ok: false, text: "git_commit refused: paths must be non-empty and must not start with '-'" };
	}
	if (!(await isWorkTree(run, cwd))) return { ok: false, text: notWorkTree(cwd) };
	const add = await git(run, paths?.length ? ["add", "--", ...paths] : ["add", "-A"], cwd);
	if (add.code !== 0) return { ok: false, text: `git add failed: ${(add.stderr || add.stdout).trim()}` };
	const commit = await git(run, ["commit", "-m", message], cwd);
	if (commit.code !== 0) {
		return {
			ok: false,
			text: `git commit failed: ${(commit.stderr || commit.stdout).trim()}\nThe changes staged by git_commit are still staged; fix the cause and call git_commit again.`,
		};
	}
	const files = await committedFiles(run, cwd);
	const show = await git(run, ["show", "--stat", "--oneline", ...DIFF_SAFE, "HEAD"], cwd);
	const stat = show.code === 0 ? show.stdout.trimEnd() : commit.stdout.trimEnd();
	let text = stat;
	if (files) {
		const [header, ...remaining] = stat.split("\n");
		text = [header, files, ...remaining].filter((line) => line !== undefined).join("\n");
	}
	return { ok: true, text: clip(text, 3_000) };
}

/** Paths changed by HEAD, so the commit result names every staged file even when `--stat` is clipped. */
async function committedFiles(run: GitRunner, cwd: string): Promise<string | undefined> {
	const names = await git(run, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", ...DIFF_SAFE, "HEAD"], cwd);
	if (names.code !== 0) return undefined;
	const files = splitZ(names.stdout).filter((p) => p.trim());
	if (!files.length) return undefined;
	const shown = files.slice(0, MAX_COMMIT_FILES);
	return `Committed files (${files.length}): ${shown.join(", ")}${files.length > shown.length ? `, … ${files.length - shown.length} more` : ""}`;
}

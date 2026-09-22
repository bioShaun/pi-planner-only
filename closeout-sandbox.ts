import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
	lstat,
	readdir,
	readFile,
	readlink,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CloseoutCommand, CloseoutEffectiveControls, CloseoutIdentity } from "./closeout-types.ts";
import { stableStringify } from "./report.ts";

const OUTPUT_LIMIT = 1024 * 1024;
const SCRATCH_LIMIT = 64 * 1024 * 1024;
const SCRATCH_ENTRY_LIMIT = 8192;
const MAX_COMMAND_MS = 60_000;
const EXPECTED_CONTROLS: CloseoutEffectiveControls = {
	memoryMaxBytes: 1_073_741_824,
	memorySwapMaxBytes: 0,
	pidsMax: 32,
	cpuQuotaUs: 100_000,
	cpuPeriodUs: 100_000,
};

export interface CloseoutRuntimeMount {
	source: string;
	destination: string;
	kind: "file" | "directory";
	manifestSha256: string;
}

export interface CloseoutRuntimeProfile {
	version: 1;
	id: "system-python-unittest-v1" | "system-python-tools-v1";
	executables: Readonly<Record<string, string>>;
	readonlyMounts: readonly CloseoutRuntimeMount[];
	hostTools: Readonly<Record<string, { path: string; sha256: string }>>;
	dependencyManifestSha256: string;
	controls: CloseoutEffectiveControls;
	outputLimitBytes: number;
	scratchLimitBytes: number;
	scratchEntryLimit: number;
	scratchAccounting: "tmpfs-hardcap-plus-proc-lstat-v2";
	pythonStartupPolicy: "trusted-path-no-site-v1";
	maxCommandMs: number;
	seccompPolicy: "deny-socket-mount-namespace-ptrace-bpf-v1";
	mountPolicy: "readonly-root-proc-dev-private-scratch-tmpfs-v2";
	isolationProfileSha256: string;
}

export interface CloseoutRuntimeSample {
	observedAt: string;
	controls: CloseoutEffectiveControls;
}

export interface CloseoutRawRuntimeObservation extends CloseoutIdentity {
	version: 1;
	attemptSequence: number;
	isolationProfileSha256: string;
	state: "complete" | "unknown";
	unknownReason?: string;
	scopeUnit: string;
	cgroupPath: string;
	cgroupId: string;
	hostBootId: string;
	namespaceInitPid: number;
	namespaceInitStartTicks: string;
	before: CloseoutRuntimeSample | null;
	after: CloseoutRuntimeSample | null;
	kernelEvidence: Buffer;
}

export interface CloseoutSandboxResult {
	outcome: "passed" | "failed" | "timed_out" | "cancelled" | "startup_failed" | "evidence_failed";
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	cancelled: boolean;
	startupError: string | null;
	processTreeStopped: boolean;
	startedAt: string;
	endedAt: string;
	durationMs: number;
	stdout: Buffer;
	stderr: Buffer;
	stdoutComplete: boolean;
	stderrComplete: boolean;
	runtimeObservation: CloseoutRawRuntimeObservation;
}

export interface RunCloseoutSandboxInput {
	command: CloseoutCommand;
	identity: CloseoutIdentity;
	attemptSequence: number;
	expectedControls: CloseoutEffectiveControls;
	isolationProfileSha256: string;
	snapshotRoot: string;
	originalCwd: string;
	runtimeProfile: CloseoutRuntimeProfile;
	deadlineMs: number;
	signal?: AbortSignal;
	artifactRoot: string;
	onResult: (rawResult: CloseoutSandboxResult) => Promise<void>;
}

type ManifestRow =
	| { path: string; type: "file"; mode: number; size: number; sha256: string }
	| { path: string; type: "directory"; mode: number }
	| { path: string; type: "symlink"; mode: number; target: string };

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function hashMount(source: string, kind: "file" | "directory"): Promise<string> {
	const rows: ManifestRow[] = [];
	const root = await realpath(source);
	const rootStats = await stat(root);
	if (kind === "file") {
		if (!rootStats.isFile()) throw new Error(`runtime mount is not a regular file: ${source}`);
		rows.push({
			path: ".",
			type: "file",
			mode: rootStats.mode & 0o7777,
			size: rootStats.size,
			sha256: sha256(await readFile(root)),
		});
	} else {
		if (!rootStats.isDirectory()) throw new Error(`runtime mount is not a directory: ${source}`);
		rows.push({ path: ".", type: "directory", mode: rootStats.mode & 0o7777 });
		const visit = async (directory: string): Promise<void> => {
			const names = (await readdir(directory)).sort();
			for (const name of names) {
				const absolute = path.join(directory, name);
				const relative = path.relative(root, absolute).split(path.sep).join("/");
				const item = await lstat(absolute);
				if (item.isDirectory()) {
					rows.push({ path: relative, type: "directory", mode: item.mode & 0o7777 });
					await visit(absolute);
				} else if (item.isFile()) {
					rows.push({
						path: relative,
						type: "file",
						mode: item.mode & 0o7777,
						size: item.size,
						sha256: sha256(await readFile(absolute)),
					});
				} else if (item.isSymbolicLink()) {
					rows.push({
						path: relative,
						type: "symlink",
						mode: item.mode & 0o7777,
						target: await readlink(absolute),
					});
				} else {
					throw new Error(`special file in runtime mount: ${absolute}`);
				}
			}
		};
		await visit(root);
	}
	// Match the supervisor canonical ordering across directory boundaries
	// (e.g. package.dist-info sorts before package/__init__.py).
	rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return sha256(stableStringify(rows));
}

function parseLdd(executable: string): Array<{ source: string; destination: string }> {
	const probe = spawnSync("/usr/bin/ldd", [executable], {
		encoding: "utf8",
		env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
	});
	if (probe.error || probe.status !== 0) {
		throw new Error(`unable to inspect system Python dynamic libraries: ${probe.error?.message ?? probe.stderr}`);
	}
	const libraries = new Map<string, string>();
	for (const rawLine of probe.stdout.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("linux-vdso")) continue;
		if (line === "statically linked") continue;
		const match = line.match(/^(?:\S+\s+=>\s+)?(\/\S+)(?:\s+\(|$)/);
		if (!match) throw new Error(`unsupported ldd output: ${line}`);
		const destination = match[1];
		if (!path.isAbsolute(destination) || destination.includes("\0")) {
			throw new Error(`hostile library path from ldd: ${destination}`);
		}
		libraries.set(destination, destination);
	}
	return [...libraries].map(([destination, source]) => ({ source, destination }));
}

async function sharedObjects(root: string): Promise<string[]> {
	const result: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const name of (await readdir(directory)).sort()) {
			const absolute = path.join(directory, name);
			const info = await lstat(absolute);
			if (info.isDirectory()) await visit(absolute);
			else if (info.isFile() && name.endsWith(".so")) result.push(absolute);
		}
	};
	await visit(root);
	return result;
}

async function resolveExecutable(name: string): Promise<string> {
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!path.isAbsolute(directory)) continue;
		const candidate = path.join(directory, name);
		try {
			const info = await stat(candidate);
			if (info.isFile() && (info.mode & 0o111) !== 0) return realpath(candidate);
		} catch {
			// Keep looking through the fixed host PATH.
		}
	}
	throw new Error(`required closeout host tool is unavailable: ${name}`);
}

/** A dedicated, preinstalled dependency closure; never infer the ambient venv,
 * user site-packages or project PATH. All bytes are bound by the mount manifest. */
export async function discoverCloseoutRuntimeProfile(options: { pythonToolsRoot?: string } = {}): Promise<CloseoutRuntimeProfile> {
	if (process.platform !== "linux") throw new Error("closeout sandbox requires Linux");
	const pythonLink = "/usr/bin/python3";
	const python = await realpath(pythonLink);
	if (!/^\/usr\/bin\/python3\.\d+$/.test(python)) {
		throw new Error(`unsupported system Python path: ${python}`);
	}
	const version = path.basename(python).slice("python".length);
	const stdlib = `/usr/lib/python${version}`;
	const dynamicInputs = [python, ...(await sharedObjects(stdlib))];
	const configuredTools = options.pythonToolsRoot ?? process.env.PI_PLANNER_CLOSEOUT_PYTHON_TOOLS;
	let toolsRoot: string | undefined;
	if (configuredTools !== undefined) {
		if (!path.isAbsolute(configuredTools)) throw new Error("closeout Python tools root must be absolute");
		toolsRoot = await realpath(configuredTools);
		if (!(await stat(toolsRoot)).isDirectory()) throw new Error("closeout Python tools root must be a directory");
		for (const module of ["pytest", "ruff", "mypy"]) {
			if (!(await stat(path.join(toolsRoot, module, "__main__.py"))).isFile()) {
				throw new Error(`closeout Python tools closure is missing ${module}`);
			}
		}
		// Disallow hidden mutable/external dependencies, including symlinked
		// environments. Bound discovery before recursively hashing the closure.
		let entries = 0;
		let bytes = 0;
		const inspect = async (directory: string): Promise<void> => {
			for (const name of await readdir(directory)) {
				const file = path.join(directory, name);
				const info = await lstat(file);
				if (++entries > 20000 || (bytes += info.isFile() ? info.size : 0) > 256 * 1024 * 1024) {
					throw new Error("closeout Python tools closure exceeds its bounds");
				}
				if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
					throw new Error("closeout Python tools closure must contain only regular files and directories");
				}
				if (info.isDirectory()) await inspect(file);
			}
		};
		await inspect(toolsRoot);
		dynamicInputs.push(...await sharedObjects(toolsRoot));
		const ruffBinary = path.join(toolsRoot, "bin", "ruff");
		if (!(await stat(ruffBinary)).isFile()) throw new Error("closeout Python tools closure is missing the Ruff binary");
		dynamicInputs.push(ruffBinary);
	}
	const dynamicLibraries = dynamicInputs.flatMap((input) => parseLdd(input));
	const candidates = [
		{ source: python, destination: python, kind: "file" as const },
		{ source: python, destination: pythonLink, kind: "file" as const },
		{ source: stdlib, destination: stdlib, kind: "directory" as const },
		...dynamicLibraries.map(({ source, destination }) => ({
			source,
			destination,
			kind: "file" as const,
		})),
	];
	if (toolsRoot) {
		candidates.push({ source: toolsRoot, destination: "/opt/planner-closeout/python-tools", kind: "directory" });
		candidates.push({ source: path.join(toolsRoot, "bin", "ruff"), destination: "/usr/bin/ruff", kind: "file" });
	}
	const unique = new Map<string, (typeof candidates)[number]>();
	for (const candidate of candidates) unique.set(candidate.destination, candidate);
	const readonlyMounts: CloseoutRuntimeMount[] = [];
	for (const candidate of [...unique.values()].sort((a, b) => a.destination.localeCompare(b.destination))) {
		const source = await realpath(candidate.source);
		readonlyMounts.push({
			source,
			destination: candidate.destination,
			kind: candidate.kind,
			manifestSha256: await hashMount(source, candidate.kind),
		});
	}
	const dependencyManifestSha256 = sha256(stableStringify(readonlyMounts));
	const hostToolPaths = {
		bwrap: await realpath("/usr/bin/bwrap"),
		systemdRun: await realpath("/usr/bin/systemd-run"),
		systemctl: await realpath("/usr/bin/systemctl"),
		slot: await resolveExecutable("slot"),
		libseccomp: await realpath("/lib/x86_64-linux-gnu/libseccomp.so.2"),
	};
	const hostTools = Object.fromEntries(
		await Promise.all(
			Object.entries(hostToolPaths).map(async ([name, toolPath]) => [
				name,
				{ path: toolPath, sha256: sha256(await readFile(toolPath)) },
			] as const),
		),
	);
	const executables: Record<string, string> = { python3: pythonLink };
	if (toolsRoot) for (const name of ["pytest", "ruff", "mypy"]) executables[name] = pythonLink;
	const profileCore = {
		version: 1 as const,
		id: toolsRoot ? "system-python-tools-v1" as const : "system-python-unittest-v1" as const,
		executables,
		readonlyMounts,
		hostTools,
		dependencyManifestSha256,
		controls: EXPECTED_CONTROLS,
		outputLimitBytes: OUTPUT_LIMIT,
		scratchLimitBytes: SCRATCH_LIMIT,
		scratchEntryLimit: SCRATCH_ENTRY_LIMIT,
		scratchAccounting: "tmpfs-hardcap-plus-proc-lstat-v2" as const,
		pythonStartupPolicy: "trusted-path-no-site-v1" as const,
		maxCommandMs: MAX_COMMAND_MS,
		seccompPolicy: "deny-socket-mount-namespace-ptrace-bpf-v1" as const,
		mountPolicy: "readonly-root-proc-dev-private-scratch-tmpfs-v2" as const,
	};
	return { ...profileCore, isolationProfileSha256: sha256(stableStringify(profileCore)) };
}

function exactControls(actual: CloseoutEffectiveControls): boolean {
	return Object.entries(EXPECTED_CONTROLS).every(
		([key, value]) => actual[key as keyof CloseoutEffectiveControls] === value,
	);
}

function assertSafeInput(input: RunCloseoutSandboxInput): void {
	if (!Number.isInteger(input.attemptSequence) || input.attemptSequence <= 0) {
		throw new Error("attemptSequence must be a positive integer");
	}
	if (!Number.isFinite(input.deadlineMs) || input.deadlineMs <= Date.now()) {
		throw new Error("closeout deadline has expired");
	}
	if (!exactControls(input.expectedControls)) throw new Error("unsupported closeout cgroup controls");
	if (input.isolationProfileSha256 !== input.runtimeProfile.isolationProfileSha256) {
		throw new Error("runtime isolation profile hash mismatch");
	}
	if (!["system-python-unittest-v1", "system-python-tools-v1"].includes(input.runtimeProfile.id)) {
		throw new Error(`unsupported runtime profile: ${input.runtimeProfile.id}`);
	}
	const { isolationProfileSha256, ...profileCore } = input.runtimeProfile;
	if (sha256(stableStringify(profileCore)) !== isolationProfileSha256) {
		throw new Error("runtime profile contents do not match its hash");
	}
	if (!exactControls(input.runtimeProfile.controls)) throw new Error("runtime profile controls changed");
	if (
		input.runtimeProfile.outputLimitBytes !== OUTPUT_LIMIT ||
		input.runtimeProfile.scratchLimitBytes !== SCRATCH_LIMIT ||
		input.runtimeProfile.scratchEntryLimit !== SCRATCH_ENTRY_LIMIT ||
		input.runtimeProfile.scratchAccounting !== "tmpfs-hardcap-plus-proc-lstat-v2" ||
		input.runtimeProfile.maxCommandMs !== MAX_COMMAND_MS ||
		input.runtimeProfile.seccompPolicy !== "deny-socket-mount-namespace-ptrace-bpf-v1" ||
		input.runtimeProfile.mountPolicy !== "readonly-root-proc-dev-private-scratch-tmpfs-v2" ||
		input.runtimeProfile.pythonStartupPolicy !== "trusted-path-no-site-v1"
	) {
		throw new Error("unsupported runtime profile limits or seccomp policy");
	}
	if (input.command.environmentProfileId !== input.runtimeProfile.id) {
		throw new Error("command environment profile mismatch");
	}
	if (input.command.executable !== input.runtimeProfile.executables.python3) {
		throw new Error("only the fixed system Python executable is supported");
	}
	if (input.command.cwd !== input.originalCwd) throw new Error("command cwd does not match original cwd");
	if (!path.isAbsolute(input.originalCwd) || !path.isAbsolute(input.snapshotRoot) || !path.isAbsolute(input.artifactRoot)) {
		throw new Error("sandbox paths must be absolute");
	}
	if (input.command.timeoutMs <= 0 || input.command.timeoutMs > MAX_COMMAND_MS) {
		throw new Error("command timeout must be in the range 1..60000ms");
	}
	if (
		input.command.argv.length < 2 ||
		input.command.argv[0] !== "-m" ||
		!(input.runtimeProfile.id === "system-python-tools-v1" ? ["unittest", "pytest", "ruff", "mypy"] : ["unittest"]).includes(input.command.argv[1])
	) {
		throw new Error("closeout profile does not support the requested Python validation module");
	}
	for (const argument of input.command.argv) {
		if (typeof argument !== "string" || argument.includes("\0")) throw new Error("invalid command argument");
	}
	const { descriptorSha256, ...descriptorBody } = input.command;
	if (!/^[0-9a-f]{64}$/.test(descriptorSha256) || sha256(stableStringify(descriptorBody)) !== descriptorSha256) {
		throw new Error("command descriptor hash mismatch");
	}
}

async function runPreflight(
	artifactRoot: string,
	attemptSequence: number,
	deadlineMs: number,
	slotPath: string,
): Promise<void> {
	const startedAt = new Date().toISOString();
	for (const command of ["audit", "status"] as const) {
		const remainingMs = deadlineMs - Date.now();
		if (remainingMs <= 0) throw new Error("closeout deadline expired during slot preflight");
		const result = spawnSync(slotPath, [command], {
			encoding: "utf8",
			env: { ...process.env, PATH: process.env.PATH ?? "/usr/bin:/bin" },
			timeout: Math.min(5_000, remainingMs),
			maxBuffer: 1024 * 1024,
		});
		await writeFile(
			path.join(artifactRoot, `slot-${attemptSequence}-${command}.log`),
			`startedAt=${startedAt}\nexitCode=${result.status ?? "null"}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
			{ flag: "wx", mode: 0o600 },
		);
		if (result.error || result.status !== 0) {
			throw new Error(`slot ${command} failed: ${result.error?.message ?? result.stderr}`);
		}
	}
}

function decodeResult(encoded: Record<string, unknown>): CloseoutSandboxResult {
	const {
		stdoutBase64,
		stderrBase64,
		runtimeObservation: encodedObservation,
		...plainResult
	} = encoded;
	if (!encodedObservation || typeof encodedObservation !== "object" || Array.isArray(encodedObservation)) {
		throw new Error("sandbox supervisor returned an invalid runtime observation");
	}
	const { kernelEvidenceBase64, ...plainObservation } = encodedObservation as Record<string, unknown>;
	return {
		...(plainResult as unknown as Omit<CloseoutSandboxResult, "stdout" | "stderr" | "runtimeObservation">),
		stdout: Buffer.from(String(stdoutBase64 ?? ""), "base64"),
		stderr: Buffer.from(String(stderrBase64 ?? ""), "base64"),
		runtimeObservation: {
			...(plainObservation as unknown as Omit<CloseoutRawRuntimeObservation, "kernelEvidence">),
			kernelEvidence: Buffer.from(String(kernelEvidenceBase64 ?? ""), "base64"),
		},
	};
}

async function waitForProtocolResult(
	child: ChildProcessWithoutNullStreams,
	deadlineMs: number,
	signal: AbortSignal | undefined,
): Promise<CloseoutSandboxResult> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			child.stdin.write('{"type":"cancel","reason":"deadline"}\n');
		}, Math.max(0, deadlineMs - Date.now()));
		const hardTimeout = setTimeout(() => {
			finish(new Error("sandbox supervisor did not stop after deadline"));
		}, Math.max(5_000, deadlineMs - Date.now() + 5_000));
		const abort = () => child.stdin.write('{"type":"cancel","reason":"abort"}\n');
		signal?.addEventListener("abort", abort, { once: true });
		const finish = (error?: Error, result?: CloseoutSandboxResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			clearTimeout(hardTimeout);
			signal?.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolve(result!);
		};
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (stdout.length > 4 * 1024 * 1024) finish(new Error("sandbox supervisor protocol overflow"));
			for (;;) {
				const newline = stdout.indexOf("\n");
				if (newline < 0) break;
				const line = stdout.slice(0, newline);
				stdout = stdout.slice(newline + 1);
				if (!line.startsWith("CLOSEOUT_RESULT ")) continue;
				try {
					finish(undefined, decodeResult(JSON.parse(line.slice("CLOSEOUT_RESULT ".length))));
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = `${stderr}${chunk}`.slice(-64 * 1024);
		});
		child.on("error", (error) => finish(error));
		child.on("exit", (code, childSignal) => {
			finish(new Error(`sandbox supervisor exited before result (${code ?? childSignal}): ${stderr}`));
		});
	});
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
	if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), timeoutMs);
		child.once("exit", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}

interface ObservedScope {
	cgroupPath: string;
	cgroupId: string;
}

interface ScopeQueryResult {
	status: number | null;
	stdout: string;
	error?: Error;
}

type CgroupInspection = "absent" | "empty" | "populated" | "identity-mismatch" | "error";

export function evaluateCloseoutScopeStopped(
	show: ScopeQueryResult,
	expected: ObservedScope | undefined,
	inspect: (cgroupPath: string, expectedCgroupId?: string) => CgroupInspection,
): boolean {
	if (show.error || show.status !== 0) return false;
	const properties = Object.fromEntries(
		show.stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split("=", 2) as [string, string]),
	);
	const loadState = properties.LoadState ?? "";
	const activeState = properties.ActiveState ?? "";
	const reportedPath = properties.ControlGroup ?? "";
	if (loadState === "not-found") {
		return Boolean(expected) && inspect(expected!.cgroupPath, expected!.cgroupId) === "absent";
	}
	if (loadState !== "loaded" || activeState === "active" || activeState === "activating") return false;
	if (!reportedPath.startsWith("/")) return false;
	if (expected && reportedPath !== expected.cgroupPath) return false;
	const inspection = inspect(reportedPath, expected?.cgroupId);
	return inspection === "empty" || (Boolean(expected) && inspection === "absent");
}

function inspectCgroup(cgroupPath: string, expectedCgroupId?: string): CgroupInspection {
	const directory = `/sys/fs/cgroup${cgroupPath}`;
	try {
		const directoryInfo = statSync(directory);
		if (expectedCgroupId && `${directoryInfo.dev}:${directoryInfo.ino}` !== expectedCgroupId) {
			return "identity-mismatch";
		}
		const processes = readFileSync(path.join(directory, "cgroup.procs"), "utf8");
		return processes.trim().length === 0 ? "empty" : "populated";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		return "error";
	}
}

function terminateScope(child: ChildProcessWithoutNullStreams, unit: string, expected?: ObservedScope): boolean {
	spawnSync(
		"/usr/bin/systemctl",
		["--user", "kill", "--kill-whom=all", "--signal=KILL", unit],
		{ encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024 },
	);
	child.kill("SIGKILL");
	return scopeStopped(unit, expected);
}

function scopeStopped(unit: string, expected?: ObservedScope): boolean {
	const show = spawnSync(
		"/usr/bin/systemctl",
		["--user", "show", "--property=LoadState", "--property=ActiveState", "--property=ControlGroup", unit],
		{ encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024 },
	);
	return evaluateCloseoutScopeStopped(
		{ status: show.status, stdout: show.stdout, error: show.error },
		expected,
		inspectCgroup,
	);
}

async function waitScopeStopped(unit: string, expected?: ObservedScope): Promise<boolean> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (scopeStopped(unit, expected)) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return scopeStopped(unit, expected);
}

export async function runCloseoutSandbox(input: RunCloseoutSandboxInput): Promise<CloseoutSandboxResult> {
	const enteredAtMs = Date.now();
	assertSafeInput(input);
	const effectiveDeadlineMs = Math.min(input.deadlineMs, enteredAtMs + input.command.timeoutMs);
	const [snapshotRoot, originalCwd, artifactRoot] = await Promise.all([
		realpath(input.snapshotRoot),
		realpath(input.originalCwd),
		realpath(input.artifactRoot),
	]);
	if (originalCwd !== input.originalCwd || snapshotRoot !== input.snapshotRoot || artifactRoot !== input.artifactRoot) {
		throw new Error("sandbox paths must already be canonical");
	}
	const disjoint = (left: string, right: string) =>
		left !== right && !left.startsWith(`${right}${path.sep}`) && !right.startsWith(`${left}${path.sep}`);
	if (!disjoint(snapshotRoot, artifactRoot) || !disjoint(originalCwd, artifactRoot)) {
		throw new Error("artifact root must be disjoint from source and snapshot roots");
	}
	for (const tool of Object.values(input.runtimeProfile.hostTools)) {
		if (sha256(await readFile(tool.path)) !== tool.sha256) {
			throw new Error(`closeout host tool changed: ${tool.path}`);
		}
	}
	await runPreflight(
		artifactRoot,
		input.attemptSequence,
		effectiveDeadlineMs,
		input.runtimeProfile.hostTools.slot.path,
	);
	if (Date.now() >= effectiveDeadlineMs) throw new Error("closeout deadline expired during slot preflight");

	const unit = `closeout-${randomUUID()}.scope`;
	const runner = fileURLToPath(new URL("./closeout-sandbox-runner.py", import.meta.url));
	const args = [
		"cpu",
		"-L",
		`closeout-${input.command.commandId}`,
		"--",
		input.runtimeProfile.hostTools.systemdRun.path,
		"--user",
		"--scope",
		`--unit=${unit}`,
		"--slice=heavy.slice",
		"--quiet",
		"--property=MemoryMax=1073741824",
		"--property=MemorySwapMax=0",
		"--property=TasksMax=32",
		"--property=CPUQuota=100%",
		"--",
		"/usr/bin/python3",
		runner,
	];
	const child = spawn(input.runtimeProfile.hostTools.slot.path, args, {
		cwd: artifactRoot,
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: process.env.HOME,
			XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
			DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
			LANG: "C",
			LC_ALL: "C",
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	const config = {
		version: 1,
		command: input.command,
		identity: input.identity,
		attemptSequence: input.attemptSequence,
		scopeUnit: unit,
		expectedControls: input.expectedControls,
		isolationProfileSha256: input.isolationProfileSha256,
		snapshotRoot,
		originalCwd,
		runtimeProfile: input.runtimeProfile,
		deadlineMs: effectiveDeadlineMs,
		limits: {
			outputBytes: OUTPUT_LIMIT,
			scratchBytes: SCRATCH_LIMIT,
			scratchEntries: SCRATCH_ENTRY_LIMIT,
		},
	};
	child.stdin.write(`${JSON.stringify(config)}\n`);
	if (input.signal?.aborted) child.stdin.write('{"type":"cancel","reason":"abort"}\n');
	let observedScope: ObservedScope | undefined;
	try {
		const result = await waitForProtocolResult(child, effectiveDeadlineMs, input.signal);
		if (result.runtimeObservation.cgroupPath && result.runtimeObservation.cgroupId) {
			observedScope = {
				cgroupPath: result.runtimeObservation.cgroupPath,
				cgroupId: result.runtimeObservation.cgroupId,
			};
		}
		try {
			await input.onResult(result);
		} catch (error) {
			child.stdin.write('{"type":"abort-seal"}\n');
			child.stdin.end();
			await waitForExit(child, 5_000);
			throw error;
		}
		child.stdin.write('{"type":"ack"}\n');
		child.stdin.end();
		const supervisorExit = await waitForExit(child, 5_000);
		if (supervisorExit !== 0) {
			const stopped = terminateScope(child, unit, observedScope);
			throw new Error(
				`closeout supervisor/scope did not exit cleanly after evidence ACK (exit=${supervisorExit}, stopped=${stopped})`,
			);
		}
		if (!(await waitScopeStopped(unit, observedScope))) {
			terminateScope(child, unit, observedScope);
			const stopped = await waitScopeStopped(unit, observedScope);
			throw new Error(`closeout scope remained live after supervisor exit (stopped=${stopped})`);
		}
		return result;
	} catch (error) {
		if (!child.stdin.destroyed) child.stdin.end();
		await waitForExit(child, 250);
		if (!(await waitScopeStopped(unit, observedScope))) {
			terminateScope(child, unit, observedScope);
			if (!(await waitScopeStopped(unit, observedScope))) {
				throw new AggregateError([error], "closeout failed and its exact transient scope stop could not be proven");
			}
		}
		throw error;
	}
}

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { stableStringify } from "./report.ts";
import type { CloseoutCommand, CloseoutInputBinding } from "./closeout-types.ts";

const MAX_FILES = 2_000;
const MAX_BYTES = 64 * 1024 * 1024;
const CAPTURE_MS = 5_000;
export const CLOSEOUT_READ_LIMIT = 64 * 1024;
const hash = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const canonicalHash = (value: unknown): string => hash(stableStringify(value));

export interface CloseoutSnapshotEntry {
  path: string;
  kind: "file" | "directory" | "symlink";
  mode: number;
  sha256?: string;
  bytes?: number;
  target?: string;
  resolvedTarget?: string;
}
export interface CloseoutSnapshot {
  originalCwd: string;
  snapshotRoot: string;
  binding: CloseoutInputBinding;
  entries: readonly CloseoutSnapshotEntry[];
  files: ReadonlyMap<string, CloseoutSnapshotEntry>;
}
export interface CloseoutSnapshotOptions {
  cwd: string;
  stagingParent: string;
  dependencyManifestSha256: string;
  isolationProfileSha256: string;
  deadlineMs: number;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function checkDeadline(deadline: number): void {
  if (performance.now() >= deadline) throw new Error("Closeout input snapshot deadline exceeded");
}
function boundedNames(directory: string, deadline: number): string[] {
  const names: string[] = [];
  const handle = fs.opendirSync(directory);
  try {
    for (;;) {
      checkDeadline(deadline);
      const entry = handle.readSync();
      if (!entry) return names.sort();
      if (names.length >= MAX_FILES) throw new Error("Closeout input exceeds 2000 entries");
      names.push(entry.name);
    }
  } finally { handle.closeSync(); }
}
function readPinned(file: string, remaining: number, deadline: number): Buffer {
  checkDeadline(deadline);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > remaining) throw new Error("Closeout input is not a bounded regular file");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      checkDeadline(deadline);
      const n = fs.readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (n === 0) throw new Error("Closeout input changed while reading");
      offset += n;
    }
    const after = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || named.dev !== before.dev || named.ino !== before.ino || !named.isFile()) {
      throw new Error("Closeout input changed while reading");
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

function capture(root: string, deadline: number, copyTo?: string): CloseoutSnapshotEntry[] {
  const entries: CloseoutSnapshotEntry[] = [];
  let total = 0;
  let count = 0;
  function walk(relative: string): void {
    checkDeadline(deadline);
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (++count > MAX_FILES) throw new Error("Closeout input exceeds 2000 entries");
    const mode = stat.mode & 0o777;
    const entry: CloseoutSnapshotEntry = { path: relative, kind: "file", mode };
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute);
      const resolved = fs.realpathSync(absolute);
      if (!contained(root, resolved)) throw new Error("Closeout input contains an external symlink");
      if (!fs.statSync(resolved).isFile()) throw new Error("Closeout supports symlinks to regular files only");
      Object.assign(entry, { kind: "symlink", target, resolvedTarget: path.relative(root, resolved) });
      if (copyTo) {
        // Absolute links must point at the copy during host inspection. In the
        // sandbox the copy is mounted at the canonical original pathname.
        // Preserve original bytes; host reads use only regular-file entries.
        fs.symlinkSync(target, path.join(copyTo, relative));
      }
    } else if (stat.isDirectory()) {
      entry.kind = "directory";
      if (copyTo) fs.mkdirSync(path.join(copyTo, relative), { mode: 0o700 });
      entries.push(entry);
      for (const name of boundedNames(absolute, deadline)) walk(path.join(relative, name));
      if (copyTo) fs.chmodSync(path.join(copyTo, relative), mode);
      return;
    } else if (stat.isFile()) {
      const bytes = readPinned(absolute, MAX_BYTES - total, deadline);
      total += bytes.length;
      entry.bytes = bytes.length;
      entry.sha256 = hash(bytes);
      if (copyTo) {
        fs.writeFileSync(path.join(copyTo, relative), bytes, { mode, flag: "wx" });
        fs.chmodSync(path.join(copyTo, relative), mode);
      }
    } else throw new Error("Closeout input contains a special file");
    entries.push(entry);
  }
  for (const name of boundedNames(root, deadline)) walk(name);
  const names = new Set(entries.map((e) => e.path));
  for (const entry of entries) {
    if (path.basename(entry.path) === ".git" && entry.path !== ".git") throw new Error("Closeout does not support nested worktrees");
    if (entry.kind === "symlink" && entry.resolvedTarget !== "" && !names.has(entry.resolvedTarget!)) {
      throw new Error("Closeout symlink target is outside the captured closure");
    }
  }
  return entries;
}

function headOf(cwd: string, deadline: number): string {
  checkDeadline(deadline);
  if (!fs.lstatSync(path.join(cwd, ".git")).isDirectory()) throw new Error("Closeout requires an ordinary single worktree");
  if (fs.existsSync(path.join(cwd, ".gitmodules")) || fs.existsSync(path.join(cwd, ".git", "commondir"))) {
    throw new Error("Closeout does not support submodules or shared Git directories");
  }
  const head = execFileSync("/usr/bin/git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], {
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" },
    timeout: Math.max(1, Math.floor(deadline - performance.now())), maxBuffer: 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("Closeout HEAD is unavailable");
  return head;
}
function manifests(entries: readonly CloseoutSnapshotEntry[]): Pick<CloseoutInputBinding, "sourceManifestSha256" | "gitMetadataManifestSha256"> {
  const isGit = (entry: CloseoutSnapshotEntry): boolean => entry.path === ".git" || entry.path.startsWith(`.git${path.sep}`);
  return {
    sourceManifestSha256: canonicalHash(entries.filter((e) => !isGit(e))),
    gitMetadataManifestSha256: canonicalHash(entries.filter(isGit)),
  };
}

/** Captures every input, including ignored files. No exclusion list can turn a
 * partial closure into a successful snapshot. Staging must be outside it. */
export function createCloseoutSnapshot(options: CloseoutSnapshotOptions): CloseoutSnapshot {
  const originalCwd = fs.realpathSync(options.cwd);
  const stagingParent = fs.realpathSync(options.stagingParent);
  if (!fs.statSync(stagingParent).isDirectory() || contained(originalCwd, stagingParent)) {
    throw new Error("Closeout staging must be an existing directory outside the input tree");
  }
  for (const digest of [options.dependencyManifestSha256, options.isolationProfileSha256]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Closeout requires complete runtime profile hashes");
  }
  const deadline = performance.now() + Math.min(CAPTURE_MS, options.deadlineMs - Date.now());
  const head = headOf(originalCwd, deadline);
  const snapshotArtifactId = randomUUID();
  const snapshotRoot = path.join(stagingParent, snapshotArtifactId);
  fs.mkdirSync(snapshotRoot, { mode: 0o700 });
  try {
    const entries = capture(originalCwd, deadline, snapshotRoot);
    const after = capture(originalCwd, deadline);
    if (canonicalHash(entries) !== canonicalHash(after) || headOf(originalCwd, deadline) !== head) {
      throw new Error("Closeout source changed while staging");
    }
    // Compare every copied regular file on the same fd; symlink bytes and mode
    // are checked independently without following absolute links into source.
    for (const entry of entries) {
      checkDeadline(deadline);
      const staged = path.join(snapshotRoot, entry.path);
      const st = fs.lstatSync(staged);
      if ((st.mode & 0o777) !== entry.mode) throw new Error("Closeout staged mode mismatch");
      if (entry.kind === "file" && hash(readPinned(staged, MAX_BYTES, deadline)) !== entry.sha256) throw new Error("Closeout staged content mismatch");
      if (entry.kind === "symlink" && fs.readlinkSync(staged) !== entry.target) throw new Error("Closeout staged link mismatch");
    }
    const files = new Map(entries.filter((e) => e.kind === "file").map((e) => [hash(e.path), Object.freeze(e)]));
    const binding: CloseoutInputBinding = {
      workspaceId: hash(originalCwd), head, ...manifests(entries),
      dependencyManifestSha256: options.dependencyManifestSha256, isolationProfileSha256: options.isolationProfileSha256,
      snapshotArtifactId, capturedAt: new Date().toISOString(), state: "complete",
    };
    return { originalCwd, snapshotRoot, binding: Object.freeze(binding), entries, files };
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

export function verifyCloseoutSnapshot(snapshot: CloseoutSnapshot, deadlineMs: number): CloseoutInputBinding {
  const deadline = performance.now() + Math.min(CAPTURE_MS, deadlineMs - Date.now());
  const entries = capture(snapshot.originalCwd, deadline);
  const current = { ...snapshot.binding, ...manifests(entries), head: headOf(snapshot.originalCwd, deadline) };
  if (canonicalHash(current) !== canonicalHash(snapshot.binding)) throw new Error("Closeout original input drifted");
  const expected = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
  let visited = 0;
  function verifyStaged(relative: string): void {
    checkDeadline(deadline);
    const entry = expected.get(relative);
    if (!entry) throw new Error("Closeout staged input contains an unexpected path");
    visited++;
    const file = path.join(snapshot.snapshotRoot, relative);
    const st = fs.lstatSync(file);
    if ((st.mode & 0o777) !== entry.mode) throw new Error("Closeout staged input mode drifted");
    if (entry.kind === "directory") {
      if (!st.isDirectory()) throw new Error("Closeout staged directory drifted");
      for (const name of boundedNames(file, deadline)) verifyStaged(path.join(relative, name));
    } else if (entry.kind === "symlink") {
      if (!st.isSymbolicLink() || fs.readlinkSync(file) !== entry.target) throw new Error("Closeout staged link drifted");
    } else if (!st.isFile() || st.size !== entry.bytes || hash(readPinned(file, MAX_BYTES, deadline)) !== entry.sha256) {
      throw new Error("Closeout staged content drifted");
    }
  }
  for (const name of boundedNames(snapshot.snapshotRoot, deadline)) verifyStaged(name);
  if (visited !== expected.size) throw new Error("Closeout staged input is incomplete");
  return current;
}

export function readCloseoutSnapshot(snapshot: CloseoutSnapshot, args: unknown): { text: string; bytes: number; sha256: string } {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid closeout read arguments");
  const value = args as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "limit,offset,pathId" || typeof value.pathId !== "string"
    || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0
    || !Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > CLOSEOUT_READ_LIMIT) {
    throw new Error("Invalid closeout read arguments");
  }
  const entry = snapshot.files.get(value.pathId);
  if (!entry || entry.kind !== "file") throw new Error("Unknown closeout pathId");
  const file = path.join(snapshot.snapshotRoot, entry.path);
  if (!contained(fs.realpathSync(snapshot.snapshotRoot), fs.realpathSync(file))) throw new Error("Closeout staged path escaped");
  const content = readPinned(file, MAX_BYTES, performance.now() + CAPTURE_MS);
  if (hash(content) !== entry.sha256 || content.length !== entry.bytes) throw new Error("Closeout staged input drifted");
  if ((value.offset as number) > content.length) throw new Error("Closeout read offset exceeds file");
  const result = content.subarray(value.offset as number, (value.offset as number) + (value.limit as number));
  return { text: result.toString("utf8"), bytes: result.length, sha256: entry.sha256! };
}

/** Parsing deliberately supports only literal ASCII-space separated argv. The
 * executable table is host-created and never derived from model arguments. */
export function createCloseoutCommands(commands: readonly string[], cwd: string, profile: {
  id: string; executables: Readonly<Record<string, string>>;
}, timeoutMs = 60_000): readonly CloseoutCommand[] {
  if (commands.length < 1 || commands.length > 5 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("Closeout requires one to five bounded validation commands");
  }
  const originalCwd = fs.realpathSync(cwd);
  const seen = new Set<string>();
  return commands.map((originalCommand, specCommandIndex) => {
    if (typeof originalCommand !== "string" || originalCommand.length > 4096 || !/^[A-Za-z0-9_./:@%+,= -]+$/.test(originalCommand)
      || originalCommand.trim() !== originalCommand || originalCommand.includes("  ")) throw new Error("Unsupported closeout command syntax");
    const [program, ...originalArgv] = originalCommand.split(" ");
    const argv = profile.id === "system-python-tools-v1" && ["pytest", "ruff", "mypy"].includes(program)
      ? ["-m", program, ...originalArgv] : originalArgv;
    if (["system-python-unittest-v1", "system-python-tools-v1"].includes(profile.id)) {
      const modules = profile.id === "system-python-tools-v1" ? ["unittest", "pytest", "ruff", "mypy"] : ["unittest"];
      if (argv[0] !== "-m" || !modules.includes(argv[1])) throw new Error("Closeout command has no supported validation module");
    }
    const executable = Object.hasOwn(profile.executables, program) ? profile.executables[program] : undefined;
    if (!executable || !path.isAbsolute(executable) || /^(?:.*\/)?(?:ba|da|z|k|c|fi)?sh$/.test(program) || program.includes("=")) {
      throw new Error("Closeout command has no allowed runtime executable");
    }
    if (seen.has(originalCommand)) throw new Error("Duplicate closeout command");
    seen.add(originalCommand);
    const descriptor = { commandId: randomUUID(), specCommandIndex, originalCommand, executable, argv, cwd: originalCwd, environmentProfileId: profile.id, timeoutMs };
    return Object.freeze({ ...descriptor, argv: Object.freeze(argv), descriptorSha256: canonicalHash(descriptor) });
  });
}

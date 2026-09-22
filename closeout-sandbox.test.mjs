import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import {
	discoverCloseoutRuntimeProfile,
	evaluateCloseoutScopeStopped,
	runCloseoutSandbox,
} from "./closeout-sandbox.ts";
import { stableStringify } from "./report.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXPECTED_CONTROLS = {
	memoryMaxBytes: 1_073_741_824,
	memorySwapMaxBytes: 0,
	pidsMax: 32,
	cpuQuotaUs: 100_000,
	cpuPeriodUs: 100_000,
};

let runRoot;
let source;
let snapshot;
let artifacts;
let profile;
let sequence = 0;

async function treeHash(root) {
	const rows = [];
	async function visit(directory) {
		for (const name of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
			const absolute = path.join(directory, name.name);
			const relative = path.relative(root, absolute);
			if (name.isDirectory()) await visit(absolute);
			else if (name.isFile()) rows.push([relative, createHash("sha256").update(await readFile(absolute)).digest("hex")]);
		}
	}
	await visit(root);
	return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function command(moduleName, timeoutMs = 10_000) {
	const body = {
		commandId: `command-${sequence + 1}`,
		specCommandIndex: sequence,
		originalCommand: `python3 -m unittest -v ${moduleName}`,
		executable: profile.executables.python3,
		argv: ["-m", "unittest", "-v", moduleName],
		cwd: source,
		environmentProfileId: profile.id,
		timeoutMs,
	};
	return {
		...body,
		descriptorSha256: createHash("sha256").update(stableStringify(body)).digest("hex"),
	};
}

async function run(moduleName, options = {}) {
	sequence += 1;
	let callbackObservedLiveScope = false;
	const identity = {
		taskId: "sandbox-test",
		originExecutionId: "origin-1",
		executionId: "closeout-1",
		requestId: "request-1",
		ownerRunId: "owner-1",
		runId: "run-1",
	};
	const result = await runCloseoutSandbox({
		command: command(moduleName, options.timeoutMs),
		identity,
		attemptSequence: sequence,
		expectedControls: EXPECTED_CONTROLS,
		isolationProfileSha256: profile.isolationProfileSha256,
		snapshotRoot: snapshot,
		originalCwd: source,
		runtimeProfile: profile,
		deadlineMs: Date.now() + (options.deadlineMs ?? 20_000),
		signal: options.signal,
		artifactRoot: artifacts,
		onResult: async (rawResult) => {
			assert.equal(rawResult.runtimeObservation.scopeUnit.startsWith("closeout-"), true);
			if (rawResult.runtimeObservation.cgroupPath) {
				const cgroup = `/sys/fs/cgroup/${rawResult.runtimeObservation.cgroupPath.replace(/^\//, "")}`;
				assert.equal((await stat(cgroup)).isDirectory(), true);
				callbackObservedLiveScope = true;
			}
			await options.onResult?.(rawResult);
		},
	});
	return { result, callbackObservedLiveScope };
}

before(async () => {
	runRoot = await mkdtemp(path.join(HERE, ".sandbox-tests-"));
	source = path.join(runRoot, "source");
	snapshot = path.join(runRoot, "snapshot");
	artifacts = path.join(runRoot, "artifacts");
	await mkdir(path.join(source, ".git"), { recursive: true });
	await mkdir(artifacts);
	await writeFile(path.join(source, "fixture.txt"), "immutable fixture\n");
	await writeFile(path.join(source, ".git", "config"), "immutable metadata\n");
	await writeFile(path.join(source, "test_isolation.py"), `
import errno, os, socket, subprocess, sys, unittest
from pathlib import Path

class IsolationTests(unittest.TestCase):
    def denied(self, target):
        with self.assertRaises(OSError) as caught:
            fd = os.open(target, os.O_WRONLY)
            os.close(fd)
        self.assertIn(caught.exception.errno, (errno.EROFS, errno.EACCES, errno.ENOENT))

    def test_boundaries(self):
        root = Path.cwd()
        self.denied(root / "fixture.txt")
        self.denied(root / ".git" / "config")
        link = Path("/scratch/source-link")
        link.symlink_to(root / "fixture.txt")
        self.denied(link)
        self.denied(Path("/proc/self/root") / str(root / "fixture.txt").lstrip("/"))
        for parent, target in (
            (Path("/"), Path("/escape")),
            (Path("/usr/bin"), Path("/usr/bin/escape")),
            (Path("/dev"), Path("/dev/escape")),
            (Path("/dev/shm"), Path("/dev/shm/escape")),
            (root.parent, root.parent / "escape"),
        ):
            self.assertTrue(parent.is_dir(), str(parent))
            self.denied(target)
        self.denied(Path("/proc/self/comm"))
        with Path("/dev/null").open("wb") as null:
            null.write(b"ok")
        self.assertFalse(Path("/tmp").exists())
        self.assertNotIn("HOME_SECRET", os.environ)
        self.assertFalse(Path(${JSON.stringify(path.join(HERE, "must-not-be-mounted"))}).exists())
        Path("/scratch/output").write_text("allowed")
        child = "import os,sys; os.open(sys.argv[1], os.O_WRONLY)"
        completed = subprocess.run([sys.executable, "-c", child, str(root / "fixture.txt")])
        self.assertNotEqual(completed.returncode, 0)
        for family in (socket.AF_INET, socket.AF_UNIX):
            with self.assertRaises(OSError) as caught:
                socket.socket(family, socket.SOCK_STREAM)
            self.assertEqual(caught.exception.errno, errno.EPERM)
`);
	await writeFile(path.join(source, "test_timeout.py"), `
import subprocess, sys, time, unittest
class TimeoutTests(unittest.TestCase):
    def test_timeout(self):
        subprocess.Popen([sys.executable, "-c", "import time; time.sleep(20)"], start_new_session=True)
        time.sleep(20)
`);
	await writeFile(path.join(source, "test_overflow.py"), `
import sys, unittest
sys.stdout.buffer.write(b"x" * (1024 * 1024 + 4096))
sys.stdout.flush()
class OverflowTests(unittest.TestCase):
    def test_never_matters(self): self.assertTrue(True)
`);
	await writeFile(path.join(source, "test_scratch.py"), `
import unittest
from pathlib import Path
class ScratchTests(unittest.TestCase):
    def test_limit(self):
        with Path("/scratch/large").open("wb") as stream:
            block = b"x" * (1024 * 1024)
            for _ in range(70):
                stream.write(block); stream.flush()
`);
	await writeFile(path.join(source, "test_closedstdio.py"), `
import os, time, unittest
class ClosedStdioTests(unittest.TestCase):
    def test_timeout_after_stdio_close(self):
        os.close(1); os.close(2); time.sleep(20)
`);
	await writeFile(path.join(source, "test_metadata.py"), `
import unittest
from pathlib import Path
class MetadataTests(unittest.TestCase):
    def test_entry_limit(self):
        root = Path("/scratch/entries"); root.mkdir()
        for index in range(9000):
            (root / str(index)).touch()
`);
	await writeFile(path.join(source, "test_hidden_scratch.py"), `
import errno, mmap, os, unittest

LIMIT = 64 * 1024 * 1024
BLOCK = b"x" * (1024 * 1024)

def fill(fd):
    written = 0
    caught = None
    for _ in range(80):
        try:
            written += os.write(fd, BLOCK)
        except OSError as error:
            caught = error.errno
            break
    return written, caught

class HiddenScratchTests(unittest.TestCase):
    def test_open_unlinked_hard_limit(self):
        fd = os.open("/scratch/unlinked", os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        try:
            os.unlink("/scratch/unlinked")
            written, caught = fill(fd)
            self.assertLessEqual(written, LIMIT)
            self.assertEqual(caught, errno.ENOSPC)
            print("open-unlinked-enospc", written)
        finally:
            os.close(fd)

    def test_otmpfile_hard_limit(self):
        if not hasattr(os, "O_TMPFILE"):
            self.skipTest("O_TMPFILE unavailable")
        try:
            fd = os.open("/scratch", os.O_TMPFILE | os.O_RDWR, 0o600)
        except OSError as error:
            if error.errno in (errno.EOPNOTSUPP, errno.ENOTSUP, errno.EINVAL):
                self.skipTest("scratch tmpfs does not support O_TMPFILE")
            raise
        try:
            written, caught = fill(fd)
            self.assertLessEqual(written, LIMIT)
            self.assertEqual(caught, errno.ENOSPC)
            print("otmpfile-enospc", written)
        finally:
            os.close(fd)
`);
	await cp(source, snapshot, { recursive: true, dereference: false });
	[source, snapshot, artifacts] = await Promise.all([realpath(source), realpath(snapshot), realpath(artifacts)]);
	profile = await discoverCloseoutRuntimeProfile();
});

after(async () => {
	await rm(runRoot, { recursive: true, force: true });
});

test("profile is fixed, complete, and rejects unsupported commands before launch", async () => {
	assert.equal(profile.id, "system-python-unittest-v1");
	assert.equal(profile.executables.python3, "/usr/bin/python3");
	assert.match(profile.dependencyManifestSha256, /^[0-9a-f]{64}$/);
	assert.match(profile.isolationProfileSha256, /^[0-9a-f]{64}$/);
	assert.ok(profile.readonlyMounts.some((mount) => mount.destination.startsWith("/usr/lib/python")));
	await assert.rejects(
		runCloseoutSandbox({
			command: { ...command("test_isolation"), executable: "/usr/bin/npm" },
			identity: { taskId: "t", originExecutionId: "o", executionId: "e", requestId: "q", ownerRunId: "w", runId: "r" },
			attemptSequence: 999,
			expectedControls: EXPECTED_CONTROLS,
			isolationProfileSha256: profile.isolationProfileSha256,
			snapshotRoot: snapshot,
			originalCwd: source,
			runtimeProfile: profile,
			deadlineMs: Date.now() + 10_000,
			artifactRoot: artifacts,
			onResult: async () => assert.fail("unsupported command reached callback"),
		}),
		/only the fixed system Python/,
	);
});

test("production sandbox protects source and git, blocks symlink/process/network escape, and keeps scope for sealing", async () => {
	const beforeSource = await treeHash(source);
	const beforeSnapshot = await treeHash(snapshot);
	const { result, callbackObservedLiveScope } = await run("test_isolation");
	assert.equal(result.outcome, "passed", JSON.stringify({
		exitCode: result.exitCode,
		signal: result.signal,
		startupError: result.startupError,
		stderr: result.stderr.toString(),
	}));
	assert.equal(result.exitCode, 0);
	assert.equal(result.processTreeStopped, true);
	assert.equal(result.runtimeObservation.state, "complete");
	assert.deepEqual(result.runtimeObservation.before.controls, EXPECTED_CONTROLS);
	assert.deepEqual(result.runtimeObservation.after.controls, EXPECTED_CONTROLS);
	assert.equal(result.stdoutComplete, true);
	assert.equal(result.stderrComplete, true);
	assert.equal(callbackObservedLiveScope, true);
	assert.equal(await treeHash(source), beforeSource);
	assert.equal(await treeHash(snapshot), beforeSnapshot);
});

test("timeout kills the PID namespace including detached descendants", async () => {
	const { result } = await run("test_timeout", { timeoutMs: 700 });
	assert.equal(result.outcome, "timed_out", result.startupError ?? result.stderr.toString());
	assert.equal(result.timedOut, true);
	assert.equal(result.processTreeStopped, true);
});

test("AbortSignal cancels and stops the sandbox process tree", async () => {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 200);
	const { result } = await run("test_timeout", { signal: controller.signal });
	assert.equal(result.outcome, "cancelled", result.startupError ?? result.stderr.toString());
	assert.equal(result.cancelled, true);
	assert.equal(result.processTreeStopped, true);
});

test("stdout overflow fails evidence and stores at most one MiB", async () => {
	const { result } = await run("test_overflow");
	assert.equal(result.outcome, "evidence_failed", result.startupError ?? result.stderr.toString());
	assert.equal(result.stdout.length, 1024 * 1024);
	assert.equal(result.stdoutComplete, false);
	assert.equal(result.processTreeStopped, true);
});

test("scratch growth above 64 MiB fails evidence", async () => {
	const { result } = await run("test_scratch");
	assert.equal(result.outcome, "evidence_failed", result.startupError ?? result.stderr.toString());
	assert.equal(result.processTreeStopped, true);
});

test("private scratch tmpfs hard-bounds open-unlinked and O_TMPFILE allocations", async () => {
	const { result } = await run("test_hidden_scratch");
	assert.equal(result.outcome, "passed", result.startupError ?? result.stderr.toString());
	assert.equal(result.exitCode, 0);
	assert.equal(result.processTreeStopped, true);
	assert.match(result.stderr.toString(), /Ran 2 tests/);
	assert.match(result.stdout.toString(), /open-unlinked-enospc 67108864/);
	assert.match(result.stdout.toString(), /otmpfile-enospc 67108864/);
});

test("closed stdout and stderr do not bypass the frozen deadline", async () => {
	const started = Date.now();
	const { result } = await run("test_closedstdio", { timeoutMs: 700 });
	assert.equal(result.outcome, "timed_out", result.startupError ?? result.stderr.toString());
	assert.equal(result.processTreeStopped, true);
	assert.ok(Date.now() - started < 5_000);
});

test("scratch metadata entry growth fails evidence", async () => {
	const { result } = await run("test_metadata");
	assert.equal(result.outcome, "evidence_failed", result.startupError ?? result.stderr.toString());
	assert.equal(result.processTreeStopped, true);
});

test("seal callback failure closes the exact scope without ACK success", async () => {
	let observed;
	await assert.rejects(
		run("test_isolation", {
			onResult: async (result) => {
				observed = result.runtimeObservation;
				throw new Error("injected seal failure");
			},
		}),
		/injected seal failure/,
	);
	assert.ok(observed?.cgroupPath);
	try {
		const processes = await readFile(`/sys/fs/cgroup${observed.cgroupPath}/cgroup.procs`, "utf8");
		assert.equal(processes.trim(), "");
	} catch (error) {
		assert.equal(error.code, "ENOENT");
	}
});

test("scope collection interpretation fails closed on query and populated-cgroup states", () => {
	const expected = { cgroupPath: "/heavy.slice/closeout-test.scope", cgroupId: "1:2" };
	assert.equal(
		evaluateCloseoutScopeStopped({ status: 1, stdout: "", error: new Error("query failed") }, expected, () => "absent"),
		false,
	);
	const loaded = { status: 0, stdout: "LoadState=loaded\nActiveState=inactive\nControlGroup=/heavy.slice/closeout-test.scope\n" };
	assert.equal(evaluateCloseoutScopeStopped(loaded, expected, () => "populated"), false);
	assert.equal(evaluateCloseoutScopeStopped(loaded, expected, () => "identity-mismatch"), false);
	assert.equal(evaluateCloseoutScopeStopped(loaded, expected, () => "empty"), true);
	const missing = { status: 0, stdout: "LoadState=not-found\nActiveState=inactive\nControlGroup=\n" };
	assert.equal(evaluateCloseoutScopeStopped(missing, undefined, () => "absent"), false);
	assert.equal(evaluateCloseoutScopeStopped(missing, expected, () => "absent"), true);
});

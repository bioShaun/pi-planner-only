import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, lstat, mkdir, rename, writeFile, readlink } from "node:fs/promises";
import { join } from "node:path";

const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const lockPath = `${ledgerPath}.lock`;
const expectedLedgerSha256 = "6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920";
const expectedLockInode = 78027473;
const quarantineDir = process.env.PI_NATIVE_LITE_LOCK_QUARANTINE;
assert.ok(quarantineDir?.startsWith("/project/tmp/pi-native-lite-budget-scope/quarantine-"));
const sha = value => createHash("sha256").update(value).digest("hex");
const denied = [];
let sameUid = 0;
let unreadableEnviron = 0;
let unreadableFdDir = 0;

for (const entry of await readdir("/proc", { withFileTypes: true })) {
	if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
	const proc = `/proc/${entry.name}`;
	let status;
	try { status = await readFile(join(proc, "status"), "utf8"); }
	catch { continue; }
	const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
	if (uid !== process.getuid()) continue;
	sameUid++;
	let cmdline = "";
	try { cmdline = (await readFile(join(proc, "cmdline"))).toString().replaceAll("\0", " "); }
	catch { /* Kernel threads and exiting processes may not expose cmdline. */ }
	if (cmdline.includes("run-rpc-arm.mjs") || cmdline.includes("pi-native-lite-20261028T111239+0800")) {
		denied.push({ pid: Number(entry.name), reason: "experiment-runner-command-match" });
	}
	try {
		const env = await readFile(join(proc, "environ"));
		if (env.includes(Buffer.from(ledgerPath)) || env.includes(Buffer.from(lockPath))) denied.push({ pid: Number(entry.name), reason: "ledger-environment-reference" });
	} catch { unreadableEnviron++; }
	try {
		for (const fd of await readdir(join(proc, "fd"))) {
			try {
				const target = await readlink(join(proc, "fd", fd));
				if (target === ledgerPath || target === lockPath) denied.push({ pid: Number(entry.name), reason: "ledger-file-descriptor" });
			} catch { /* Descriptor may close during inspection. */ }
		}
	} catch { unreadableFdDir++; }
}
assert.deepEqual(denied, [], `related writers/processes found: ${JSON.stringify(denied)}`);

const ledgerBytes = await readFile(ledgerPath);
assert.equal(sha(ledgerBytes), expectedLedgerSha256, "ledger bytes changed since Root approval");
const ledger = JSON.parse(ledgerBytes);
assert.equal(ledger.events.length, 23);
assert.equal(ledger.reservedUsd, 13.27409902);
const lockStat = await lstat(lockPath);
assert.equal(lockStat.ino, expectedLockInode);
assert.equal(lockStat.size, 0);
assert.equal(lockStat.uid, 1000);
assert.ok(lockStat.isFile() && !lockStat.isSymbolicLink());

await mkdir(quarantineDir, { recursive: false });
const dest = join(quarantineDir, "budget-ledger.json.lock");
try { await lstat(dest); throw new Error(`quarantine destination already exists: ${dest}`); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const before = {
	ledger: { path: ledgerPath, sha256: sha(ledgerBytes), bytes: ledgerBytes.length, events: ledger.events.length, reservedUsd: ledger.reservedUsd },
	lock: { path: lockPath, inode: lockStat.ino, uid: lockStat.uid, gid: lockStat.gid, size: lockStat.size, mode: lockStat.mode, mtime: lockStat.mtime.toISOString(), ctime: lockStat.ctime.toISOString(), birthtime: lockStat.birthtime.toISOString(), sha256: sha(await readFile(lockPath)) },
	processScan: { uid: process.getuid(), sameUidProcesses: sameUid, unreadableEnviron, unreadableFdDir, matchingProcesses: denied.length },
};
await writeFile(join(quarantineDir, "before.json"), `${JSON.stringify(before, null, 2)}\n`, { flag: "wx", mode: 0o600 });
await rename(lockPath, dest);
const quarantinedStat = await lstat(dest);
assert.equal(quarantinedStat.ino, expectedLockInode);
assert.equal(quarantinedStat.size, 0);
assert.equal(sha(await readFile(dest)), before.lock.sha256);
try { await lstat(lockPath); throw new Error("original ledger lock path still exists after rename"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const ledgerAfter = await readFile(ledgerPath);
assert.deepEqual(ledgerAfter, ledgerBytes);
const after = {
	lockQuarantinePath: dest,
	quarantine: { inode: quarantinedStat.ino, uid: quarantinedStat.uid, gid: quarantinedStat.gid, size: quarantinedStat.size, sha256: sha(await readFile(dest)) },
	originalLockPathAbsent: true,
	ledger: { path: ledgerPath, sha256: sha(ledgerAfter), bytes: ledgerAfter.length, events: JSON.parse(ledgerAfter).events.length, reservedUsd: JSON.parse(ledgerAfter).reservedUsd },
};
await writeFile(join(quarantineDir, "after.json"), `${JSON.stringify(after, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ before, after }, null, 2));

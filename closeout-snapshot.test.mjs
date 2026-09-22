import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createCloseoutSnapshot, verifyCloseoutSnapshot, readCloseoutSnapshot, createCloseoutCommands } from "./closeout-snapshot.ts";

assert.ok(fs.statSync(process.cwd()).isDirectory());
const parent = path.resolve(".scratch");
fs.mkdirSync(parent, {recursive:true});
const testRoot = fs.mkdtempSync(path.join(parent, "snapshot-test-"));
const cwd = path.join(testRoot, "source");
const stagingParent = path.join(testRoot, "staging");
fs.mkdirSync(cwd); fs.mkdirSync(stagingParent);
const git = (...args) => execFileSync("/usr/bin/git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git("init", "--quiet"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
fs.writeFileSync(path.join(cwd, "source.py"), "print('hello')\n");
fs.writeFileSync(path.join(cwd, ".gitignore"), "ignored.txt\n");
git("add", "."); git("commit", "-qm", "fixture");
fs.writeFileSync(path.join(cwd, "ignored.txt"), "validation input despite ignore\n");
fs.symlinkSync("source.py", path.join(cwd, "internal-link"));
const options = () => ({ cwd, stagingParent, dependencyManifestSha256: "a".repeat(64), isolationProfileSha256: "b".repeat(64), deadlineMs: Date.now() + 60_000 });
const snap = createCloseoutSnapshot(options());
assert.ok(snap.entries.some((entry) => entry.path === "ignored.txt"));
assert.ok(snap.entries.some((entry) => entry.path === "internal-link"));
assert.deepEqual(verifyCloseoutSnapshot(snap, Date.now() + 60_000), snap.binding);
const [pathId] = [...snap.files].find(([,entry]) => entry.path === "ignored.txt");
assert.equal(readCloseoutSnapshot(snap, {pathId,offset:0,limit:10}).text, "validation");
for (const args of [{pathId:"../../etc/passwd",offset:0,limit:10},{pathId,offset:0,limit:65537},{pathId,offset:-1,limit:1},{pathId,offset:0,limit:1,extra:1}]) {
  assert.throws(() => readCloseoutSnapshot(snap, args));
}
fs.writeFileSync(path.join(cwd,"ignored.txt"), "changed\n");
assert.throws(() => verifyCloseoutSnapshot(snap, Date.now()+60_000), /drifted/);
assert.equal(readCloseoutSnapshot(snap,{pathId,offset:0,limit:10}).text, "validation");
fs.writeFileSync(path.join(snap.snapshotRoot,"ignored.txt"),"tampered");
assert.throws(() => readCloseoutSnapshot(snap,{pathId,offset:0,limit:10}), /drifted/);
fs.symlinkSync("/etc/passwd",path.join(cwd,"external"));
assert.throws(() => createCloseoutSnapshot(options()), /external symlink/);
fs.unlinkSync(path.join(cwd,"external"));
fs.symlinkSync(".",path.join(cwd,"cycle"));
assert.throws(() => createCloseoutSnapshot(options()), /regular files only/);
fs.unlinkSync(path.join(cwd,"cycle"));
assert.throws(() => createCloseoutSnapshot({...options(), stagingParent:cwd}), /outside/);
assert.throws(() => createCloseoutSnapshot({...options(),deadlineMs:Date.now()-1}), /deadline/);
const profile = {id:"python-test-v1",executables:{python3:"/usr/bin/python3"}};
const [cmd] = createCloseoutCommands(["python3 -m unittest discover"],cwd,profile);
assert.deepEqual(cmd.argv,["-m","unittest","discover"]);
assert.match(cmd.descriptorSha256,/^[a-f0-9]{64}$/);
for (const command of ["python3 -c 'print(1)'","python3 -m unittest && false","X=1 python3 test.py","python3\t-m unittest","sh script","python3 $(touch foo)","python3 test.py\n","python3 test.py > out","python3 \\x","python3  test.py"]) {
  assert.throws(() => createCloseoutCommands([command],cwd,profile),command);
}
assert.throws(() => createCloseoutCommands([],cwd,profile));
assert.throws(() => createCloseoutCommands(["python3 test.py","python3 test.py"],cwd,profile), /Duplicate/);
// Limits reject the complete capture rather than publishing a truncated map.
const huge = fs.openSync(path.join(cwd,"huge"),"w"); fs.ftruncateSync(huge,64*1024*1024+1); fs.closeSync(huge);
assert.throws(() => createCloseoutSnapshot(options()), /bounded regular/);
fs.unlinkSync(path.join(cwd,"huge"));
for (let i=0;i<2001;i++) fs.writeFileSync(path.join(cwd,`limit-${i}`),"");
assert.throws(() => createCloseoutSnapshot(options()), /2000 entries/);
fs.writeFileSync(path.join(testRoot,"result.json"),JSON.stringify({status:"PASS",cases:["complete ignored inputs","immutable copy","original and staged drift","path bounds","symlink policy","deadline","literal descriptors","file/byte caps"]},null,2)+"\n");
console.log(`PASS closeout snapshot and command boundary: ${testRoot}`);

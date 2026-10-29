import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const bin = fileURLToPath(new URL("../bin/timesheet.mjs", import.meta.url));
const dir = mkdtempSync(join(here, "tmp-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const csvFile = (content) => { const p = join(dir, `in-${++n}.csv`); writeFileSync(p, content); return p; };
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: dir, timeout: 20000 });
const SAMPLE = "project,task,duration\nAlpha,Design,1h\nbeta,Review,30m\nalpha,Build,2h\nGamma,design,30m\n";

test("cli: default table output", () => {
  const res = run(csvFile(SAMPLE));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "key\tcount\ttotal\nalpha\t2\t3h\nbeta\t1\t30m\ngamma\t1\t30m\n");
});

test("cli: json output", () => {
  const res = run(csvFile(SAMPLE), "--format", "json");
  assert.equal(res.status, 0, res.stderr);
  const want = [{ key: "alpha", count: 2, total: "3h" }, { key: "beta", count: 1, total: "30m" }, { key: "gamma", count: 1, total: "30m" }];
  assert.equal(res.stdout, `${JSON.stringify(want, null, 2)}\n`);
});

test("cli: group by task, sort by key, options before file", () => {
  const res = run("--sort", "key", "--group", "task", csvFile(SAMPLE));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "key\tcount\ttotal\nbuild\t1\t2h\ndesign\t2\t1h30m\nreview\t1\t30m\n");
});

test("cli: column order varies, extra columns ignored, CRLF and quotes", () => {
  const res = run(csvFile('note,duration,task,project\r\n"x, y",1h,t,"Big, Co"\r\nz,15m,t,big co\r\n'), "--format", "json");
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), [{ key: "big-co", count: 2, total: "1h15m" }]);
});

test("cli: missing column exits 2", () => {
  const res = run(csvFile("project,task\na,b\n"));
  assert.equal(res.status, 2);
  assert.ok(res.stderr.startsWith("missing column: duration"), res.stderr);
});

test("cli: unknown option, bad value, or missing file argument exits 2", () => {
  const f = csvFile(SAMPLE);
  for (const args of [[f, "--verbose"], [f, "--format", "xml"], [f, "--group"], [], [f, f]]) {
    assert.equal(run(...args).status, 2, JSON.stringify(args));
  }
});

test("cli: unreadable file exits 1", () => {
  const res = run(join(dir, "does-not-exist.csv"));
  assert.equal(res.status, 1);
  assert.ok(res.stderr.startsWith("cannot read"), res.stderr);
});

test("cli: invalid duration exits 1 with row number", () => {
  const res = run(csvFile("project,task,duration\na,t,1h\nb,t,1x\n"));
  assert.equal(res.status, 1);
  assert.ok(res.stderr.startsWith("row 2: "), res.stderr);
});

test("cli: invalid csv exits 1", () => {
  const res = run(csvFile('project,task,duration\n"a,t,1h\n'));
  assert.equal(res.status, 1);
  assert.ok(res.stderr.startsWith("invalid csv"), res.stderr);
});

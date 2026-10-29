import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("CLI prints JSON totals for the sample file", () => {
  const bin = fileURLToPath(new URL("../bin/timesheet.mjs", import.meta.url));
  const csv = fileURLToPath(new URL("./fixtures/sample.csv", import.meta.url));
  const r = spawnSync(process.execPath, [bin, csv, "--format", "json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { key: "alpha", count: 2, total: "2h" },
    { key: "beta", count: 1, total: "45m" },
  ]);
});

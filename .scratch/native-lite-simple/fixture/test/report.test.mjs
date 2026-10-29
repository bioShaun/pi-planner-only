import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.mjs";

test("buildReport groups by project", () => {
  const rows = [
    { project: "Alpha", task: "a", duration: "1h" },
    { project: "alpha", task: "b", duration: "30m" },
  ];
  assert.deepEqual(buildReport(rows), [{ key: "alpha", count: 2, totalMs: 5400000 }]);
});

test("buildReport of no rows is empty", () => {
  assert.deepEqual(buildReport([]), []);
});

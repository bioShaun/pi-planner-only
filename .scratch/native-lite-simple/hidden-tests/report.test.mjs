import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.mjs";

const r = (project, task, duration) => ({ project, task, duration });
const rows = [r("Alpha", "Design", "1h"), r("beta", "Review", "30m"), r("alpha", "Build", "2h"), r("Gamma", "design", "30m")];

test("buildReport: empty rows", () => {
  assert.deepEqual(buildReport([]), []);
  assert.deepEqual(buildReport([], { groupBy: "task", sort: "key" }), []);
});

test("buildReport: defaults group by project and sort by total", () => {
  assert.deepEqual(buildReport(rows), [
    { key: "alpha", count: 2, totalMs: 10800000 },
    { key: "beta", count: 1, totalMs: 1800000 },
    { key: "gamma", count: 1, totalMs: 1800000 },
  ]);
});

test("buildReport: explicit project/total equals defaults", () => {
  assert.deepEqual(buildReport(rows, { groupBy: "project", sort: "total" }), buildReport(rows));
});

test("buildReport: keys are slugified", () => {
  assert.deepEqual(buildReport([r("Crème Brûlée", "x", "1m"), r("creme  brulee!", "y", "2m")]), [
    { key: "creme-brulee", count: 2, totalMs: 180000 },
  ]);
});

test("buildReport: group by task", () => {
  assert.deepEqual(buildReport(rows, { groupBy: "task" }), [
    { key: "build", count: 1, totalMs: 7200000 },
    { key: "design", count: 2, totalMs: 5400000 },
    { key: "review", count: 1, totalMs: 1800000 },
  ]);
});

test("buildReport: total ties broken by key ascending", () => {
  const out = buildReport([r("b", "t", "1h"), r("c", "t", "2h"), r("a", "t", "60m")]);
  assert.deepEqual(out.map((g) => g.key), ["c", "a", "b"]);
});

test("buildReport: sort by key ascending", () => {
  const out = buildReport(rows, { sort: "key" });
  assert.deepEqual(out.map((g) => g.key), ["alpha", "beta", "gamma"]);
  const byTask = buildReport(rows, { groupBy: "task", sort: "key" });
  assert.deepEqual(byTask.map((g) => g.key), ["build", "design", "review"]);
});

test("buildReport: invalid duration reports 1-based row number", () => {
  assert.throws(() => buildReport([r("a", "t", "1h"), r("a", "t", "1x")]), (e) => e instanceof Error && /^row 2: /.test(e.message));
  assert.throws(() => buildReport([r("a", "t", "bad"), r("a", "t", "1x")]), (e) => /^row 1: /.test(e.message));
});

test("buildReport: non-string duration reports its row", () => {
  assert.throws(() => buildReport([r("a", "t", "1h"), r("a", "t", "1h"), r("a", "t", 5)]), (e) => /^row 3: /.test(e.message));
});

test("buildReport: invalid options", () => {
  assert.throws(() => buildReport(rows, { groupBy: "foo" }), (e) => e instanceof Error && /^invalid option/.test(e.message));
  assert.throws(() => buildReport(rows, { sort: "x" }), (e) => e instanceof Error && /^invalid option/.test(e.message));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, formatDuration } from "../src/duration.mjs";

const invalid = (input) =>
  assert.throws(() => parseDuration(input), (e) => e instanceof Error && /^invalid duration/.test(e.message), `input ${JSON.stringify(input)}`);

test("parseDuration: single units", () => {
  assert.equal(parseDuration("2d"), 172800000);
  assert.equal(parseDuration("3h"), 10800000);
  assert.equal(parseDuration("4m"), 240000);
  assert.equal(parseDuration("5s"), 5000);
  assert.equal(parseDuration("500ms"), 500);
});

test("parseDuration: combined parts", () => {
  assert.equal(parseDuration("1h30m"), 5400000);
  assert.equal(parseDuration("1d1h1m1s1ms"), 90061001);
  assert.equal(parseDuration("1m500ms"), 60500);
  assert.equal(parseDuration("1m5s"), 65000);
});

test("parseDuration: whitespace between parts and around input", () => {
  assert.equal(parseDuration("1h 5m 10s"), 3910000);
  assert.equal(parseDuration("1h   5m"), 3900000);
  assert.equal(parseDuration("1h\t5m"), 3900000);
  assert.equal(parseDuration(" 1h "), 3600000);
});

test("parseDuration: zero and amounts beyond carry", () => {
  assert.equal(parseDuration("0s"), 0);
  assert.equal(parseDuration("0ms"), 0);
  assert.equal(parseDuration("90m"), 5400000);
  assert.ok(Number.isInteger(parseDuration("1d2h")));
});

test("parseDuration: non-string throws TypeError", () => {
  for (const v of [1000, null, undefined, ["1h"], {}]) assert.throws(() => parseDuration(v), TypeError);
});

test("parseDuration: empty or blank is invalid", () => {
  invalid("");
  invalid("   ");
});

test("parseDuration: malformed parts are invalid", () => {
  for (const s of ["1H", "1x", "h", "1", "1.5h", "-1h", "1 h", "abc", "1h,5m", "1hh"]) invalid(s);
});

test("parseDuration: repeated unit is invalid", () => {
  invalid("1h2h");
  invalid("1m1m");
  invalid("1ms 2ms");
});

test("parseDuration: out-of-order units are invalid", () => {
  for (const s of ["1m1h", "1s1m", "1ms1s", "1h1d", "5s 1h"]) invalid(s);
});

test("formatDuration: canonical output", () => {
  const cases = [[0, "0s"], [500, "500ms"], [1000, "1s"], [60000, "1m"], [5400000, "1h30m"],
    [90061001, "1d1h1m1s1ms"], [86400000, "1d"], [3600001, "1h1ms"], [172800000, "2d"]];
  for (const [ms, s] of cases) assert.equal(formatDuration(ms), s);
});

test("formatDuration: invalid input throws RangeError", () => {
  for (const v of [-1, 1.5, NaN, Infinity, "5"]) assert.throws(() => formatDuration(v), RangeError, String(v));
});

test("formatDuration(parseDuration(x)) round-trips canonical inputs", () => {
  for (const s of ["1h30m", "2d", "500ms", "1d1h1m1s1ms", "0s", "59m59s999ms"]) assert.equal(formatDuration(parseDuration(s)), s);
});

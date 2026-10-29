import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, formatDuration } from "../src/duration.mjs";

test("parseDuration parses combined parts", () => {
  assert.equal(parseDuration("1h30m"), 5400000);
});

test("formatDuration formats compactly", () => {
  assert.equal(formatDuration(5400000), "1h30m");
});

test("formatDuration(0) is 0s", () => {
  assert.equal(formatDuration(0), "0s");
});

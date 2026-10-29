import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.mjs";

test("parseCsv parses simple rows", () => {
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv handles quoted commas", () => {
  assert.deepEqual(parseCsv('"a,b",c'), [["a,b", "c"]]);
});

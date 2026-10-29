import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.mjs";

test("parseCsv: empty input", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("parseCsv: single row", () => {
  assert.deepEqual(parseCsv("a,b,c"), [["a", "b", "c"]]);
});

test("parseCsv: multiple rows and single trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv: CRLF line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv: quoted field with comma", () => {
  assert.deepEqual(parseCsv('"a,b",c'), [["a,b", "c"]]);
});

test("parseCsv: doubled quotes inside quotes", () => {
  assert.deepEqual(parseCsv('"he said ""hi""",x'), [['he said "hi"', "x"]]);
});

test("parseCsv: quoted field with newline", () => {
  assert.deepEqual(parseCsv('"l1\nl2",x\ny,z'), [["l1\nl2", "x"], ["y", "z"]]);
});

test("parseCsv: empty fields and trailing comma", () => {
  assert.deepEqual(parseCsv("a,,c\n,\n"), [["a", "", "c"], ["", ""]]);
  assert.deepEqual(parseCsv("a,b,"), [["a", "b", ""]]);
  assert.deepEqual(parseCsv('"",x'), [["", "x"]]);
});

test("parseCsv: whitespace is preserved", () => {
  assert.deepEqual(parseCsv(" a , b "), [[" a ", " b "]]);
});

test("parseCsv: blank middle line is a row with one empty field", () => {
  assert.deepEqual(parseCsv("a\n\nb"), [["a"], [""], ["b"]]);
});

test("parseCsv: unterminated quote", () => {
  for (const s of ['"abc', 'a,"b\nc']) assert.throws(() => parseCsv(s), (e) => e instanceof Error && e.message === "unterminated quote");
});

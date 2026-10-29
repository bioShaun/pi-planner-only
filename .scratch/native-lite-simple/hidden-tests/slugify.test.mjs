import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.mjs";

const cases = [
  ["Hello World", "hello-world"],
  ["Crème Brûlée", "creme-brulee"],
  ["Déjà Vu 2024", "deja-vu-2024"],
  ["  --Hello,   World!!  ", "hello-world"],
  ["foo___bar...baz", "foo-bar-baz"],
  ["a--b", "a-b"],
  ["CamelCase123", "camelcase123"],
  ["ÀÉÎÕÜ", "aeiou"],
  ["ﬁle Ⅳ", "file-iv"],
  ["日本語 abc", "abc"],
];

for (const [input, want] of cases) {
  test(`slugify(${JSON.stringify(input)})`, () => assert.equal(slugify(input), want));
}

test("slugify: no alphanumerics gives empty string", () => {
  for (const s of ["!!!", "", "   ", "---", "日本語"]) assert.equal(slugify(s), "");
});

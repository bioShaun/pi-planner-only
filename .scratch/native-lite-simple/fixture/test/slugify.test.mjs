import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.mjs";

test("slugify joins words with hyphens", () => {
  assert.equal(slugify("hello world"), "hello-world");
});

test("slugify strips accents", () => {
  assert.equal(slugify("Crème Brûlée"), "creme-brulee");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README has a ## Usage section", () => {
  const text = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(text, /^## Usage\s*$/m);
});

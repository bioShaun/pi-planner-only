import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function staticOutput(mode) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    key !== "PI_PLANNER_ONLY" && !key.startsWith("PI_PLANNER_ONLY_") && key !== "PI_SUBAGENT_CHILD"));
  env.PI_PLANNER_ONLY_MODE = mode;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "bench/overhead.mjs", "static"], { env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}

test("static measures Lite prompts regardless of operator mode", () => {
  const baseline = staticOutput("lite");
  assert.match(baseline, /non-strict: appended prompt [1-9]\d* chars/);
  assert.match(baseline, /strict: appended prompt [1-9]\d* chars/);
  for (const mode of ["native", "off"]) {
    assert.equal(staticOutput(mode), baseline, `operator mode ${mode} must measure Lite`);
  }
});

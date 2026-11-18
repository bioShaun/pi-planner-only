import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

test("two-ref static measurements isolate delayed imports from Native and Off modes", () => {
  const dir = mkdtempSync("/project/tmp/overhead-test-");
  try {
    mkdirSync(join(dir, "bench"));
    mkdirSync(join(dir, "node_modules"));
    const script = readFileSync(resolve("bench/overhead.mjs"), "utf8")
      .replace('const SCRATCH = "/project/tmp/ppo-bench";', `const SCRATCH = ${JSON.stringify(join(dir, "cache"))};`);
    writeFileSync(join(dir, "bench/overhead.mjs"), script);
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git("init", "-q");
    git("config", "user.name", "Overhead Test");
    git("config", "user.email", "overhead@example.invalid");
    const refs = [];
    for (const delay of [20, 100]) {
      writeFileSync(join(dir, "index.ts"), `
        await new Promise(resolve => setTimeout(resolve, ${delay}));
        if (process.env.PI_PLANNER_ONLY !== "1" || process.env.PI_PLANNER_ONLY_MODE !== "lite" || process.env.PI_SUBAGENT_CHILD !== undefined) throw new Error("import did not see Lite environment");
        export default function(pi) {
          pi.on("before_agent_start", async event => ({ systemPrompt: event.systemPrompt + " fixture" }));
        }
      `);
      git("add", "index.ts");
      git("commit", "-qm", `fixture ${delay}`);
      refs.push(git("rev-parse", "HEAD"));
    }
    for (const mode of ["native", "off"]) {
      const output = join(dir, `${mode}.json`);
      const child = spawnSync(process.execPath, ["--experimental-strip-types", join(dir, "bench/overhead.mjs"), "static", "--ref", refs[0], "--ref", refs[1], "--json", output], {
        cwd: dir, encoding: "utf8", env: { ...process.env, PI_PLANNER_ONLY: "0", PI_PLANNER_ONLY_MODE: mode, PI_SUBAGENT_CHILD: "1" },
      });
      assert.equal(child.status, 0, child.stderr);
      const results = JSON.parse(readFileSync(output, "utf8"));
      assert.deepEqual(results.map(result => result.error ?? null), [null, null], `${mode}: ${child.stdout}`);
      assert.deepEqual(results.map(result => result.ref), refs);
      for (const result of results) assert.deepEqual(result.modes.map(mode => mode.strict), [false, true]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

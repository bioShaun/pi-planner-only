import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveExplorerModelSelection } from "../../explorer-model.ts";

const root = resolve(".scratch/explorer-model-config-review-20260918/tmp/adapter-fixtures");
const userDir = join(root, "user");
const projectDir = join(root, "project");
const userSettings = join(userDir, "settings.json");
const projectSettings = join(projectDir, ".pi", "settings.json");
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function run(label, user, project, availableModels) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  if (user !== undefined) writeJson(userSettings, user);
  if (project !== undefined) writeJson(projectSettings, project);
  process.env.PI_CODING_AGENT_DIR = userDir;
  const input = { cwd: projectDir, availableModels };
  const result = resolveExplorerModelSelection(input);
  console.log(JSON.stringify({ label, input, result }, null, 2));
}

try {
  run("A", {}, undefined, [{ provider: "p", id: "m" }]);
  run(
    "B",
    { subagents: { defaultModel: "p/default", agentOverrides: { scout: { model: "p/user", thinking: "low" } } } },
    { subagents: { agentOverrides: { scout: { thinking: "high" } } } },
    [{ provider: "p", id: "default" }, { provider: "p", id: "user" }],
  );
  run(
    "C",
    { subagents: { agentOverrides: { scout: { model: "nested/model-d" } } } },
    undefined,
    [{ provider: "scoutp", id: "nested/model-d" }],
  );
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(root, { recursive: true, force: true });
}

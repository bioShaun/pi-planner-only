#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/tcuni-claw/pi/pi-planner-only"
ACCEPT_DIR="${REPO_DIR}/.scratch/explorer-model-config/acceptance"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
EVIDENCE_DIR="${REPO_DIR}/.scratch/explorer-model-config/evidence"
RUN_ROOT="${ACCEPT_DIR}/runs/${RUN_ID}"
AGENT_DIR="${RUN_ROOT}/agent"
WORKSPACE_DIR="${RUN_ROOT}/workspace"
TMP_ROOT="${RUN_ROOT}/tmp"
RUN_EVIDENCE_DIR="${EVIDENCE_DIR}/${RUN_ID}"
export TMPDIR="${TMP_ROOT}"
export TMP="${TMPDIR}"
export TEMP="${TMPDIR}"

mkdir -p "${RUN_EVIDENCE_DIR}" "${TMPDIR}"
mkdir -p "${AGENT_DIR}"
mkdir -p "${WORKSPACE_DIR}"

cleanup() {
	rm -rf "${RUN_ROOT}"
}
trap cleanup EXIT

echo "=== Slot Audit & Status ==="
slot audit > "${RUN_EVIDENCE_DIR}/slot-audit.log" 2>&1 || true
slot status > "${RUN_EVIDENCE_DIR}/slot-status.log" 2>&1 || true

echo "=== Pre-flight versions ==="
PI_BIN=$(which pi)
PI_VER=$("${PI_BIN}" --version)
SUBAGENTS_VER=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(require("os").homedir() + "/.pi/agent/npm/node_modules/pi-subagents/package.json")).version)')
GIT_HEAD=$(git -C "${REPO_DIR}" rev-parse HEAD)
{
	echo "Pi: ${PI_VER} (${PI_BIN})"
	echo "pi-subagents: ${SUBAGENTS_VER}"
	echo "Git HEAD: ${GIT_HEAD}"
} > "${RUN_EVIDENCE_DIR}/preflight.log"
sha256sum "${REPO_DIR}/index.ts" "${REPO_DIR}/explorer-model.ts" > "${RUN_EVIDENCE_DIR}/source-sha256.txt"

# Reset workspace target file
mkdir -p "${WORKSPACE_DIR}/notes"
cat << 'EOF' > "${WORKSPACE_DIR}/notes/architecture.md"
# Acceptance Target

This is a target file for the Explorer observation task in ticket 03.
Key detail: explorer-model-acceptance-20260918-token.
EOF

# Build a fresh workspace repository with a tracked observation target.
git -C "${WORKSPACE_DIR}" init -q
git -C "${WORKSPACE_DIR}" -c user.name='acceptance-runner' -c user.email='acceptance-runner@invalid' add notes/architecture.md
git -C "${WORKSPACE_DIR}" -c user.name='acceptance-runner' -c user.email='acceptance-runner@invalid' commit -q -m 'acceptance target'

# Select existing operator definitions without printing credential values.
node - "${HOME}/.pi/agent/models.json" "${AGENT_DIR}/models.json" "${RUN_EVIDENCE_DIR}/models-sanitized.json" <<'NODE'
const fs = require("node:fs");
const [sourcePath, runtimePath, sanitizedPath] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const providers = source.providers ?? {};
const selected = {};
for (const name of ["tcuni-luna", "qwen-local"]) {
  if (!providers[name]) throw new Error(`missing required provider: ${name}`);
  selected[name] = providers[name];
}
fs.writeFileSync(runtimePath, JSON.stringify({ providers: selected }, null, 2) + "\n");
const metadata = { providers: {} };
for (const [name, provider] of Object.entries(selected)) {
  metadata.providers[name] = {
    models: (provider.models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
    })),
  };
}
fs.writeFileSync(sanitizedPath, JSON.stringify(metadata, null, 2) + "\n");
NODE
printf '{}\n' > "${AGENT_DIR}/models-store.json"
printf '{}\n' > "${AGENT_DIR}/auth.json"
cat << 'EOF' > "${AGENT_DIR}/settings.json"
{
  "subagents": {
    "agentOverrides": {
      "scout": {
        "model": "qwen-local/qwen3.8-27b",
        "thinking": "low"
      }
    }
  }
}
EOF

# Clean previous sessions/ledgers
rm -rf "${AGENT_DIR}/sessions" "${AGENT_DIR}/planner-only"

PROMPT="Execute these steps in order, no deviation:
1. Call planner_delegate with role='explorer', acceptanceMode='observation', objective='Read the notes in notes/architecture.md and report its contents', scope={allowedPaths:['notes/']}, constraints=[], acceptanceCriteria=[], validation={required:false}, envelope={maxTokens:5000, maxWallMs:60000}.
2. Call planner_tasks with taskId set to the taskId returned by step 1.
3. Call planner_verdict with taskId=<same taskId>, verdict='pass', summary='Observation verified: architecture notes inspected'.
4. Reply with the final task state and taskId."

echo "=== Running Acceptance in Slot ==="
export PI_CODING_AGENT_DIR="${AGENT_DIR}"
export PI_PLANNER_ONLY_SEED_PRICING="0"
export PI_PLANNER_ONLY_QUIESCENCE_MS="0"
unset PI_SUBAGENT_CHILD || true

cd "${WORKSPACE_DIR}"

set +e
slot cpu -L "explorer-model-acceptance" -- \
  pi -p --mode json --no-extensions \
  -e /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.ts \
  -e "${REPO_DIR}/index.ts" \
  --provider tcuni-luna --model gpt-5.6-luna \
  "${PROMPT}" \
  > "${RUN_EVIDENCE_DIR}/pi-host-stdout.jsonl" \
  2> "${RUN_EVIDENCE_DIR}/pi-host-stderr.txt"
EXIT_CODE=$?
set -e
echo "Pi exited with code: ${EXIT_CODE}"
printf '%s\n' "${EXIT_CODE}" > "${RUN_EVIDENCE_DIR}/pi-host-exit-code.txt"

echo "=== Copying Acceptance Artifacts ==="
# Find session dir
SESSION_DIR=$(find "${AGENT_DIR}/sessions" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)
echo "Root Session dir: ${SESSION_DIR}"

# Find subagent artifacts
SUBAGENT_DIR="${SESSION_DIR}/subagent-artifacts"
if [ -d "${SUBAGENT_DIR}" ]; then
  cp -r "${SUBAGENT_DIR}" "${RUN_EVIDENCE_DIR}/"
fi
find "${AGENT_DIR}/sessions" -type f -path '*/run-*/session.jsonl' -print -exec cp --parents '{}' "${RUN_EVIDENCE_DIR}/" \; 2>/dev/null || true
node - "${AGENT_DIR}/settings.json" "${RUN_EVIDENCE_DIR}/settings-snapshot.json" <<'NODE'
const fs = require("node:fs");
const source = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const scout = source?.subagents?.agentOverrides?.scout;
fs.writeFileSync(process.argv[3], JSON.stringify({ subagents: { agentOverrides: { scout } } }, null, 2) + "\n");
NODE

# Copy ledger
if [ -d "${AGENT_DIR}/planner-only" ]; then
  cp -r "${AGENT_DIR}/planner-only" "${RUN_EVIDENCE_DIR}/"
fi

VALIDATION_STATUS=0
node - "${RUN_EVIDENCE_DIR}" <<'NODE' || VALIDATION_STATUS=$?
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const ledgerRoot = path.join(root, "planner-only", "ledger");
const ledgers = fs.existsSync(ledgerRoot) ? fs.readdirSync(ledgerRoot).filter((name) => name.endsWith(".json")) : [];
if (ledgers.length === 0) throw new Error("no acceptance ledger captured");
for (const name of ledgers) {
  const record = JSON.parse(fs.readFileSync(path.join(ledgerRoot, name), "utf8"));
  const task = record.task;
  if (task?.state !== "completed" || !Array.isArray(task.reports) || task.reports.length === 0) {
    throw new Error(`ledger ${name} is not completed with an admitted report`);
  }
  for (const execution of task.executions ?? []) {
    if (execution.unacceptedReport) throw new Error(`ledger ${name} contains an unaccepted report`);
  }
  const executionIds = new Set((task.executions ?? []).map((execution) => execution.runId).filter(Boolean));
  for (const report of task.reports) {
    const workerRunId = report.evidence?.workerRunId;
    if (!workerRunId || !executionIds.has(workerRunId)) throw new Error(`ledger ${name} has an identity mismatch`);
  }
}
NODE
printf '%s\n' "${VALIDATION_STATUS}" > "${RUN_EVIDENCE_DIR}/acceptance-validation-exit-code.txt"

echo "=== Acceptance execution finished ==="
if [ "${EXIT_CODE}" -ne 0 ]; then exit "${EXIT_CODE}"; fi
exit "${VALIDATION_STATUS}"

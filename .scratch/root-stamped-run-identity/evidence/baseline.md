# Baseline Environment Record

Date: 2026-09-18
Spec: `.scratch/root-stamped-run-identity/spec.md`

## 1. Plugin Information
- Git commit HEAD: `84cced4372700cac3051312b4867615820c696b2`
- `package.json` version: `0.8.0`
- `loadedFingerprint`: `ca5d30b14b5b486513592835a32773d98292a8bafd136771bd36982ea654fcbe`

## 2. Host & Launcher Information
- Host: `@earendil-works/pi-coding-agent@0.85.1` (`/home/tcuni-claw/.nvm/versions/node/v24.14.0/bin/pi`)
- Launcher: `pi-subagents@0.68.0` (`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`)

## 3. Provider & Model Configuration
- Scenario A:
  - Root session: `tcuni-luna / gpt-5.6-luna`
  - Explorer: **实际** `tcuni-luna / gpt-5.6-luna`（与 Root 相同；`A/meta.json:14`，三次执行一致）。`settings.json` 配置了 `subagents.agentOverrides.scout = qwen-local/qwen3.8-27b, thinking low`，但**未生效**——0.8.0 不含 explorer 模型路由（`4fa55e3` 已回退 explorer-model 接线），override 不作用于 `planner-scout`。此行 2026-09-18 更正：原记录写的是配置意图，不是实际运行模型。
- Scenario B:
  - Root session: `qwen-local / qwen3.8-27b`
  - Worker subagent: `tcuni-luna / gpt-5.6-luna`
- Scenario C:
  - Root session: `qwen-local / qwen3.8-27b`

## 4. Isolation Directories
- Project base: `/home/tcuni-claw/pi/pi-planner-only`
- Temporary base (`TMPDIR`): `.scratch/root-stamped-run-identity/acceptance/tmp` (project-local, no `/tmp`)
- Agent data directory (`PI_CODING_AGENT_DIR`): `.scratch/root-stamped-run-identity/acceptance/agent`
- Working directories:
  - Scenario A (Explorer, non-Git): `.scratch/root-stamped-run-identity/acceptance/workspace-a`
  - Scenario B (Worker, Git with redelegate round): `.scratch/root-stamped-run-identity/acceptance/workspace-b`
  - Scenario C (Negative rejection): evaluated against isolated agent ledger

## 5. Slot Preflight
- Preflight slot audit & status saved to: `evidence/slot-preflight.txt`
- Execution slot pool: `slot cpu`

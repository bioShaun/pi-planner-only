# 本机安装副本更新记录（2026-09-21）

用户于 2026-09-21 推送 main 至远端后授权执行 RELEASE-STEPS.md 第 2–7 步。远端 `origin/main` 经 `git ls-remote` 核实为 `9b96580`。

## 更新前状态（第 2 步）

- 安装副本：`~/.pi/agent/git/github.com/bioShaun/pi-planner-only`
- HEAD `9d9a5e3`（RELEASE-STEPS 写作时为 `fd40580`，之后已被其他任务更新到 `9d9a5e3`）
- `git status --short` 为空、无未跟踪文件、`git diff --binary` 为 0 字节：见 `install-*-before.*`。因此没有需要维护者裁决的脏改动，不涉及丢弃。

## 更新（第 4 步）

- `slot audit` / `slot status` 已记录（`slot-audit.txt`、`slot-status.txt`，无绕过进程）。
- 命令：`slot cpu -- pi update git:github.com/bioShaun/pi-planner-only </dev/null`，exit 0，日志 `update-stdout.log`。
- 更新后 HEAD `9b96580`（`install-head-after.txt`）。唯一残留改动是 `package-lock.json` 里 `0.5.0 → 0.8.0` 两行，由 `pi update` 触发的 npm 写回；仓库里的 lockfile 本就落后于 package.json，非本轮功能改动。

## 验收（第 5–7 步）

- 第 7 步（准备阶段取消与恢复交接）：`execution/host-acceptance.mjs` 新增 `RUNAWAY_PLUGIN_DIR` 环境变量以加载安装副本（修改前副本 `host-acceptance.pre-plugin-dir.mjs`），`versions.json` 记录 `pluginDir` 与 `pluginHead`。运行 `execution/host-zSxMoh/` + `execution/host-run-OIN6KV/`：exit 0，`pluginHead=9b96580`，Pi 0.86.1 + pi-subagents 0.70.0，子模型 `tcuni-luna/gpt-5.6-luna`；probe-first / probe-retry 均 `preparation_runaway`、停止确认、无 writer hold；恢复子会话首条 user 消息含 `priorExecution`；`verify-host-evidence.mjs` exit 0。
- 第 6 步（Explorer 模型身份）：`.scratch/explorer-model-upstream-runtime-agent-settings/acceptance/run-acceptance.sh deploy-installed-9b96580 <installed pi-subagents index.ts> tcuni-ds/deepseek/deepseek-v4.1-flash`，`PLUGIN_DIR` 指向安装副本。真实 pi 会话 exit 0，ledger 显示 planner-scout 实际运行在 `tcuni-ds/deepseek/deepseek-v4.1-flash:low`，Root 为 `gemini-3.8-flash-high`，`VALIDATION PASS`。证据目录见 `step6-explorer-acceptance.console.log` 末尾。
- 第 5 步（新会话加载插件）：以上两项均通过真实 Pi SDK / 真实 `pi` CLI 新建会话加载安装副本完成；未重启任何现有会话。

## 未做

- 未对安装副本执行 reset/clean；未改全局配置；兼容范围声明（pi-subagents `>=0.65 <0.70`）未扩展，本机 0.70.0 集成探针不代表整个范围。

# 04: 在已安装的 `pi-subagents@0.68.0` 上真实收口 Explorer 与 Worker

Status: resolved
Type: acceptance
Blocked by: 01, 02, 03
来源：../spec.md §Testing Decisions 末段、User Story 1/2/8

**What to build：** 用真实 Pi host + 已安装 launcher，证明 0.8.0 在本机环境下能启动 child、接纳报告、完成 Verdict。这是 0.5 以来第一次不靠 mock 的身份链路验收；之前所有"宿主验收"要么是 fake launcher 硬编码相同 runId，要么以 `reports=[]` 收场。

## 基线记录（先做）

写入 `evidence/baseline.md`：

- 插件：`git rev-parse HEAD`、`package.json` 版本、`/planner-only status` 输出的 loadedFingerprint。
- Host：`@earendil-works/pi-coding-agent` 版本；Launcher：`pi-subagents` 版本（预期 0.68.0）。
- provider/model（Root 与 scout 各自）。
- 隔离目录：`PI_CODING_AGENT_DIR` 指向项目内一次性目录（不写 `/tmp`，见 CLAUDE.md）；账本目录随之隔离，不碰 `~/.pi/agent/planner-only/ledger`。
- 启动前 `slot audit` + `slot status` 输出落 `evidence/slot-preflight.txt`（宿主运行预计 >1 分钟；若按池规则需排队，用 `slot cpu -- ...`）。

## 场景 A：Explorer observation Task，非 Git 目录

1. cwd 为项目内一个**非 Git** 的一次性目录，放一个 `fixture.txt`。
2. Root 自然 prompt（不给工具参数模板）："Read fixture.txt in the current workspace and report its word count. Make no changes."
3. 预期链路：`planner_delegate{role:"explorer", acceptanceMode:"observation", ...}` → child 启动（`details.runId` 为 UUID）→ 报告接纳（`details.report.evidence.workerRunId === details.runId`，`state: "reviewing"`）→ `planner_verdict pass` → completed。
4. 必须观察到：**没有** `LAUNCHER_CAPABILITY_UNSUPPORTED`；**没有** `unacceptedReport`；`reports.length === 1`；无 writer hold；`planner_tasks` 诊断显示 execution capability `restricted-reader`。
5. 保存：Root session JSONL（脱敏）、child `_meta.json`、账本 `T-*.json`、tool call/result 对。

## 场景 B：Worker Task，Git 目录，含一轮纠正

1. cwd 为项目内一次性 Git 仓库（`git init` + 一次初始提交，含 `hello.txt`）。
2. Root 自然 prompt："Change hello.txt to contain exactly the line `hi` and run `cat hello.txt` as validation."
3. 首轮预期：`planner_delegate{role:"worker", validation:{required:true, commands:["cat hello.txt"]}}` → 报告接纳 → reviewing。
4. 制造纠正轮：以操作者身份 `/planner-only review` 或让 Root 对首轮 `request_changes`（例如要求末尾换行）→ Root `planner_redelegate{taskId}` → 第二次执行。
5. 必须观察到：两次 `details.runId` 不同；账本 `reports.map(r => r.evidence.workerRunId)` 等于两次 `executions[].runId`；`reportIdentityRefusal` 未触发（verdict 不出现 `report-identity` 拒绝）；最终 `planner_verdict pass` → completed；`git_commit` 可执行（可选）。
6. 保存同 A。

## 场景 C（负向，保证没有整体放松）

在 A 或 B 的同一基线上，用 `delegate.test.mjs` 的既有 taskId 错配用例 + 一次真实宿主 `planner_verdict` 对**别的** Task id → `TASK_UNKNOWN` 拒绝。目的只是证明 taskId 门仍在；不需要专门诱导模型写错 taskId。

## 记录要求

- 三个场景各一份 `evidence/<A|B|C>/` 目录：`toolcalls.json`（完整 tool call/result，去敏）、`ledger.json`、`meta.json`、`session-head.txt`（session 文件路径 + SHA-256，不复制整段 transcript）。
- `evidence/REPORT.md`：基线、每场景的观察结果表（预期 / 实际 / PASS-FAIL）、未通过项、环境阻塞（provider 连接失败、slot EPERM 等）**按实际写**，不用 mock 结果补位。
- 若 provider 或 slot 环境阻塞导致某场景没跑成：Status 保持 `ready-for-agent`，REPORT 写 BLOCKED 与原因；不得把 01/02 的单测结果写成宿主通过。

## 验收

1. A、B 均 PASS，C 拒绝如预期。
2. `evidence/REPORT.md` 中 loadedFingerprint 与 `git rev-parse HEAD` 对应的是 01-03 全部落地后的源码（不是工作区里一半改动的中间态）。
3. 完整 `npm run test:release` 从普通终端 exit 0，日志落 `evidence/release.log`（这是本 spec 唯一一次全量 gate）。
4. 通过后本票 Status → `resolved`，spec Status → `done`。

## Comments

- 2026-09-18 开票。对照组：`.scratch/explorer-model-config/evidence/REPORT.md:11` 是同类 Explorer 场景在 0.7.0 上的失败样本（runId `d8280241…` vs 报告 `explorer-model-config-T-20260918-001`，`reports=[]`）；A 场景过了就是对它的直接翻转。
- 2026-09-18 验收完成：场景 A（Explorer, 非 Git）、场景 B（Worker, Git 纠正轮）真实宿主运行全部 PASS，场景 C（负向未知 taskId 拒收）验证成功。真实宿主证据见 `evidence/<A|B|C>/` 及 `evidence/REPORT.md`。全量测试 `npm run test:release` 30 测试文件全部 exit 0，落日志 `evidence/release.log`。本票关闭。
- 2026-09-18 审计补齐：按实际运行在 `evidence/REPORT.md` 补全场景 A 的 3 次 execution 序列（含两次 `worker_runaway` 及 WRC recovery 自主恢复），并将场景 B 明确界定为“指令式宿主集成验证”（遵循 2026-09-17 审计口径）。


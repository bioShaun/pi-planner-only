[轮次] round_id=p20-r095-e23-landing

你是本轮的**执行者**（pi，pane `w2E:pG`）。
**做完必须把报告落盘**（见 §5）；当前没有活的 planner pane，报告文件本身就是回报，写完就停，不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`（主仓，分支 `planner-only-cost-control`，当前 HEAD 含 .scratch 提交；产品代码与 worktree 基线 `45d9493` 逐字相同——这已由 planner 用 `git diff 45d9493..HEAD -- index.ts orchestrate.ts orchestrate.test.mjs` 验证为空）。

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 重命令（测试、typecheck）一律 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p20-scale/p20-r095-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者；不要碰 `quarantine/`。

## 1. 一句话目标

把 p20 对照实验已验证的 **E2 + E3 两个产品修复** 落进主仓 `orchestrate.ts` 与 `orchestrate.test.mjs`。
改动内容已知良好（两臂快照字节相同、worktree 测试 PASS），本轮是**重新应用**，不是 checkout 快照。

只读参考（不许改）：
- `.scratch/planner-only-cost-control/p20-scale/split-e3-orchestrate.ts.diff`（E3 产品 diff）
- `.scratch/planner-only-cost-control/p20-scale/split-e3-orchestrate.test.mjs.diff`（E3 测试 diff，**采用这份**，不用 iso 版）
- `.scratch/planner-only-cost-control/p20-scale/split-e2-orchestrate.ts.diff`（E2 产品 diff）
- `.scratch/planner-only-cost-control/p20-scale/split-e2-orchestrate.test.mjs.diff`（E2 测试 diff）

## 2. 围栏

[可以改] `orchestrate.ts`、`orchestrate.test.mjs`，且仅限下面 §3 列出的三处产品改动与两处测试新增。
[可以新建] `.scratch/planner-only-cost-control/p20-scale/p20-r095-*.log` 与 `p20-r095-execution-report.md`。
[不许动] 其余一切产品文件；`issues/`、`spec.md`、`deferred-backlog.md`、p20-scale 既有文件；
**既有断言一律不许删除或改写**。确有必要时停下来报告：哪一条、第几行、为什么变红。
**擅自删除既有断言视为回归**，本轮不予接收。
不 commit、不 push、不勾 checkbox、不动 worktree。

## 3. 改动清单（三处产品 + 两处测试）

1. **E3 产品**（`orchestrate.ts`，`reservation.refused` 分支，约 L815）：
   在 `return { block: { reason: this.cumulativeBudgetRefusal(...) } }` 之前加
   对 `input` 的 `usageBudget` 与 `__floorLimits` 两行 delete（带 `input && typeof input === "object" && !Array.isArray(input)` 守卫），
   逐字照 `split-e3-orchestrate.ts.diff`。不改拒绝文案。
2. **E2 产品**（`orchestrate.ts`，`renderTaskStatus` 的状态行数组，约 L1300）：
   在 `Changed files:` 行之后追加
   `...(this.snapshots?.writeErrorFor(task.taskId) ? ["Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）"] : []),`
   逐字照 `split-e2-orchestrate.ts.diff`。「余额不可信」等既有文案一个字不动。
3. **E3 测试**（`orchestrate.test.mjs`）：按 `split-e3-orchestrate.test.mjs.diff` 插入
   `T-20260908-v16` 块（在 `boundedBudgetUsage` helper 之后、「Ticket 14A V13」注释之前），
   含 `reports.push`、真实形状 `__floorLimits`、两条带消息的 assert。
4. **E2 测试**（`orchestrate.test.mjs`）：按 `split-e2-orchestrate.test.mjs.diff` 在
   L15（placeholder persist、损坏字节）之后插入 L15b 一条
   `assert.match(orch.renderTaskStatus(placeholder), /本会话无法写入该 taskId 的账本/, "L15b: ...")`。
   L10/L14b 不动。

新增断言合计 3+2+1 条（E3 两条带消息、E2 一条 L15b）。一条断言一个命题。

## 4. 验收（planner 会逐条重跑，别只自检）

1. `npm run typecheck` = 0
2. `slot cpu -- npm test`：输出含 `planner-only architecture: PASS`，且**唯一** AssertionError 是
   `naming.test.mjs` 的 `extension install is missing ledger-store.ts`（exit 1 预期）
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` = 0
4. `git diff --check` = 0
5. `git diff -- orchestrate.test.mjs | grep '^-.*assert'` 必须为空
6. **逐条失败证明**（做完还原，`git diff` 应回到只有四条新增的状态）：
   - 删掉 E3 两行 delete → v16 块两条 assert 红
   - 删掉 E2 状态行 → L15b 红
7. worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` **不许动**。

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p20-scale/p20-r095-execution-report.md`：
round_id、起止 HEAD、`git diff --stat`、四条验收命令原文摘要、失败证明各一行、
`grep '^-.*assert'` 结果、没做到的事与假设。落盘即回报，不要再改工作区。

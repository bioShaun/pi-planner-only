[轮次] round_id=PENDING

# 任务：工单 26 —— 让被跳过的契约测试无法通过发布闸门

你是执行者。回报地址：**planner pane `w2E:pD`**（用 `herdr agent prompt --pane w2E:pD` 回报，
不要只在自己 pane 里输出）。工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支
`planner-only-cost-control`。你没有继承我的任何上下文，本文件就是全部输入。

## 环境硬规矩（子代理常常读不到全局规则，这里逐条写明）

- 任何中间文件、临时目录、日志**一律不得**放在 `/tmp` 或其子目录。任务内产物放当前工作目录下
  一个明确命名的可丢弃子目录；需要放在工作目录之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （本任务用 `slot cpu -- <命令>`）。
- **启动重任务前先跑 `slot audit` 与 `slot status`，把输出写进项目日志文件**（放
  `.scratch/planner-only-cost-control/` 下，文件名带你的 round_id）。`slot audit` 若报告有绕过
  slot 的其他重进程，**不得擅自终止**它；等待、降低并发或直接向我报告冲突即可。禁止先跑后补查。
- 不要用 `slot slots` 调大槽位给自己插队。

## 允许改动的文件（fence）

- `e2e.pi-subagents.test.mjs` —— 唯一允许写的文件。

只读、**一个字节都不许改**：`index.ts`、`usage.ts`、`orchestrate.ts`、`review.ts`、`roles.ts`、
`task.ts`、`types.ts`、`report.ts`、`evidence.ts`、`notify.ts`、`package.json`、所有 `*.test.mjs`
（除上面那个 e2e 文件）、`.scratch/**`（只读；不许勾任何工单 checkbox、不许改任何工单 Status、
不许碰 `spec.md`）。不要 `git commit`、不要 `git add`、不要建分支、不要 rebase。

## 要做的事

`e2e.pi-subagents.test.mjs:14` 的文件头注释承诺：带 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1`
（发布闸门）时，被跳过的契约测试**必须**非 0 退出——「a skipped contract test must never read
as a pass (C01)」。实际只有 §G 兑现了（守卫在 `:377-383`）。§E 的跳过点在 `:286`、§F 在 `:313`，
两处都是裸 `console.log`，跳过后照样打印 `PASS` 并退出 0，**闸门下也一样**。

把这个洞堵上，并且**写成对所有分节统一生效的形式**：新增分节默认受保护，而不是把 §G 那段 if
再手抄两遍。建议形状（不强制，但语义要等价）：一个 `markContractUnverified(section, reason)`
辅助函数，负责打印那行「未验证」日志；在 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` 时额外向 stderr
打印 FAIL 并置 `process.exitCode = 1`；§E/§F/§G 三处跳过点都改成调用它。

## 硬性约束

1. **不带 `PI_PLANNER_ONLY_REQUIRE_CONTRACT` 时的 stdout 逐字不变**：仍然打印
   `planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)`
   这一行（§E、§G 的对应行同理，措辞与括注一字不改），仍然打印
   `planner-only pi-subagents E2E: PASS`，仍然退出 0。
2. 闸门下的 stderr **必须指名是哪一节**未验证（§E / §F / §G）。
3. **不许为了让闸门变绿而放宽 §F 的判定**。本票落地后 `npm run test:release` 预期**因 §F 变红**，
   这是正确结果，不是回归。你的回报里要明说这一点。
4. §G 现有守卫的行为不得改变（它已经满足 C01）；若你把它并入统一辅助函数，须证明输出等价。
5. `:384` 那段收尾判断（`process.exitCode === 1 && REQUIRE_CONTRACT === "1"` 时不打印 PASS）
   的语义保持不变。

## 先给我 RED（必须与你最终交付的代码对得上）

在动手改实现之前，先跑出并**原样粘贴**下面这条命令的输出，证明洞今天确实存在：

```bash
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 node --experimental-strip-types e2e.pi-subagents.test.mjs; echo "exit=$?"
```

今天它应当打印 §F 未验证却仍 `PASS`、`exit=0`。RED 必须是你**实跑**的输出，不许粘贴历史日志、
不许手写预期。改完之后再跑同一条命令，粘贴新的输出（应为非 0，且 stderr 指名 §F）。

## 验收（我会在自己的 pane 里逐条复跑，报告里说什么都不算数）

```bash
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e            # 不带闸门变量，应仍 PASS 且 exit 0
slot cpu -- git diff --check
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 node --experimental-strip-types e2e.pi-subagents.test.mjs   # 应非 0
```

前四条必须 exit 0；最后一条必须非 0 且 stderr 指名 §F。

## 回报格式

1. 改了哪个文件、每处改动一句话说明；
2. RED 输出（改前）与 GREEN 输出（改后），两段都要原样贴；
3. 上面五条验收命令各自的退出码；
4. slot preflight 日志文件路径；
5. 明确写出「`npm run test:release` 现在因 §F 而红，这是本票的预期结果」。

拿不准就停下来问我，不要自己换个说法或放宽判定。

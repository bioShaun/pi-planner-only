[轮次] round_id=PLACEHOLDER

# 工单 18 收尾：补齐命令层覆盖，修 --arm 解析缺陷，让两条空转断言真正生效

回执发回 planner pane **w2E:pD**（`herdr agent prompt w2E:pD --message '...'`）。
工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，HEAD `2d0518e`。
上一轮（p17-r080）的实现已经提交，本轮只补测试覆盖和一个真实缺陷，不重写已有实现。

## §0 环境硬规则（逐字遵守，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务级中间文件放当前工作目录（本轮放 `.scratch/planner-only-cost-control/p18-probe/`）；
  需要放在工作目录之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。
  本轮的 `npm test` / `npm run test:e2e` 实测 30 秒内，可直接跑，不必走 slot。
- 若确需启动重任务：**先**运行 `slot audit` 和 `slot status` 并把输出写入项目日志，
  再启动。禁止先启动、事后补查。`slot audit` 发现绕过 slot 的其他重进程时**不得擅自终止**，
  应等待、降并发或报告冲突。不要用 `slot slots` 调大槽位给自己插队。
- **禁止**读取、回显或提交 `.agent-dir/models.json`、`.agent-dir/auth.json`（内含 API key）。
- 本目录由四个 agent 共用。**禁止批量删除**；`.planner-only-test-*` 可能是别人在跑的沙箱。
  需要清理时用可逆的 `mv` 移进 `.scratch/planner-only-cost-control/quarantine/`。
- 不 commit，不勾任何 checkbox，不动 `spec.md`、`package.json`、`issues/`。

## §1 fence（只有这些文件可写）

```
index.ts  index.test.mjs  usage.test.mjs
docs/pi-planner-only-cost-comparison-protocol.md
.scratch/planner-only-cost-control/p18-r081-*.log
```

其余一律只读，**特别是 `usage.ts` 本轮不改**（三条款都不需要改它），
以及 `.scratch/planner-only-cost-control/p18-probe/r080-cli-arm-arg.mjs`（planner 的基线探针，原样保留）。

## §2 条款

### 条款 1（真实缺陷，优先级最高）：`usage record` 省略 taskId 时 `--arm` 被当成 task id

`index.ts:1111` 是 `const parts = args.trim().split(/\s+/).filter(Boolean);`，
`usage record` 分支里 `const taskId = (parts[2] ?? "").trim() || store.active()?.taskId;`。
于是 `/planner-only usage record --arm role-split`（**文档 `[<taskId>] [--arm <name>]` 明确允许省略 taskId**）
会把 `"--arm"` 当成 task id。

planner 实跑证据（`node .scratch/planner-only-cost-control/p18-probe/r080-cli-arm-arg.mjs`）：

```
notice: {"m":"Unknown planner-only task: --arm","t":"warning"}
```

要求：解析 taskId 时必须跳过 `--arm` 及其取值（以及任何以 `--` 开头的 token），
省略 taskId 时回落到 `store.active()?.taskId`。修完这个探针必须打印
`Planner-only: no active task to record.`（该探针没有活动 Task），
**不许改探针本身**。`--arm` 的取值解析（`parts.indexOf("--arm")`）行为保持不变。

### 条款 2：命令层断言（`index.test.mjs` 上一轮完全没动，49 行命令层零覆盖）

在 `index.test.mjs` 里为两个新子命令补断言。harness 已经具备一切条件：
文件开头把 `PI_CODING_AGENT_DIR` 指向 `mkdtempSync` 出来的隔离目录，
`commands.get("planner-only").handler(<argstring>, ctx)` 可直接驱动命令，
`notices.at(-1).message` 拿回执；并且 `index.test.mjs:117-121` 已经通过
`tool_call` + `delegationSpec(sessionTaskId)` 建出了一个真实 Task，`store.active()` 有值。

至少覆盖这四个命题，**一条断言一个命题**：

1. `usage record` 带活动 Task 时确实在 `AGENT_DIR/planner-only/runs/` 下写出 `<runId>.json`，
   且文件内容 `JSON.parse` 后 `version === 1`、`task.taskId` 等于那个 Task 的 id。
2. `usage record --arm role-split`（**省略 taskId**）写出的记录 `arm === "role-split"`，
   即条款 1 的阳性对照。
3. `usage summary` 在有记录时输出包含 `费用对照汇总:` 的汇总；
4. `usage summary <不存在的目录>` 给出 warning 且不抛异常。

### 条款 3：让两条空转断言真正生效（`usage.test.mjs`）

上一轮的 `usage.test.mjs` 用**手工伪造**的方式构造不可比记录：
`const missingBase = { ...record, comparable: false, cost: {...}, task: {...}, incomparableReasons: [...] }`。
伪造的记录不经过 `buildRunRecord`，于是两条断言对它们各自声称的命题**恒真**。
planner 已用变异实证：

- 变异 A：把 `usage.ts` 里那行
  `if (!input.task.baseGitRef) reasons.push("no baseline git ref: the starting repo state is unidentified");`
  **整行删掉** → `node usage.test.mjs` 仍打印 `planner-only usage: PASS`。
  即：工单强制要求的那条修复没有任何断言守护。
- 变异 B：把 `summarizeRuns` 里 `const spend = comparable.reduce(...)` 改成 `records.reduce(...)`
  → 仍 `PASS`。即「不可比记录不计入总支出」这条也没有断言守护
  （因为伪造记录的 `totalUsd` 是 `undefined`，两种算法结果相同）。

要求：把 `missingBase` 改成**真的调用 `buildRunRecord`** 构造出来的记录——
同一份 usage、同样的 task facts，唯独 `baseGitRef` 缺失，并给它一个**非零的可比费用**
（例如 root `costUsd` 也是 0.05），这样两条命题才有区分度。然后断言：

- 该记录 `comparable === false`，且 `incomparableReasons` 里含有那条 baseline 原因；
- 汇总的 `totalSpendUsd` 只含可比记录的费用（此时 0.05，而不是 0.10）。

改完后你必须**亲手复现变异 A 和变异 B 并贴出逐字失败输出**，证明它们现在会变红，
再把 `usage.ts` 改回去（`git diff -- usage.ts` 必须为空）。

**浮点陷阱**：本仓库的费用汇总有实测浮点噪声（`0.16999999999999998`、`0.12000000000000001`）。
所有费用断言用容差（`Math.abs(x - expected) < 1e-9`），**禁止** `=== 0.17` 这类写法。

### 条款 4：文档同步

`docs/pi-planner-only-cost-comparison-protocol.md` 里 `usage record [<taskId>] [--arm <name>]`
的签名在条款 1 修完后才成立。若你对参数解析做了任何超出条款 1 的调整，文档必须同步；
没有调整就不要改文档。

## §3 断言质量（三种失效形态，全是本专题现场抓到的）

1. **空转**：删掉断言声称守护的那段实现，断言仍然绿。空转断言比没有断言更糟——
   它宣称了套件并不具备的覆盖。本轮条款 3 修的正是两条空转断言。
2. **测错层**：断言要放在缺陷可观测的那一层。上一轮所有覆盖都堆在 `usage.test.mjs`
   的纯函数层，命令层一条没有，于是条款 1 那个缺陷一路绿灯通过。
3. **合并**：多个命题写进一条 `assert`，逐条失败证明无法成立。一条断言一个命题。

判一条断言空转之前**先怀疑自己的变异**：变异必须和断言语义一样窄，
等价变异（改了写法没改可观测行为）会把好断言误判成空转。

## §4 绝对禁止删除既有断言

p17-r079 曾把两条既有守卫藏进 diffstat 的 `-3` 里。交付前自查，把输出贴进报告：

```
git diff -- usage.test.mjs index.test.mjs | grep '^-.*assert'
```

**这条命令必须没有输出**（`grep` 退出码 1 即为空输出，正常）。

## §5 验收命令（四条都要跑，日志按名字存好）

```
npm run typecheck                                   > .scratch/planner-only-cost-control/p18-r081-typecheck.log 2>&1
npm test                                            > .scratch/planner-only-cost-control/p18-r081-npm-test.log 2>&1
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e > .scratch/planner-only-cost-control/p18-r081-e2e.log 2>&1
git diff --check                                    > .scratch/planner-only-cost-control/p18-r081-diff-check.log 2>&1
```

判据：

- typecheck 退出码 0。
- `npm test` **退出码 1 是预期的**：`naming.test.mjs:26` 恒定失败
  （`extension install is missing ledger-store.ts`，那是一个仓外 install 克隆，跟踪 main，与本分支无关）。
  真正的判据是 **`&&` 链走到了 `planner-only architecture: PASS`**，且 16 个套件打印 `: PASS`，
  且**除 naming.test.mjs 外没有第二个 AssertionError**。
  注意：`orchestrate.test.mjs` 的 `planner-only orchestration: PASS` 横幅出现在第 3717 行、
  全文 5957 行，后面还有 2240 行断言——**看见横幅不等于套件跑完**。
- e2e 退出码 0。
- `git diff --check` 退出码 0。

## §6 回执要求

发回 w2E:pD，包含：

1. 条款 1 的修法（贴改动后的解析代码）+ 原样重跑 `r080-cli-arm-arg.mjs` 的逐字输出；
2. 条款 2 新增的四条断言各自的位置和命题；
3. 条款 3 的变异 A、变异 B 各自的**逐字失败输出**（含 `usage.test.mjs:<行号>`），
   以及 `git diff -- usage.ts` 为空的确认；
4. §4 那条 grep 的输出（应为空）；
5. 四条验收命令的退出码和 `npm test` 里 `: PASS` 的条数；
6. `git diff --stat`；
7. 任何你做了但工单没要求的改动，逐条说明。**没做到的就写没做到，不要伪造证明**——
   上一轮你如实报告了没做失败证明，那是对的，这一轮继续保持。

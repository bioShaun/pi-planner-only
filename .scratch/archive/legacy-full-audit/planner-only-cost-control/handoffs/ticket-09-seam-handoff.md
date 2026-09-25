[轮次] round_id=PENDING

# 任务：工单 09 —— 把角色模型策略的三条拒绝路径与「工具能力不随模型改变」补成接缝证据

你是执行者。回报地址：**planner pane `w2E:pD`**（用 `herdr agent prompt w2E:pD '<回报正文>'` 回报，
不要只在自己 pane 里输出）。工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支
`planner-only-cost-control`。你没有继承我的任何上下文，本文件就是全部输入。

## 环境硬规矩（子代理常常读不到全局规则，这里逐条写明）

- 任何中间文件、临时目录、日志**一律不得**放在 `/tmp` 或其子目录；要放在工作目录之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （本任务用 `slot cpu -- <命令>`）。
- **启动重任务前先跑 `slot audit` 与 `slot status`，输出写进 `/project/tmp/<你的round_id>-slot-preflight.log`**
  （**不要**写进 `.scratch/`，那里对你只读）。`slot audit` 若报告有绕过 slot 的重进程，
  **不得擅自终止**，等待或直接报告冲突。禁止先跑后补查。
- 不要用 `slot slots` 调大槽位给自己插队。

## 允许改动的文件（fence）

可写：`orchestrate.test.mjs`、`e2e.pi-subagents.test.mjs`。**本轮只写测试，不改任何生产代码。**

只读、一个字节都不许改：所有 `*.ts`、`index.test.mjs`、`role-models.test.mjs`、`roles.test.mjs`
及其余所有测试文件、`package.json`、`.scratch/**`（不许勾任何工单 checkbox、不许改 Status、
不许碰 `spec.md`）。不要 `git commit` / `git add` / 建分支 / rebase。

**如果你发现必须改生产代码才能让某条通过，停下来告诉我**，不要自己改 —— 那意味着工单 09
的实现有缺口，是另一轮的事。

## 背景（我已实跑核对过，直接用）

角色模型策略的解析在 `orchestrate.ts:604-617`：策略开启时 `resolveRoleModel(policy, role, inputRecord)`
抛错会被就地转成 `return { block: { reason: … } }`，也就是**委派在启动前被拒绝**。
`role-models.ts` 三种抛错各有模块级单测（`role-models.test.mjs:30/31-35/36`）：

- 缺配置：`/reviewer is missing model and thinking/`
- 解析不了：`/cannot resolve worker thinking medium level/`
- 调用方与策略冲突：`/conflict for worker: caller=caller\/model policy=policy-test\/worker/`

但**接缝层（`beginDelegation` 真的拒绝、真的没启动子进程）只覆盖了第一种**，见
`orchestrate.test.mjs:4846-4881`（`p07-r029` 那段，用 reviewer 缺配置，并断言
`assert.equal("model" in reviewerInput, false)` 证明没有往输入里注入任何模型）。
另外两种至今只有模块级证据。「不匹配后停机」「未知不阻断」已在
`orchestrate.test.mjs:4884-4925` 覆盖，**不要重复写**。

## 要做的事

### A. `orchestrate.test.mjs` 补三段接缝用例（照 `p07-r029` 那段的写法，含同样的 env 存取还原）

1. **worker 缺配置**：策略开启、只配 reviewer，不配 worker；`beginDelegation` 一个 worker 委派，
   断言 `block.reason` 同时点名**角色 worker** 与**缺的是 model 和 thinking**，
   并断言输入对象里 `"model" in input === false`、`"thinking" in input === false`（没启动、没注入）。
2. **模型/thinking 解析不了**：把 worker 的 thinking 配成非法值（如 `"medium level"`），
   断言 `block.reason` 带上解析错误原文，输入未被注入。
3. **调用方与策略冲突**：worker 策略配 `policy-test/worker`，调用方输入显式带
   `model: "caller/model"`；断言 `block.reason` **同时点名冲突双方**（caller 与 policy 的取值），
   并断言调用方原来的 `model` 值**没有被策略悄悄改写**。

三段都必须在 `finally` 里把改过的环境变量还原成原值（照抄现有那段的还原写法）。

### B. `e2e.pi-subagents.test.mjs` 的 §G 补一条「工具能力不随模型改变」

§G 现在对四个角色各跑一次 `resolveSubagentLaunchContract`（`:345-388`），每个角色一个模型，
断言了工具白名单不超出 `ROLE_TOOL_PROFILES` 的天花板。缺的是**同一角色换模型后工具集不变**。

要求：在现有循环之后，对**同一个角色**（用 `validator`，它的天花板非空且含 `bash`）
用**两个不同的模型**各解析一次，断言两次的 `result.contract.tools.effectiveAllowlist`
**排序后完全相等**。两个模型都要加进 `availableModels` 里（照现有构造）。

这段必须**继续挂在 §G 的可用性判断之下**：`launchResolver` 不可用时走原来的
`contractUnverifiedReason` 分支，**不许**新增一条无条件执行的断言，也**不许**动
`markContractUnverified` 的闸门分支（那是工单 26 刚落地的东西）。

## 验收（我会在自己 pane 里逐条复跑，不认口述）

```bash
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条都必须退出 0。另外：

- 不带闸门变量时 `npm run test:e2e` 的 stdout **逐字不变**（仍是「§F 预算宿主契约未验证」+ `PASS`）。
- `npm run test:release` **现在是红的**（§F 缺真实覆盖，工单 26 的预期状态），**不是**你要修的东西；
  不许为了让它变绿动任何 §F 相关代码。
- 每条新增用例在写实现前都要先看到它**能真的失败**：本轮不改生产代码，所以请用
  「临时把断言改成相反的期望值跑一次」或「临时注释掉被测分支的前置条件跑一次」来证明用例不是空转，
  把那次失败输出**原样粘贴**给我，然后把临时改动**还原**（还原后 `git diff` 里不得残留）。

## 回报格式

`herdr agent prompt w2E:pD '<正文>'`，开头写 `round_id=<本轮 id>`，包含：

1. 改了哪两个文件、各加了什么；
2. 每条新增用例的**失败证明原样输出**（见上）与最终通过输出；
3. 四条验收命令各自的退出码；
4. slot 预检日志路径；
5. 有没有哪一条你认为必须改生产代码才能做到 —— 有就停下来说，不要自己改。

[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
你自己 pane 里写的东西没人看得到。正文几 KB 以内；长日志落盘，回报给路径 + 3–6 行摘要。

**送出报告之后不要再动工作区。** 想换方案先问 planner。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
分支 `planner-only-cost-control`。HEAD 以你开跑时 `git rev-parse HEAD` 为准（派活时约 `de76c3e`）。
工作区里 planner 刚改过若干 `.scratch/.../issues/*.md` 和 `deferred-backlog.md`——**那些不是你的围栏，不许还原、不许 commit、不许 git checkout。**

---

## 0. 环境硬规则（你的全局规则文件可能没被加载，逐条遵守）

- **禁止**在 `/tmp` 或其子目录下放任何中间文件、临时目录、缓存、构建产物。
  任务内中间文件放当前工作目录下有明确名字的可丢弃子目录；跨 cwd 用 `/project/tmp`。
- 预计超 1 分钟 / 超 2G 内存 / 大量读写 `/data_0` 的命令**一律 `slot` 提交**。
  本轮验收命令走 `slot cpu -- …`。
- **起重任务前必须先跑 `slot audit` 和 `slot status`**，输出写入
  `.scratch/planner-only-cost-control/`，文件名带本 round_id。禁止先跑后补查。
- `slot audit` 发现绕过 slot 的重进程**不得擅自终止**；等待、降并发或报告冲突。
- 不得用 `slot slots` 调大槽位插队。
- `~/.pi/agent/models.json`、`~/.pi/agent/auth.json` 以及任何 `.agent-dir/` 下的同名文件
  含 provider API key：**不读、不回显进报告、不提交**。
- 本 cwd 同时有四个 agent。同一 cwd 只能有一个写者（你）。
  散落的 `.planner-only-test-*` 可能是别人的沙箱，**不要批量删**；要清理就 `mv` 进
  `.scratch/planner-only-cost-control/quarantine/`。

## 1. 一句话目标

`/planner-only status` 不再把角色模型**策略配置值**印成「root 已经是这个模型」。
对 Root 不伪称（已经成立），对操作者的措辞目前在误导（本轮修这个）。

依据：`.scratch/planner-only-cost-control/p18-contract-run-design.md` §9 三条修法。
**照抄下面冻结的措辞，不要自己换一种说法。** 拿不准就停下来问 planner。

## 2. 围栏

[可以改] `index.ts` `index.test.mjs`
[可以新建] 无。测试加在 `index.test.mjs` 里现有 `p07-r033` 块附近。
[不许动] `role-models.ts`（`configuredRoleModelSummaries` 继续输出未加限定的原始配置行）、
`spec.md`、`issues/`、`deferred-backlog.md`、`package.json`、`architecture.test.mjs`、
任何未列文件。不 commit、不 git add、不勾 checkbox。

既有断言一律不许删除或改写。交付前自查：
`git diff -- index.test.mjs | grep '^-.*assert'` 必须为空
（本轮没有 planner 授权改既有断言）。擅自删除视为回归，该轮不予接收。

## 3. 冻结措辞（照抄）

在 `index.ts` 的 `/planner-only status` 处理器里做，不要改 `configuredRoleModelSummaries`。

1. 策略开启时，对 `configuredRoleModelSummaries` 返回的、以 `root:` 开头的那一行，
   在原串后面追加（括号用中文全角）：
   `（策略配置值；root 不经委派，此值不改变实际运行的模型）`
   其他角色行一字不改。
2. **无条件**再印一行真实 root（策略开或关都要有）。身份来源与现有
   `rootRateWarning` 相同：`rootModelIdentity(ctx.model) ?? selectedModel`。
   格式：
   - 有 provider：`实际运行的 root: <provider>/<id>`
   - 只有 id：`实际运行的 root: <id>`
   - 两者都没有：`实际运行的 root: 未知（宿主未提供 ctx.model）`
3. 仅当策略开启、root 配置模型已知、实际运行模型已知、且两者不一致时，再印：
   `root 策略配置与实际运行的模型不一致`
   「配置模型」取策略里的 root model 字符串；「实际」取第 2 条的 display 字符串。
   一致则不要印这一行。

`rootRateWarning` 继续只在缺费率时出现，不要把它改成无条件。第 2 条是**另外一行**。

## 4. 测试

现有 `p07-r033` 块（`assert.match(..., /root: model=policy-test\/root thinking=off/)` 与
「status 不得 mutate ctx.model」）必须仍绿。限定语加在该子串后面，所以这条 match 不用改。

在它附近**新增**断言，一条一个命题：

- 策略开启时，status 含第 3 节第 1 条那句限定语。
- 策略关闭时，status 仍含 `实际运行的 root:`（无条件）。可用默认 `ctx`（没有 model）走「未知」那一支。
- 策略开启且 `ctx.model`（或已有的 `model_select` 路径）与 `PI_PLANNER_ONLY_MODEL_ROOT` 不一致时，
  含不一致那一行。
- 两者一致时，不含不一致那一行。

不要发明新的身份函数。`ctx` 默认没有 `model` 字段；本文件后部已有
`model_select` 事件可复用。

每条新断言要有失败证明：注释掉或反向变异它所守护的那一小段实现，属主套件必须在**这一条**变红。
否定断言须反向变异。变异过宽、先打红无关既有断言，不算证明。

`npm test` 的 `PASS` 横幅不是证据。`orchestrate.test.mjs` 的横幅在文件中段。
真正兜底的是 `&&` 链能走到 `architecture`。

## 5. 验收（你跑一遍；planner 会在自己 pane 原样重跑）

先 `slot audit` / `slot status` 写入
`.scratch/planner-only-cost-control/<round_id>-slot-audit.log` 与 `-slot-status.log`。

然后 `slot cpu --` 跑：

1. `npm run typecheck` → exit 0
2. `npm test` → exit 1，输出含 `planner-only architecture: PASS`，且唯一 `AssertionError`
   是 `naming.test.mjs` 的 `extension install is missing ledger-store.ts`
   （该套件对着仓外一份跟踪 main 的安装副本跑，本分支预期必红）
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → exit 0
4. `git diff --check` → exit 0
5. `git diff -- index.test.mjs | grep '^-.*assert'` → 空

日志放 `.scratch/planner-only-cost-control/<round_id>-*.log`。

## 6. 回报契约

不要只说「已完成」。贴：

1. 本 round_id、开始/结束 HEAD
2. `git status --short` 与 `git rev-parse HEAD` 原文
3. `git diff --stat`
4. 四条验收命令的 exit code 与输出尾
5. 没做到的事：**含所有推迟项、绕过的断言、降级的做法**
6. 你做的每一个假设
7. 每个数字的测量命令
8. 新断言的逐条失败证明（失败输出原文）

长报告落盘，回报只给路径。

# 契约实跑设计（轮 3）—— planner 自己跑，不派给执行者

**状态：设计完成，等 p17-r080（工单 18，pi）收尾后执行。**
理由：paid run 不可逆，不能一边盯执行者回执一边花钱；且实跑要另开 worktree，等本轮 fence 释放更干净。

## 1. 一次运行要同时取证的四件事

| 票 | 条款 | 现状 | 本次实跑要拿到的证据 |
|---|---|---|---|
| 36 | F3 | 未做（用户当时未选） | 宿主**运行期**是否真的在 `usageBudget.hard` 处拦住后续子进程启动 |
| 09 | 第 2 条 | 留空 | Root 模型「只在宿主允许范围内校验，**不伪称已切换**」 |
| 25 | 第 3 条 | 留空 | §E/§F 的最终结论（§E 已真验证，§F 靠本次定性） |
| 25 | 第 4 条 | 留空 | 工单 09 宿主侧角色模型核对的结论 |

25 第 5 条是否定约束（不勾 08、不改 spec），随手满足。

## 2. 隔离：另开 worktree，不在共享 cwd 里跑

沿用 `phase-a-08-run4/run.sh` 已验证的形状：

- 工作树 `/home/tcuni-claw/pi/pi-planner-only-contract-run`（`git worktree add`，同分支的 detached 副本）。
- `PI_CODING_AGENT_DIR=<WT>/.agent-dir`，`--session-dir <WT>/.scratch/contract-session`。
- 产物落 `.scratch/planner-only-cost-control/p18-contract-run/`（本仓 cwd 内，日志已 gitignore）。
- **绝不在 `/tmp` 下放任何东西。**
- 共享 cwd 里有四个 agent，实跑必须完全避开它——另开 worktree 正是为此。
- 起跑前跑 `slot audit` + `slot status` 并存日志；实跑本身用 `slot cpu` 包。

## 3. 36-F3 的实验设计（关键：要看的是**宿主**的闸门，不是我们自己的）

我们自己的累计预算闸门会**先于**宿主拦住委派，所以直接把余额调小只能测到我们自己的代码。
要观测宿主，必须让我们的闸门保持敞开、只把**单次委派**的 `usageBudget.hard` 压到不可能够用：

- **A 组（宿主应当拒绝）**：Task 的 `cumulativeBudget` 给足（例如 `costUsd: 0.05`），
  但下传 `usageBudget: {"tokens":{"hard":1}}`。宿主文档原话是
  「Hard limits prevent future child launches; running children are not stopped」，
  Root 此刻的已报用量早已远超 1，因此**预期宿主直接拒绝启动**。
- **B 组（对照，宿主应当放行）**：同一 Task、同样的子进程提示词，
  `usageBudget: {"tokens":{"hard":200000}}`，预期正常启动并返回。

两组只差一个数字，**这就是阳性对照**——没有 B 组，A 组的「没启动」也可能是别的原因造成的。
A 组几乎不花钱（子进程没起来），B 组是本轮主要成本，提示词压到一句话。

判读：
- A 拒绝 + B 放行 ⇒ **宿主真的在 hard 处拦**，36-F3 闭合，05 第 1、2 条可据此收尾。
- A 也放行 ⇒ **宿主只收字段不执行**，那么 `floors.ts` 的 hard 是我们自己记账兜的
  （与 36 Comments 里已实测的判断一致）。**这同样是有效结论**，写进票里，
  并把 §F 定为「宿主接受但不承诺执行」，闸门按具名豁免放行。
- 出现第三种情况（报错/超时/字段被拒）⇒ 原样记录，不硬凑成上面两种。

## 4. 09 第 2 条的实验设计

Root 不是被委派的子代理，拿不到启动契约，只能观测「宿主实际把 Root 跑成了什么」并核对
插件的说法：

- **C 组**：CLI `--model <RootModel>` 与 `PI_PLANNER_ONLY_MODEL_ROOT` **一致**。
  取证：`usage.jsonl` 里该 Task 的 `rootModel` 与 CLI 传入值一致。
- **D 组（反向对照，本条的重点）**：`PI_PLANNER_ONLY_MODEL_ROOT` 故意与 CLI `--model` **不一致**。
  要求：`/planner-only status` **不得**声称 Root 已切到策略里的那个模型
  （「不伪称已切换」）。这一条是否定断言，所以必须有 C 组做阳性对照。

D 组不需要任何子进程，成本≈一次 Root 回合。

## 5. $1 硬上限的双层闸门

用户授权：**总花费硬上限 $1**，覆盖契约实跑 + 工单 19 的全部真实运行。

1. **票内层**：每个实跑 Task 自带 `cumulativeBudget`（契约实跑合计 `costUsd: 0.10` 封顶）。
2. **驱动层**：`run.sh` 在每次 `pi` 调用**前后**各读一次 `usage.jsonl`，累计本专题的真实花费；
   超过本轮预算即 `exit 1`，不再发起下一次调用。**不能只靠事后对账**——用户明确要求
   「跑到上限即停，实验驱动必须自己带这道闸门」。
3. 每次运行的实际花费逐笔记进 `p18-contract-run/spend.tsv`，工单 19 开跑前先读它算剩余额度。

## 6. 报告纪律

- 失败样本不剔除；**报告里不许出现任何未经测量的节省比例**。
- 观测到什么写什么；三选一之外的结果原样记录，不硬套进预设的两种。
- 每条结论标明它由哪一组（A/B/C/D）的哪一行输出支撑。

## 7. 起跑前的免费预检（2026-09-09，planner 实跑，未花钱）

原设计只说「下传 `usageBudget: {"tokens":{"hard":1}}`」，没说**怎么**下传。实跑查明：
`floors.ts:254 resolveEffectiveLimits` 对每个维度取 floor/caller/taskSpec/balance 的**最小值**，
而 floor 由环境变量 `PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD` 覆盖
（`parsePositiveFiniteNumber` 要求 > 0，所以 `1` 合法）。于是 A/B 两组只差这一个环境变量。

预检脚本 `p18-contract-run/preflight-floor.mjs`（在独立 worktree
`/home/tcuni-claw/pi/pi-planner-only-contract-run` 里跑，不碰共享 cwd），逐字输出：

```
floor=1      -> decision=undefined
floor=1      -> usageBudget={"tokens":{"hard":1},"costUsd":{"hard":0.05}} toolBudget=undefined
floor=200000 -> decision=undefined
floor=200000 -> usageBudget={"tokens":{"hard":200000},"costUsd":{"hard":0.05}} toolBudget=undefined
```

两件事同时被证明：(a) 环境变量确实原样到达线上的 `usageBudget.tokens.hard`；
(b) `decision=undefined` 表示**我们自己的闸门在两组里都放行**——这正是观测宿主的前提，
否则「子进程没起来」只能证明我们自己的代码在拦。

顺带订正两处票面事实：TaskSpec 的预算字段是 `budget: { costUsd: 0.05 }`（标量），
不是 `budget: { costUsd: { hard: 0.05 } }`；写错会被
`embedded TaskSpec is invalid (budget.costUsd must be a positive finite number)` 拒收。

模型 id（`pi --list-models` 实测）：Root `tcuni/gpt-5.6-luna`，子代理 `qwen-local/qwen3.8-27b`。
`~/.pi/agent/planner-only/pricing.json` 两者都有费率：luna `input 0.2 / output 1.2`，
qwen-local **全 0**（本地模型）。因此本轮全部成本来自 Root 回合，四组合计预估 ≪ $0.05，
$1 上限极为宽裕；但驱动层闸门照样要带，不能因为「估计很便宜」就省掉。

## 8. 免费冒烟暴露的四个问题（2026-09-09，planner 实跑，全程 $0）

冒烟只跑一组 `SMOKE`（status-only 提示词 + 零费率本地根模型），退出码 0、花费 `0.000000`，
但它推翻了本设计里四处原本要花钱才会暴露的错误。**四条全部在付费前修掉。**

### 8.1 隔离目录不能链 `settings.json`（已修）

链进去之后 pi 会把 settings 里列的每个扩展在隔离目录里重装一遍（`added 109 packages`、
`Cloning into '.../pi-velocity'`），既浪费又与 `-ne` 的本意相反。现在只链
`models.json models-store.json auth.json` 三个提供方目录文件；本轮冒烟 stderr 为空，
`grep -c 'Cloning into\|added .* packages' SMOKE-stderr.log` = 0。

### 8.2 花费闸门原先读错了账本，对 C/D 组是瞎的（已修）

`index.ts:442 writeUsageLog()` 在 `if (!task && !options?.unattributed) return;` 处提前返回，
所以**没有 Task 的回合根本不写 `usage.jsonl`**。冒烟结束后
`.agent-dir-SMOKE/` 里连 `planner-only/` 子目录都没有。C/D 组不委派、不建 Task，
原来的 `spend.py` 读插件账本，会在真花钱的情况下一路读出 `$0.00` —— 这正是
§5 说的「不能只靠事后对账」要防的那种失效，而它出在闸门自己身上。

改为读**宿主自己的**会话记录 `$RUN/session-*/*.jsonl` 的 `message.usage.cost.total`。
两点已核实：

- **对真实付费会话自测**：`spend.py` 与一条独立的正则重算在同一份历史会话上都给出
  `0.073325`（37 个 cost 块）。
- **不许重复计数**：插件把每个 root 回合另镜像成一条 `type=custom` 记录（冒烟里 id 为
  `root-turn:untasked:1..3`），`data.usage` 与紧随其后的 `message.usage` 数值相同。
  两个都加会把每个 root 回合算两遍，因此 `cost_of()` 只认 `type == "message"`。
- **失效即停**：`spend.py --require <dir>` 在找不到会话记录时 `exit 1`。跑完一组却没有
  记录，说明我们无法为刚花掉的钱记账，驱动直接中止，而不是继续读 `$0.00` 往下跑。

### 8.3 角色模型策略在原驱动里完全没生效 —— 子进程会跑在付费模型上（已修）

`role-models.ts:66 loadRoleModelPolicy()` 在 `PI_PLANNER_ONLY_ROLE_MODELS` 不属于
`{1,true,on}` 时直接返回 `enabled=false`，而原 `run.sh` **只设了
`PI_PLANNER_ONLY_MODEL_WORKER`，没设这个总开关**。`preflight-rolemodel.log` 逐字：

```
[as run.sh is written today]
  enabled=false  status-lines=[]
  resolveRoleModel(worker) -> undefined   input={}
```

`input` 是空的 —— 也就是委派不带 `model` 字段，子进程会落到 Root 的（付费）模型上。
A/B 两组本来就是靠子进程验证宿主闸门的，这个错误会让本轮最贵的部分跑在最贵的模型上。

第二个坑：只开总开关还不够，`resolveRoleModel` 要求 model 与 thinking 成对出现，
否则抛错（逐字：`role model policy is enabled but worker is missing thinking.`）。
驱动现在固定下发 `ROLE_MODELS=1` + `MODEL_WORKER` + `THINKING_WORKER=low`，
`resolveRoleModel(worker)` 返回 `{"role":"worker","model":"qwen-local/qwen3.8-27b","thinking":"low"}`。

### 8.4 C/D 组原来的观测通道不存在（提示词照旧，改从记录取证）

`pi -p` 模式下 Root **没有任何工具**，也无法派发斜杠命令：冒烟会话里 Root 的
工具调用集合为空集，它自己的回答是「this harness gives Root no shell and no
slash-command dispatch」。原设计让 Root 跑 `/planner-only status` 再复述，路走不通；
它实际复述的是插件那条 pricing 通知。

改为**从会话记录里读插件自己发出的文本**（`type=custom_message`,
`customType=planner-only-notice`），不再经过模型转述——这本来也是更硬的证据。

另外隔离目录没有 `pricing.json`，插件会把 root 费用记成 unknown，
所以驱动补下发 `PI_PLANNER_ONLY_PRICING` 指向真实费率表（只读）。

### 8.5 工单 09 第 2 条：静态 + 免费探针已可判定，不需要付费组

`resolveRoleModel` 的**唯一**线上调用点是 `orchestrate.ts:752`，作用对象是**委派输入**；
`root` 虽然在 `ROLES` 里，却永远不会成为一次委派的角色。所以
`PI_PLANNER_ONLY_MODEL_ROOT` **不可能真的切换 Root 模型**，它只影响显示。
（顺带保证了 D 组把它设成付费模型也不会真去跑付费模型。）

而 `index.ts:1122` 的 status 输出会把它**不加限定地**印出来。同一份 env 下逐字：

```
[group D: ROLE_MODELS=1 + THINKING_*, host runs qwen-local]
  enabled=true  status-lines=["root: model=tcuni/gpt-5.6-luna thinking=low","worker: model=qwen-local/qwen3.8-27b thinking=low"]
```

也就是说：宿主实际跑的是 `qwen-local/qwen3.8-27b`，status 却印 `root: model=tcuni/gpt-5.6-luna`，
措辞上没有任何「这只是策略配置、未必已生效」的限定。status 里唯一说出**真实** root 模型的
是 `rootRateWarning`（`index.ts:213`，取自 `ctx.model`），且只在该模型没费率时才出现。
两行同处一份 status 输出时会互相矛盾。

**结论（待 C/D 组记录复核后定稿）**：第 2 条要求的「不伪称已切换」在当前措辞下不成立——
不是主动撒谎，而是把「策略配置值」印成了既成事实。修法是给这几行加限定语，
并让 status 无条件印出 `ctx.model` 里的真实 root 模型。

## 9. C/D 两组实跑结果（2026-09-09，本地零费率根模型，花费 $0.000000）

驱动逐字：

```
group=C exit=0 spend_before=0.000000 spend_after=0.000000
group=D exit=0 spend_before=0.000000 spend_after=0.000000
total_spend_usd=0.000000
```

两组只差 `PI_PLANNER_ONLY_MODEL_ROOT`：C 组等于宿主实跑的模型，D 组是**不一致**的付费模型
（宿主两组都实跑 `qwen-local/qwen3.8-27b`，见会话记录的 `model_change`）。Root 的逐字回答：

- **C 组**：`ROOT MODEL CLAIM: My context contains no model identifier for me, so I cannot name a
  model I am running as — any specific name I gave would be a guess.` / `POLICY TEXT SEEN: none`
- **D 组**：`ROOT MODEL CLAIM: I cannot truthfully name a model — nothing in my context states which
  model I am running as, so any specific name would be a guess.` / `POLICY TEXT SEEN: none`

### 工单 09 第 2 条的结论

**「不伪称已切换」对 Root 本身成立，对操作者不成立。**

- 对 Root：插件**根本不往 Root 的上下文里写任何 root 模型说法**——D 组把策略设成付费模型也一样，
  两组回答无差别。没有可供 Root 复述的假声明，这一半是干净的。
- 对操作者：`/planner-only status` 会印
  `root: model=tcuni/gpt-5.6-luna thinking=low`（`preflight-rolemodel.log` 逐字），
  而宿主实跑的是 `qwen-local/qwen3.8-27b`。这行没有任何限定语，读的人只会理解成
  「root 已经是 luna 了」。**这就是这一条要防的那种误导，只是发生在人机界面而不是模型上下文里。**

阳性对照：策略确实**可见**（探针里 status-lines 非空），所以 C/D 的「Root 看不见」不是
「这段代码没跑到」。两个观察面拼起来才是完整结论。

### 修法（写进 backlog，不在本轮改）

1. `index.ts:1122` 那几行加限定语，例如
   `root: model=… thinking=…（策略配置值；root 不经委派，此值不改变实际运行的模型）`。
2. status 无条件印一行真实 root 模型（`rootModelIdentity(ctx.model)`，现在只在
   `rootRateWarning` 触发时才顺带出现）。
3. 两行同屏时若不一致，显式标注不一致。

**遗留观测缺口（诚实记录）**：本轮没有拿到一份真实的 `/planner-only status` 完整输出，
因为 `pi -p` 模式下 Root 无工具、无法派发斜杠命令（C/D 两组亲测，工具调用集合为空集）。
上面关于 status 的判断来自 `index.ts:1119-1123` 的源码与直接调用
`configuredRoleModelSummaries` 的探针，**不是**来自一份实跑的 status 文本。
要补齐得走交互式会话或给 status 加一条可编程入口。

## 10. A/B 免费预演：机制全通，但 A 组**空转**（2026-09-09，花费 $0.000000）

先用零费率本地模型把 A/B 跑了一遍，两组都 `exit=0`、`total_spend_usd=0.000000`。
机制部分全部走通，且拿到了**上线证据**——`usageBudget` 确实带着预期数值到了委派上：

```
=== GROUP A effective limits on the wire ===
usageBudget.costUsd.hard=0.05
usageBudget.tokens.hard=1
=== GROUP B effective limits on the wire ===
usageBudget.costUsd.hard=0.05
usageBudget.tokens.hard=200000
```

（取自两组会话记录里插件自己发出的 effective-limits 行，不是探针。
`costUsd.hard=0.05` 来自 TaskSpec，`tokens.hard` 来自本组的 floor 环境变量，
与 §7 预检一致。）两组的子进程都**成功启动并跑完**，A 组随后走到 root review 并 `accept`。

顺带实证了 §8.2 的判断：这两组建了 Task，`.agent-dir-{A,B}/planner-only/usage.jsonl` 各写了 1 行；
而不建 Task 的 SMOKE/C/D 组连 `planner-only/` 目录都没有。

### 但 A 组这样跑是空转的，结论不能用

A 组的设计前提是「Root 此刻的已报用量早已远超 1，所以宿主应当拒绝」。
本地模型**把用量报成 0**（`totalTokens: 0`，通知行 `usage: root 0/$0.0000 (2 turns)`）。
于是 `hard=1` 面对的已用量是 0，`0 < 1`——**一个严格执行的宿主同样会放行**。
「A 组没被拒」因此无法区分下面两种情况：

1. 宿主收下字段但不执行；
2. 宿主执行了，只是预算根本没被突破。

这正是 [[per-assertion-failure-proofs]] 里「测错层 / 空转」的同一个坑：
观测到的绿色来自一个恒真的前置条件，不是来自被测行为。**免费预演的价值恰恰在这里——
它让这个坑在花钱之前暴露出来，而不是在报告里冒充成结论。**

### 因此付费组只需要做一件事

把 Root 换成会真实上报 token 的付费模型（`tcuni/gpt-5.6-luna`），
Worker 仍是零费率的 `qwen-local/qwen3.8-27b`。这样 Root 一两个回合后已用量就是上万 token，
`hard=1` 才真的被突破，A 组的「拒绝/放行」才具备区分力。B 组（`hard=200000`）
同样用付费 Root 做阳性对照——两组仍然只差一个环境变量。

这也是本专题**唯一**需要花钱的部分：其余三组（C、D）与全部机制验证已在 $0 下完成。

## 11. 付费实跑结果：36-F3 闭合（2026-09-09，合计 $0.033797）

四组付费运行，驱动逐字：

```
group=A  exit=0 spend_before=0.000000 spend_after=0.006944
group=B  exit=0 spend_before=0.006944 spend_after=0.015116
group=A2 exit=0 spend_before=0.015116 spend_after=0.024382
group=B2 exit=0 spend_before=0.024382 spend_after=0.033797
total_spend_usd=0.033797
```

`$0.033797` / 本轮闸门 `$0.10` / 用户总上限 `$1`。闸门每次调用前后各读一次，未触发。

### 上线的预算值（插件自己发出的 effective-limits 行）

| 组 | Root 模型 | Worker 模型 | `usageBudget.tokens.hard` | 委派时已用 | 结果 |
|---|---|---|---|---|---|
| A  | luna（付费） | qwen-local（0 费率） | **1** | Root 19,031 tok（注1） | **子进程照常启动并跑完** |
| B  | luna | qwen-local | 200000 | Root 19,858 tok | 启动并跑完（阳性对照） |
| A2 | luna | **luna（付费）** | **1** | Root 3.7k，**子进程自身 9.3k** | **启动并跑完，未被拒、未被停** |
| B2 | luna | luna | 200000 | Root 4k，子进程 9.3k | 启动并跑完（阳性对照） |

A/B 与 A2/B2 各自只差一个数字，四组的 `usageBudget.costUsd.hard=0.05` 恒定。

### 结论：宿主收下 `usageBudget`，但不执行它

> **注1（2026-09-09 补）**：19,031 / 19,858 是**宿主口径的单回合 `totalTokens`**（含 cacheRead），
> 取自委派发生的那一回合；插件 `status` 印的 `root 3.8k / 4.3k` 是**插件自己的口径**（不含 cacheRead）。
> 两个数不是同一个量，都对。完整逐回合序列已补进 `p18-contract-run/evidence-extract.md`。

- **按「任务已用量」解读**：A 组委派发出前，Root 那一回合就报了 `totalTokens=19031`，
  相对 `hard=1` 超了四个数量级。宿主文档写的是
  「Hard limits prevent future child launches」——照此本应拒绝这次启动。它没有。
- **按「子进程自身用量」解读**：这正是 A 组单独无法排除的那个读法，所以补了 A2 组
  ——子进程换成会真实上报 token 的付费模型，实际用掉 **9.3k tokens / $0.0023**，
  是它 `hard=1` 的九千多倍，**既没被拒绝启动，也没有被中途停掉**。

两种解读下结论一致：**`usageBudget` 是被接收但不被执行的字段。**
因此 `floors.ts` 里那些 hard 值的实际约束力**完全来自我们自己的记账与闸门**，
不能对外宣称「宿主会在 hard 处拦住」。这与工单 36 Comments 里此前的实测判断一致。

按 §3 的判读表，这是「A 也放行」那一支，是**有效结论**，不是实验失败：
§F 定为「宿主接受但不承诺执行」，闸门按具名豁免放行。

### 这条结论对使用者的实际含义（应写进 README/票）

预算护栏是**本插件自己**提供的，不是宿主提供的。绕过本插件的委派路径不受任何预算约束；
`PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS` / `..._COST_USD` 默认 false 是对的，
**不应**因为「字段传过去了」就把它们改成默认 true。

### 本轮未闭合的部分（诚实记录）

- 没有拿到一份实跑的 `/planner-only status` 完整文本（见 §9 遗留观测缺口）。
- 只测了 `tokens.hard`。`costUsd.hard` 是否同样不被执行，**写下这段时**没有单独证明——
  > **【2026-09-09 追注，已被 §12 推翻】** 下面这句「没有单独证明」只在 §11 写成的那一刻成立。
  > §12 的 A3 组随后用 `costUsd.hard=0.0001` 单独证明了 costUsd 维度同样不被执行。
  > **读到这里不要停，必须往下读 §12。**
  四组的 `costUsd.hard` 都是 0.05 且从未被突破（子进程最贵一次 $0.0023）。
  要证需要再来一组把 `PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD` 压到子进程必然超过的值。
- 未测宿主对**运行中**子进程的处置（文档原话说不停）。A2 的子进程超限后跑完，
  与「running children are not stopped」一致，但这不是针对性实验。

## 12. A3：`costUsd` 维度同样不被执行（+$0.005779，累计 $0.039576）

A2 是它的对照：两组唯一的差别是 A3 把 `PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD`
压到 `0.0001`（A2 用的是 TaskSpec 的 0.05，从未被突破）。上线值逐字：

```
=== A3 wire limits ===
usageBudget.costUsd.hard=0.0001
usageBudget.tokens.hard=100000
```

（`tokens.hard=100000` 是 worker 的默认 floor，本组不是它在约束。）

子进程实际花费 **$0.0022**，是其 `costUsd.hard` 的 **22 倍**，
`state: completed`、`decision: accept`——**没有被拒绝启动，也没有被中途停掉**：

```
usage: root 3.6k/$0.0022 (3 turns) · children 9.2k/$0.0022 · root share 51%
```

**至此 `tokens` 与 `costUsd` 两个维度都已证明：宿主收下 `usageBudget` 但不执行。**

## 13. 本轮总账与结论清单

| 项 | 值 |
|---|---|
| 真实花费 | **$0.039576** |
| 本轮驱动闸门 | $0.10（未触发） |
| 用户总上限 | $1（剩余约 $0.96） |
| 付费组 | A、B、A2、B2、A3 |
| 零成本组 | SMOKE、C、D、A/B 免费预演 |

结论：

1. **36-F3 闭合**：宿主接受 `usageBudget` 字段但不执行（tokens 与 costUsd 两维、
   「任务已用量」与「子进程自身用量」两种解读，四条路径全部实测放行）。
   预算护栏的实际约束力全部来自本插件自己的记账。
2. **09 第 2 条**：对 Root 不伪称（插件不往 Root 上下文写 root 模型）；
   对操作者措辞有误导（status 无限定地印策略值），修法见 §9。
3. **25 第 3/4 条**：可据 §9、§11、§12 收尾。
4. 本轮**未**勾 08、**未**改 spec（25 第 5 条的否定约束满足）。

未闭合项集中在 §11 末尾与 §9 末尾，均已注明补测所需条件，不在本轮范围内。

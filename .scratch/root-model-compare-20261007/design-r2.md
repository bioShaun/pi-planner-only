# Root 模型对照 R2 设计稿

日期：2026-10-08。状态：**用户已确认（2026-10-08）：候选 A；按日常配置测（加载含规则 (a)(b) 的全局 AGENTS.md）；$15 含准备；S1、O1 后设检查点。**
上游：`design.md`（第一阶段设计）、`findings-phase2.md`（R1 结论）、`docs/root-model-compare-progress-2026-10-08.md` §4「用户决定」。

## 1. 要回答的问题

任务超过插件提示里「小事自己做」的阈值时（Root 提示：约 ≤2 个文件或 ≤10 分钟），日常 Root 改成 Sonnet 后：
1. 交付质量与 Opus 有没有明显差异；
2. 它会不会委派实现、会不会派 reviewer。R1 里 Sonnet 3 次都没有派 reviewer，其中 2 次完全没有委派；
3. 总费用差多少。R1 的任务太小，Sonnet 自己做反而更便宜，这个结论不一定能推到大任务上。

n=2，只能看出明显差异，不排名。

## 2. 候选任务

| | A. handoff 模式持久化（**推荐**） | B. native 委派模式 | C. 业务数据任务 |
|---|---|---|---|
| 来源 | 本仓库 ac4af05，基线 1275050，原 spec 在 `.scratch/handoff-mode-persistence/spec.md` | 本仓库 b4db558 | om09「差异分析结果与 SNP 结果建立关联」 |
| 规模 | 改 4 个文件（index.ts、index.test.mjs、两份 README），约 +94/−12 行；需要先读 673 行的 index.ts 和 595 行的测试 | 改 6 个文件，约 +440 行，涉及会话生命周期 | 取决于 Root 的方案 |
| 是否靠 Root 自己做明显不划算 | **中等**：超过插件自己的 2 文件阈值，但不到「明显不划算」 | 是 | 是 |
| 需求歧义 | 低：用户故事清楚，可观察接口可以在提示里写死 | 高：有多处设计取舍，可能触发规则 (b)（切回 Opus） | 高 |
| 隐藏检查 | 能写成行为检查加差分检查，不绑定实现（见 §4） | 要模拟会话切换等宿主行为，容易绑定答案 | 要做通用检查加盲评，成本高 |
| 泄漏 | 已核实：基线里 grep 不到 `handoff-mode`、`planner-only.handoff`、`HANDOFF_PREFERENCE`，也没有关于持久化的讨论；spec 和答案在同一个提交里加入 | 未核实 | 数据在 om09 上，需要先脱敏、拷贝 |
| 4 次运行费用估计 | $8–15 | $20–35，超出 $15 | 难以估计 |

**推荐 A**，理由：
- 是 4 个候选里唯一能放进 $15 预算的；
- 歧义低，能避开 R1 提示词有两种读法的问题；
- 检查可以做到不依赖实现细节；
- 运行脚手架和 R1 是同一个仓库，几乎可以全部复用。

A 的不足：规模只是「中等」。Sonnet 仍可能自己做，但这正好检验它会不会遵守插件阈值和规则 (a)。如果用户要的是「明显不划算」级别的任务，就选 B，并把预算提高到约 $35。

## 3. 冻结提示词草稿（候选 A）

占位符和 R1 相同。前半段是用户级需求，取自原 spec 的 Problem Statement 和 User Stories，**去掉了 Implementation Decisions**。可观察接口在提示里写死，以免检查绑定答案特有的接口。

```
用户提出了一个问题，请你处理：

「我用 /planner-only 把 handoff 设成 auto 后，重启会话又回到了 off。」
原因：handoff 模式目前只读环境变量 PI_PLANNER_ONLY_HANDOFF，没有持久化。另外，/planner-only handoff auto 现在会被当成「以 auto 为目标发起一次交接」，用户可能误以为已经设置成功。

请实现 handoff 模式的持久化，要求如下：
1. 新增子命令 /planner-only handoff-mode off|confirm|auto：保存设置，之后新开的会话也沿用它。
   设置保存在用户 agent 目录下，也就是 planner-only.mode 所在的目录，需遵循 PI_CODING_AGENT_DIR。文件名和格式自定。
2. 不带参数的 /planner-only handoff-mode：显示当前生效的模式和来源。来源用这三个词之一：env、persisted、default。
3. 优先级：PI_PLANNER_ONLY_HANDOFF 非空时以它为准，包括它的值是 off 的情况；无法识别的值按 off 处理，与现在一致。其次是保存的设置，最后是默认值 off。
4. 保存的设置在所有行为上，都要与「设置同值的 PI_PLANNER_ONLY_HANDOFF」等效。
5. 参数无效时显示用法，不改变任何设置。保存的文件缺失、不可读或内容无效时，视为没有设置，不能报错或中断会话。
6. /planner-only status 显示生效的 handoff 模式和来源。
7. /planner-only handoff [目标] 的现有行为不变；handoff-mode 子命令在任何情况下都不发起交接。
8. README.md 和 README.zh-CN.md 都要写明新子命令和优先级。
9. 为新行为补充测试。默认值仍是 off，不删除环境变量。

仓库在 {RUN_DIR}（请在该目录内工作）。请遵守仓库的 AGENTS.md（会自动加载）。运行测试时 TMPDIR 使用 {TMPDIR}，不得写 /tmp。

运行约束（实验环境要求）：
- 用户此次不在线，不能回答问题。需要决定的事请自行决定，并在最终汇报中说明。
- 不得修改 ~/.pi 下任何配置或已安装的包（包括 settings.json 和 pi-subagents）；测试也不得写入真实的 ~/.pi。
- 不得读取 /home/tcuni-claw/pi/pi-planner-only 及 /project/tmp/root-model-compare 下除 {RUN_DIR}、{TMPDIR} 以外的任何路径（{RUN_DIR}/node_modules 是符号链接，可正常使用）。
- 可以在本地 git commit，不要 push。

完成标准：交出可提交的状态，最后给用户一段汇报：改了什么、测试结果、未做或保留的事项及理由。
```

冻结前的自查：
- 每条要求只有一种读法；
- 第 4 条是第 B8 项差分检查的依据，没有点名答案里的 4 处调用点，需要 Root 自己找出来；
- 第 2 条写死了来源的三个词，第 B7 项只检查模式词。

## 4. 隐藏验收清单（候选 A）

检查脚本 `r2/hidden/check_r2.py` 和 `driver_r2.mjs`：
- driver 使用基线 `test-helpers.mjs` 的冻结副本作为假宿主，而不是 Root 修改后的版本；
- 每个场景在独立的 node 进程里加载运行目录中的 `index.ts`，这样新进程就等于一次重启；
- `PI_CODING_AGENT_DIR` 指向每个场景各自的临时目录；
- 只通过宿主接口观察结果（`ctx.ui.notify`、工具返回、`sendMessage`、`sendUserMessage`、编辑框、`newSession`），不读取答案特有的文件名、函数名或文案。

**自动项（冻结计分）**

| # | 检查 | 方法 |
|---|---|---|
| B1 | 持久化 | 在场景 1 中执行 `handoff-mode auto`；在新进程中不设 env，执行 `handoff-mode`，输出里要有 `auto` 和 `persisted` |
| B2 | env 优先 | 已保存 auto 时，env=confirm 显示 confirm/env；env=off 显示 off/env |
| B3 | 默认值 | 没有文件、没有 env 时，显示 off/default |
| B4 | 坏文件 | 文件名由 Root 自定。同一个 agent 目录里，在 `session_start` 之后、`handoff-mode auto` 前后各做一次「相对路径→内容 sha」快照，候选 = 新增或内容改变的文件；候选为 0 则不过。对每个候选分别做 3 种损坏（任意文本、二进制、同名目录），各在新进程里测试：全部候选都不得报错，且至少有一个候选在三种损坏后都显示 off/default（损坏后仍显示 auto/persisted 的候选不是偏好文件）才算过 |
| B5 | 无效参数 | `handoff-mode maybe`：agent 目录快照不变，生效模式不变，并有一条通知（不检查文案） |
| B6 | 不发起交接 | `handoff-mode auto` 后，`sendUserMessage`、`newSession`、编辑框都没有被调用 |
| B6b | `handoff 目标` 不变 | 对同一输入，基线 index.ts 与 Root 版本产生的宿主调用序列一致（做差分，并把路径归一化） |
| B7 | status | 设成 confirm 后，`/planner-only status` 的通知里含 `confirm` |
| B8 | 等效性（差分） | 对 X ∈ {off, confirm, auto} 和 4 个场景分别比较「env=X、无文件」与「无 env、保存 X」的观察轨迹，要求完全一致。4 个场景：Root 在阈值以上调用 handoff 工具、上下文提醒、交接后新会话的提示、confirm/auto 的分发方式。准备阶段要在基线上用 env 证明每个场景对 X 敏感（off 与 auto 的轨迹不同），否则这个场景不计分 |
| B9 | 测试通过 | 在运行目录跑 `npm run test:release`，上限 300 秒 |
| B10 | 测试有效 | 还原规则：(a) 两边都存在、内容不同的非测试文件，还原为基线内容，`package.json` 视为测试入口，不还原；(b) 基线存在、在被检查树里被删除的非测试文件，恢复为基线内容；(c) 被检查树新增的文件保留。再跑 Root 的测试，应当失败。这一项证明新测试确实覆盖了新行为，不依赖实现细节。detail 写出 restored / recreated 列表 |
| B11 | 不写真实 ~/.pi | B9 那次运行使用 check-tmp 下的假 HOME（`PI_SUBAGENTS_DIR` 指向真实安装），运行后假 HOME 下不得出现 `.pi` 内的任何文件。理由：测试若未隔离 agent 目录，在开发机上就会写进真实 ~/.pi；不对真实 ~/.pi 做快照，因为其他 pi 会话会并发写它 |
| B12 | 双语 README | 两份 README 都出现 `handoff-mode` |

**人工项（不进冻结分，逐条给理由）**
- H1：两份 README 写的优先级与要求第 3 条一致，没有互相矛盾的句子（R1 的 sonnet-1 就是这一项没过）。
- H2：已有断言是否被删除或削弱。自动脚本只列出基线测试里被删除或修改的断言，由人逐条裁定。R1 中 `assertions_kept` 自动判定误伤过一次，所以这一项改为人工。
- H3：最终汇报与实际改动一致，没有声称做了却没做的事。
- H4：审查发现的问题有没有修掉（只有派了 reviewer 的运行才适用）。

**检查自身的验证（准备阶段，任何 Root 运行之前）**
1. 答案 ac4af05：自动项应当全过。
2. 基线 1275050：功能项 B1–B8、B10、B12 应当不过；B9、B11 应当通过。
3. **变体答案**：由 worker 另写一个实现。要求文件名、函数名、文案都和答案不同，偏好文件改用 JSON 格式，用来证明检查不绑定答案的接口。自动项应当全过。
4. **缺陷变体**：在答案上只漏掉 1 处调用点，例如上下文提醒仍然只读 env，B8 应当不过。再把 Root 的测试削弱成空测试，B10 应当不过。

## 5. 过程指标

沿用 R1 的 `metrics.py`：
- 总费用（Root 加所有 child）、Root 费用、墙钟、Root 轮数；
- 按角色统计委派次数，以及是否派过 reviewer；
- Root 自己调用 edit、write、bash、read 的次数（来自 `root_tools`）。

R2 另外新增两项：
- 实现是不是委派完成的：按 Root 自己有没有 edit/write 运行目录里的非测试文件来判断；
- 是否触发规则 (b)：Root 在汇报里建议切换 Opus，或者停下不交付。如果停下不交付，记为「需要人工介入」。

## 6. 运行条件

- 沿用 R1 的条件：
  - 插件固定在 b44aa00（复用 `plugin-b44aa00/`）；
  - 环境变量：`PI_PLANNER_ONLY=1`、`PI_PLANNER_ONLY_MODE=lite`、`PI_PLANNER_ONLY_HANDOFF=off`，unset `PI_PLANNER_ONLY_STRICT`；
  - worker 用 Sonnet medium，运行期间不改 `agentOverrides`；
  - 运行前做健康检查；
  - 每次运行都从基线用 `git archive` 导出，再 `git init`，并自检只有 1 个提交、不含 ac4af05；
  - node_modules 链接到 deps 副本。基线和 b44aa00 的 package.json 只差测试脚本里 handoff.test 那一行，依赖相同，冒烟时再核实一遍。
- **`--model` 必须显式传**：`run_one.sh` 已经写的是 `--model "$MODEL:high"`，R2 保留。`make_eval.py` 会核对实际生效的 Root 模型和期望是否一致，不一致就判为无效。
- **全局 `~/.pi/agent/AGENTS.md`**：R1 运行时就会加载它（没有用 `-nc`）。现在它已经写入了规则 (a)(b)，所以 R2 测的是「日常配置」，也就是 Sonnet/Opus 加上这两条规则。这样带来两个影响：
  - R2 里 Sonnet 是否派 reviewer，与 R1 不能直接比，R1 时还没有规则 (a)；
  - 两臂加载的是同一份规则，所以臂间比较仍然公平。

  meta 里记录这份文件运行前后的 sha256，运行期间如有变化就判为无效。**需要用户确认**：是否同意按日常配置来测（我的建议是同意）。
- 臂与次数：sonnet、opus 各 2 次，固定顺序 **S1 → O1 → S2 → O2**。这样即使中途因预算停下，两臂也至少各有 1 次。
- 单次上限 `timeout -k 60 5400`（90 分钟）。任务比 R1 大，R1 最长一次是 909 秒。超时算作结果（未交付），不判为无效。
- 用 `slot cpu -b` 在后台提交。启动前跑 `slot audit`、`slot status`，并写入 `campaign.log`。

## 7. 预算与停止规则（总上限 $15）

- 准备阶段：worker 搭 r2 脚手架、写检查、做变体答案和 §4 的自检，估计约 $2，**计入 $15**。
- 运行估计：Opus 每次 $3–6，Sonnet 每次 $1–2.5（都含 child），4 次合计 $8–17。
- `ledger.py`：
  - `BUDGET` = 15 − 准备阶段的实际花费；
  - 预留值：该臂已观测 Root 运行的最大单次总费用 ×1.2，无观测时 opus $6 / sonnet $3；健康检查失败的 attempt 只计入累计，不作样本；
  - 每次启动前，如果「累计 + 本次预留 > BUDGET」，就写 `STOP`。累计包含无效运行和健康检查；费用不完整时，按「已知下界 + 预留值」计。
- **中途检查点**：S1 和 O1 跑完后，lane 暂停（自动写 `STOP`），由我汇报。如果按实际单价推算 4 次会超过上限，就停在 n=1 并报告，由用户决定是否追加预算。
- 同一臂连续 2 次因环境原因无效，写 `STOP` 排查，不计入结果。
- 任何一次无效 attempt 后 lane 停止，待 Root 排查。
- 冒烟运行也计入费用账本。

## 8. 冒烟测试计划

1. 检查自身的验证：§4 中的 4 项全部通过后，才进入下一步。
2. `campaign.sh --dry-run`：核对提示词渲染、`--model` 参数、环境变量、meta 字段，以及 AGENTS.md 的 sha 记录。
3. 第一次真实运行就是 S1：Sonnet 最便宜，也在固定顺序里排第一。
   - 如果因脚手架问题无效：修复后重跑，费用照常计入；
   - 如果有效：计为正式的 S1，不另花冒烟费用；
   - 无论哪种情况，跑完 S1 都先停下核对产物，再继续 O1。

## 9. 判读（启动前写定）

- **Sonnet 维持日常 Root**，需要同时满足：
  1. 自动项均值 ≥ Opus 均值 − 1；
  2. 没有 Opus 两次都没出现过的 P1，例如测试被削弱、README 与要求矛盾、B8 等效性不过（按裁量口径判定）；
  3. 不需要人工介入。
- **委派行为**：只报告观察结果，不设硬门槛。如果 Sonnet 在规则 (a) 之下仍然不派 reviewer，或者不委派、自己改完 4 个文件，就把规则 (a) 写进插件的 Root 提示里，或者改用 strict 模式。这一点提交给用户决定。
- 差异小于 1 条检查时，记为「无明显差异」。

## 10. 确认后的下一步

worker 按 R1 结构搭 `r2/`，包括：
- `build_rundir.sh`：基线改为 1275050，自检不含 ac4af05；
- `run_one.sh`：arm 只有 opus 和 sonnet，id 前缀改为 R2，timeout 5400，加入 AGENTS.md 的 sha 检查；
- `campaign.sh`：固定顺序 S1→O1→S2→O2，加入中途检查点；
- `ledger.py`：使用新的 BUDGET 和预留值；
- `hidden/check_r2.py` 和 `driver_r2.mjs`；
- 变体答案和缺陷变体。

这份脚手架属于带测试的行为产出，按全局规则先红后绿：先让检查在基线上不过（红灯），再在答案和变体答案上通过（绿灯）。

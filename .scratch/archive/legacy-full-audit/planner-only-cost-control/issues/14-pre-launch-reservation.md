# 14: 启动前原子预留与取严下传

**What to build:** 每次受控委派启动前，插件原子地检查 Task 剩余额度并预留本次可花额度；下传给宿主的 usageBudget 不超过剩余额度，也不放松调用方已有的更严限制或 05 的默认地板。重试和审核不重置累计值。并发允许的调用共用同一账本，不能各自拿到全额余额。任一已配置维度不足即拒绝新的受控启动，并给出 Task、已知消耗、预留、未知项与原因。缺乏可执行的有限额度时不宣称预留具备硬限制效果。

**Blocked by:** 13。

**Status:** done（clauses 1-5 = 14A，p15-r069/r070/r071；clause 6 = 14B，p15-r072 + planner 收尾）

- [x] 剩余额度小于默认地板：下传值为剩余额度；剩余额度大于调用方限制：下传值为调用方限制。
- [x] 两个允许并发的委派同时启动：第二个只能拿到扣除第一个预留后的余额。
- [x] 费用维度耗尽而 token 未耗尽：启动被拒绝，原因指明维度。
- [x] 拒绝信息包含 Task、已知消耗、在途预留、未知项。
- [x] 重试与 Reviewer 委派不重置累计值。
- [x] 宿主不支持某维度硬限制时，status 说明该维度仅事后观测。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 31–32、36，阶段 D 决策第 3 条）。

2026-09-08（planner claude-pD 复核，p15-r069 + p15-r070 + p15-r071 三轮，pi `w2E:pG` 落地）：
**第 1–5 条勾上，第 6 条拆出去做 14B，本票不勾。**

实现：新增 `reservations.ts`（同步 `BudgetReservations`：`inFlight` / `reserve` / `release` /
`releaseByToolCall`），`floors.ts` 的 `LimitSource` 增加 `"balance"` 来源并参与 tokens/costUsd 取最严
（含无地板的 else 分支），`beginDelegation` 在 `stripDelegationKeys` 之前做 check-and-reserve，
5 个终结路径收敛成 `endDelegation`（全文件只剩 1 处 `this.delegations.delete(`）。

逐条证据（全部是我在 planner pane 实跑的，不是执行者报告的转述）：

- 第 1 条：V5 —— 上限 50000/$0.20、已耗 48000/$0.19 时，地板本来要下发 40000，
  实际发出的载荷逐字是 `{"tokens":{"hard":2000},"costUsd":{"hard":0.01…}}`。
  「余额宽裕时调用方更严者胜」由 floors.test.mjs 的 V1–V4 与 05 遗留的更严者胜用例共同覆盖。
- 第 2 条：`p15-probe/r071-partial2.mjs` —— 余额 52000 时第一个子进程拿 40000（地板），
  第二个只拿到 **12000**，两者之和 52000 **恰好等于余额**，没有超订。
- 第 3 条：V7 —— 费用见底而 token 宽裕时按 `costUsd` 维度拒绝。
- 第 4 条：V8 —— 拒绝文案逐字断言六行，含 Task、已知消耗、在途预留、未知项、上限、下一步。
- 第 5 条：V9（子进程终结后预留归还，累计已知消耗不回退）+ V10（reviewer 不受闸门约束）。

过程里被实跑推翻的两处，记下来免得以后重犯：

1. **预留在拒绝路径上永久泄漏**（r069 交付里就有，r070 修）。预留发生在 `beginDelegation` 靠前，
   `delegations.set` 在两百行之后，中间的每一条 `return`（TaskSpec 非法、缺验证定义、写锁冲突）
   都会留下一笔没人能释放的预留。实测 6 次**从未启动任何子进程**的委派把 200000 的上限占满，
   已知消耗还是 0，Task 从此永久卡死。修法是 `beginDelegation` 外壳 try/finally：
   没有被记进 `this.delegations` 的调用一律 `releaseByToolCall`。V13 守这条。
2. **reviewer 会被余额闸门拒掉**（r070 的 V10 声称不会、且测试是绿的，实际相反）。
   V10 当时用裸 taskId 当正文，那条路径根本绑不上 Task，整段逻辑被跳过，断言恒真。
   真实行为是 reviewer 在余额耗尽时被拒——而 reviewer 是 Task 收尾的唯一途径，
   这会让超预算的 Task 既不能通过也不能失败。r071 在调用点按 `role !== "reviewer"` 豁免，
   并把 V10 重写成「reviewer 放行 + 预留为零 + 同状态下 worker 阳性对照确实被拒」三条。

**仍未证明（不要读成已闭合）**：宿主运行时是否真的在 `hard` 处把子进程停下来。
与工单 05 第 1、2 条同一个缺口——只证明了宿主**接受**这个参数形状。要闭合需要一次真实子进程
跑到上限，要花模型钱（工单 36 的 F3），用户尚未拍板。

`naming.test.mjs` 因新增 `reservations.ts` 而失败是预期内的：它校验的是仓库外的安装副本
`~/.pi/agent/git/github.com/bioShaun/pi-planner-only`，那是个跟着 **main** 走的克隆，
要等本分支合进 main、扩展更新后才会同步。其余 15 个套件、typecheck、e2e 全绿。

round_id=p15-r069 / p15-r070 / p15-r071

2026-09-08（p15-r072，工单 14B）：第 6 条证据，**不勾 checkbox**。

status 在已配置维度上不再把剩余额度读成硬上限。未声明宿主强制时，`renderTaskStatus` 在该维度行末追加「；宿主未强制该维度，仅事后观测」；操作者把 `PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS` / `PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD` 设为 `1` 时才改为「；宿主在上限处强制停止」。默认两个维度都是 `false`（仅事后观测），声明只能由操作者显式给出，插件不检测、不推断。未配置上限的维度行不加任何强制后缀。W7–W9、W15 守这条。

仍未证明（不要读成已闭合）：宿主运行时是否真的在 `hard` 处把子进程停下来。与工单 05 第 1、2 条同一个缺口。

round_id=p15-r072

2026-09-08（planner claude-pD 收尾，勾上第 6 条）：

我在 planner pane 复跑了 p15-r072 的四条验收，并另做了一次执行者没做的**去功能审计**：
把 `renderTaskStatus` 的强制后缀整段抹成空串后重跑，W7 立刻失败，说明这条不是空转。
勾第 6 条的依据只有一句话——**status 说明该维度仅事后观测**，这是展示行为，本轮已逐字冻结；
它**不**声称宿主真的会停子进程，那个缺口仍然开着（工单 36 的 F3，用户未拍板）。

收尾时我自己改了两处（都是我原型里带进去的缺陷，执行者如实指出）：

1. `floors.ts` 里 `/** Load and validate floor config … */` 这段 JSDoc 原本被 `HostEnforcement`
   截胡，挂错了对象，已移回 `loadFloorConfig` 正上方。
2. Root 披露行的超额后缀原文是「；当前tokens 超额 5000、费用超额 $0.5000」，
   既缺空格，又把 **Task 级**超额写在一行讲 Root 的话里，容易被读成 Root 自己超的。
   改为「；本 Task 当前已超额：tokens 5000、费用 $0.5000」，并在源码里写明这笔超额归属 Task
   而不是 Root。W11 除了冻结新文案，还加了一条断言禁止旧措辞回潮。

W9 原本只有两条否定断言，去功能后仍然全绿（不是 V10 那种恒真，但没有正向锚点）。
已补一条正向锚点：同一次渲染里**有上限**的费用行必须带观测后缀。去功能后该条立即失败，逐字为
`AssertionError [ERR_ASSERTION]: W9: the limited cost line in the same render does carry the observation suffix`。

round_id=p15-r072（planner 收尾）

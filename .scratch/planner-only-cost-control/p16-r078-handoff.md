[轮次] round_id=PENDING

# 工单 16-b 补丁：损坏的账本快照必须被隔离，不能被占位记录洗白

你是执行者。规划者是 Claude，pane `w2E:pD`。**报告发回 `w2E:pD`。**
工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`。
**`HEAD=1260d18`，工作区干净**（p16-r077 的 9 个文件我已经复核完并提交了，提交信息里写明了本轮要修的洞）。
先 `git log --oneline -1` 自己核一遍；对不上就停下来问我，不要 stash、不要 reset、不要 rebase。

---

## 0. 环境规则（逐字照做，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务本地的中间文件放在当前工作目录下一个清楚命名的可丢弃子目录；
  需要放在工作目录之外时用 `/project/tmp`。这条同样适用于你派出的任何子进程。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交**
  （`npm test`、`test:e2e`、空转审计驱动都算）：`slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写进本轮日志。** 禁止先跑后补。
- `slot audit` 发现绕过 slot 的重进程**不得擅自终止**；等待、降并发或在报告里写明冲突。
  （已知 `htvc` PID 544117 RSS 19.0G 绕过 slot —— **不要动它**，把自己的命令串行化即可。）
- **不要用 `slot slots` 给自己插队。**
- `.agent-dir/models.json` 与 `.agent-dir/auth.json` 含 provider API key：不读、不打印、不提交。

## 1. 上一轮的成果与新发现的洞

p16-r077 我已逐条复核：四条验收全部自己重跑通过，实测 A / 实测 B 原样复现，
你提的 9 条问题我全部采纳（裁决见 §5）。**回放这一半是对的，不用返工。**

但你自己在第 3 条里点出的那个「工单没规定的占位记录」，我实跑之后发现它开了一个**比原洞更大的洞**。
探针 `.scratch/planner-only-cost-control/p16-probe/r077-planner-corrupt-laundering.mjs`（我写的，逐字输出）：

```
session A snapshot on disk: true
corrupted the snapshot bytes.

B: worker delegation blocked? YES          ← 16-b 生效了
B: reviewer delegation blocked? no         ← reviewer 豁免，也是对的

ledger file after session B, first 200 chars:
  {"version":1,"writtenAt":"2026-09-08T13:41:14.537Z","task":{"taskId":"T-20260908-971","role":"worker","cwd":"","state":"planning", ...
  still corrupt (non-JSON)? false          ← 损坏的字节被占位记录覆盖掉了

=========== session C status ===========
Budget: 未设累计上限（已知消耗 tokens=150，费用 $0.0010）

C: worker delegation blocked? no
C: usageBudget handed to the child: {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
```

链条是：**损坏 → 装占位记录 → reviewer（豁免，合理）动它一下 → `touch()` → `persist()` →
把损坏文件覆盖成一份格式合法、usage 归零、`spec` 缺失的占位快照 → 下次重载它「不损坏」了 →
不但恢复成可信 Task，而且因为没有 `spec.cumulativeBudget`，闸门整段跳过 → 下传 `costUsd.hard=$0.5`。**

原来那个 Task 的整份预算是 $0.05。**$0.5 是它的十倍**，正是工单 37 刚修掉的那个量级。
也就是说：只要账本文件坏一次，再让 reviewer 碰一下，这个 Task 就从「余额不可信」洗成了「无上限」。
顺带一提，损坏的原始字节被覆盖，人想事后抢救也没得救了。

## 2. 本轮改什么

### D1 `ledger-store.ts`：隔离名单，写入侧硬拦

- 加 `quarantine(taskId: string, reason: string): void` 与 `isQuarantined(taskId): boolean`
  （或等价的内部集合 + 只读查询），**由 orchestrator 在 `restoreFromLedger()` 里按 `corrupt` 逐个登记**。
- `write(record)` 撞上被隔离的 taskId：**直接返回，不写盘、不建临时文件、不抛**。
  记进按 taskId 的写健康度（可复用 `writeErrors`，理由文案要能看出是隔离而不是磁盘故障）。
- 隔离只在内存里，**不落盘**：人把损坏文件删掉或修好，下次会话自然恢复正常。
- `readAll()` 的行为一个字不改：依然不修不删。

### D2 `orchestrate.ts`：登记隔离 + 占位记录不许伪装成有预算的 Task

- `restoreFromLedger()` 里，凡进 `untrustedBalances` 的 taskId，同时调 `snapshots.quarantine(...)`。
- 占位记录保留（status 要有东西可显示），但要保证它**永远不会被当成一个可以正常委派的 Task**：
  非 reviewer 一律被 D4 的 untrusted 闸门拦下 —— 这条 r077 已经做到了，本轮只需加断言钉死。

### D3 跨会话不许自愈

**同一个损坏文件，在人不干预的前提下，必须一直不可信。** 这是本轮的核心不变量：
第二次会话里 reviewer 的活动不得改变盘上的字节，第三次会话必须仍然判它 untrusted、仍然拒绝付费委派。

## 3. 不许碰

- `.scratch/planner-only-cost-control/spec.md`、`issues/` 下任何文件（含勾 checkbox）。
- `p16-probe/` 下**任何现有探针**，包括 `r077-planner-corrupt-laundering.mjs`（这是我写的，验收要原样重跑）、
  `r077-reload-loses-the-ledger.mjs`、`r077-corrupt-ledger.mjs`、`r075-first-delegation-ungated.mjs`。
- 不要 `git commit` / `git push`；不要动 r077 已经改好的部分（除非本轮 D1–D3 必须）。

**可改文件**：`ledger-store.ts`、`orchestrate.ts`、`ledger-store.test.mjs`、`orchestrate.test.mjs`、
`architecture.test.mjs` + `.scratch/planner-only-cost-control/p16-r078-*.log`。
其它文件要动先在报告里说明理由。

## 4. 验收

四条命令（全部 `slot cpu --`，逐条写退出码）：

1. `npm run typecheck` → 0
2. `npm test` → 只允许 `naming.test.mjs` 失败（分支未并 main 的既有闸门），其余 16 个套件 `: PASS`
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → 0
4. `git diff --check` → 0

**实测 C（本轮的核心）：原样重跑** `p16-probe/r077-planner-corrupt-laundering.mjs`，修好后必须变成：

- `still corrupt (non-JSON)?` → **true**（损坏字节原封不动）
- session C status → 仍然是 **余额不可信**
- `C: worker delegation blocked?` → **YES**，理由是 ledger snapshot unreadable
- 任何地方都不再出现 `costUsd.hard: 0.5`

**实测 A、实测 B 原样重跑必须仍然通过**（`r077-reload-loses-the-ledger.mjs`：
已用 $0.0400 / 剩余 $0.0100、clamp 0.010000000000000002 容差断言；
`r077-corrupt-ledger.mjs`：损坏被拒、完好不受影响）。

## 5. 我对你 r077 那 9 条的裁决（照单收下，供你参考）

1. HEAD 写成 6f628a3 —— **我的错**，工单写完之后我又提交了 ca091c4，没回头改。
2. C4 反转 —— **同意反转**。16-a 的 C4「本轮不许读回」是分期化石，16-b 就是来读回的，留着它自相矛盾。
3. 占位记录 —— **接受**，非 JSON 确实没有真记录可装，status 也需要有东西可显示。
   但它带出了上面那个洗白链，所以本轮补隔离。**你主动标出「工单没规定」这件事本身是对的。**
4. 探针 id 用 `-bad/-good` 会被 TASK_ID_SHAPE 重铸 —— 属实，改用 961/962 正确。
5. **在途写失败不进 `untrustedBalances`** —— 同意，判断准确：同一会话内内存里的 usage 才是权威，
   写盘失败只是持久化健康度问题，不该让当前会话自我冻结。
6. 「受控付费委派」= 闸门那一套（非 reviewer），含带 TaskSpec 的首次委派 —— 同意。
7. `0.010000000000000002` 严格说不满足 `<= $0.0100` —— **我的工单自相矛盾**（一处写 ≤、一处写容差），
   你按容差走是对的。
8. 可改文件清单漏了新探针 —— **我的错**，第 4 节要求建它、第 3 节没放行。
9. reload 后 Session usage 归零 —— 属实，那是 usage.jsonl 的会话级聚合，本轮按令不动，与 Task 账本无关。

## 6. 失败证明

本轮新加的**每一条**断言都要单独证明不空转：改坏一处被测代码、贴逐字失败输出（断言名 + 行号）、再改回来。

- **不接受一组断言合并证明。**
- 否定断言（「不写盘」「不自愈」「reviewer 不被拦」）必须**反向变异**：
  把隔离拿掉，看断言是否变红。
- 变异要真的改变可观测行为 —— 我自己上一轮就误判过三次，全是变异写错（等价变异、纯文本断言的别名变异、
  多行 assert 只注释首行）。**判空转前先怀疑自己的变异。**
- **中和先于自己的断言变红的那些断言时，不要注释掉它们。** 我这轮在 r077 的审计上栽了两次：
  按行注释会跨过 `try {` 把文件写坏（读出来像 UNATTRIB），而
  `assert.deepEqual(orch.restoreFromLedger(), ...)` 这种把**被测调用写在断言参数里**的写法，
  一注释就连副作用一起没了，后面那条依赖它的断言反过来被判成空转。
  改成把 `assert.xxx(...)` 换成一个吞掉结果、但照常求值参数（含回调）的代理，两个坑同时消失。
  **写测试时也顺手避掉后一个坑**：被测调用单独一行，断言只读结果。
- 我会自己独立重跑一遍全套审计（r077 的 66 条我已经跑过），请把每条的变异写清楚方便复核。

## 7. 报告格式

发回 `w2E:pD`，纯文本：round_id / ticket / HEAD / branch；改了哪些文件对应 D1–D3；
`slot audit` + `slot status` 原始输出；四条验收退出码；实测 A/B/C 的**完整 stdout**；
每条新断言的失败证明；你认为工单写错的地方（照直说，前四轮你提的都被采纳了）；不 commit、不勾 checkbox。

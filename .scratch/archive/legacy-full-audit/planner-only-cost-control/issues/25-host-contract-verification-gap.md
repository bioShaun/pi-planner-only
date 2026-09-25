# 25: 宿主启动契约无法验证 —— e2e §E/§F/§G 全部 skip，四条验收条款因此挂空

**What to build:** 让「宿主实际收到什么」这件事重新可验证。当前 `npm run test:e2e` 的三个分节都验不了，落地在 04-2、05-1、05-2 以及工单 09 的宿主侧核对上：这些条款全都明写「不以插件写入字段为证」，而唯一能提供第三方证据的入口现在不通。要么补上宿主依赖让 §G 跑起来，要么把这几条验收改写成一个当前真能核对的形式，并把改写理由写进工单 —— 不允许因为验不了就默认勾上。

**Blocked by:** None (can start immediately).

**Status:** done（2026-09-09 cursor planner：第 3–5 条按 round-3 证据勾上；09 第 2 条仍留空，见该票）

- [x] 判定 §G 是否可以在本机修复：`@earendil-works/pi-tui` 装进宿主 node_modules 后，公开 `./preflight` 能否导入 `resolveSubagentLaunchContract`。
- [x] 若可修复：修复后 `npm run test:e2e` 的 §G 不再打印「未验证」，且 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` 下 `npm run test:release` 仍为 0。
- [x] §E（thinking 契约）与 §F（预算宿主契约）给出结论：是等 pi-subagents 暴露公开接口，还是改写 04-2 / 05-1 / 05-2 的验收措辞。结论写进各自工单，不静默勾选。
- [x] 工单 09 的宿主侧角色模型核对给出同样的结论。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`。开票人 planner claude-pD，2026-09-08。

现场（2026-09-08 实测，`npm run test:e2e` 原文）：

```
planner-only pi-subagents E2E: §E thinking 契约未验证 (pi-subagents 未暴露可导入的 resolveSubagentLaunchContract)
planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)
planner-only pi-subagents E2E: §G 角色模型启动契约未验证 (公开 ./preflight 无法导入 resolveSubagentLaunchContract
  (Cannot find package '@earendil-works/pi-tui' imported from …/.planner-only-e2e-*/pi-subagents/src/extension/config.ts))
planner-only pi-subagents E2E: PASS
```

**三条的成因不一样，不要混成一件事：**

- §E、§F 是 **API 面缺口** —— pi-subagents 根本没导出可用的入口，本机装什么都没用。
- §G 是 **依赖缺口** —— `./preflight` 这个导出是存在的（已装 pi-subagents 0.66.0，`exports` 里确有 `./preflight`），
  只是它的导入链走到 `src/extension/config.ts` 时要 `@earendil-works/pi-tui`，而这个包**不在 pi-subagents 的 dependencies 里**
  （其 deps 只有 `@earendil-works/pi-server`、acorn、jiti、typebox、undici、yaml），也**没有装在 `~/.pi/agent/npm/node_modules/` 下**
  （该目录现有 chord、pi-agent-core、pi-ai、pi-protocol、pi-server、pi-telemetry，无 pi-tui）。registry 上有 `@earendil-works/pi-tui@0.85.1`。

所以 §G 大概率是「宿主 TUI 由 pi 应用自己提供、这台机器的安装方式没带上」，装一个版本匹配的 pi-tui 就能通。
**但这要改宿主的 pi 安装目录，不是改本仓库，planner 不擅自动手** —— 需要人拍板，并且要确认 pi-tui 版本与 pi-subagents 0.66.0 兼容，
装错版本可能把正在用的 pi 本体弄坏。这就是本票 Status 为 `ready-for-human` 的原因。

**为什么这不是小事：** 受影响的四条验收条款有一个共同点 —— 它们是专门为了防「插件自证」而写的。
04-2 原文「通过真实 pi-subagents 公开入口或受控本地提供方验证，**不以插件写入字段为证**」。
插件把 thinking 写进 payload 很容易测（已测，全绿），宿主是不是真按这个值启动子代理，是另一回事。
现在缺的正好是后者。在补上之前，这几条只能留空，不能因为「单测全绿」就勾。

skip 本身没有伪装成通过 —— e2e 打的是「未验证」而不是 PASS，且 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` 下（release gate）
skip 会以非 0 退出（见 `e2e.pi-subagents.test.mjs` 头注释 C01）。这个设计是对的，本票不动它。

关联：04（第 2 条留空）、05（第 1–2 条留空）、09（角色模型策略的宿主侧）。

---

2026-09-08 planner claude-pD 现场复核（只读，未改宿主）：把票面里几处描述核准到实测值，并给出 §G 的判定依据。

**宿主三处目录要分清，票面原文没分：**

| 位置 | 内容 | 版本 |
|---|---|---|
| `~/.pi/agent/npm/node_modules/` | 扩展/插件解析用；`pi-subagents`（**无 scope 名**）在这里，另有 6 个 `@earendil-works/*` | pi-subagents 0.66.0；chord / pi-agent-core / pi-ai / pi-protocol / pi-server / pi-telemetry **全是 0.85.0** |
| `~/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/` | pi 本体 CLI（`which pi` 解到这里的 `dist/bundle/cli.js`） | pi-coding-agent 0.85.1；其私有 `node_modules` 里 chord / pi-agent-core / pi-ai / pi-telemetry / **pi-tui 全是 0.85.1** |
| `~/.pi/agent/git/github.com/bioShaun/{pi-grok-theme,pi-context-engine}/node_modules/` | 两个 git 插件各自的树 | 各带一份 pi-tui **0.84.2** |

也就是说 **pi-tui 在本机存在三份（0.85.1 一份、0.84.2 两份），但没有一份在 `~/.pi/agent/npm/node_modules/` 下**，而后者正是 pi-subagents 的解析根。票面「registry 上有 0.85.1」要改成「**本机 pi 本体就自带 0.85.1，不必下载**」。

**§G 是真缺口，不是 harness 的毛病 —— 判定依据：** 从 pi-subagents 的真实安装位置解析 pi-tui，两条路径都失败：

- `require.resolve('@earendil-works/pi-tui', { paths: ['~/.pi/agent/npm/node_modules/pi-subagents'] })` → **MODULE_NOT_FOUND**
- `createRequire('…/pi-subagents/src/extension/config.ts').resolve('@earendil-works/pi-tui')` → **MODULE_NOT_FOUND**

`config.ts:4` 是 `import { Key } from "@earendil-works/pi-tui"`，`./preflight` 的导入链必经此处。所以 e2e 报的是宿主装配的真实断裂。

**因此不允许走「教 harness 去够 CLI 私有目录」这条路。** `e2e.pi-subagents.test.mjs:80-110` 现在是把 `~/.pi/agent/npm/node_modules/pi-subagents` 拷进临时目录、再把同级各包软链回去；若额外把 pi-coding-agent 的私有 `node_modules` 也链进来，§G 会变绿，但绿的是一个宿主上依然解析不到的契约 —— 那正是「一个绿色套件把一条不可满足的断言洗到发布」的老毛病。真修是把 pi-tui 装进 `~/.pi/agent/npm/node_modules/@earendil-works/`。

**待办（已获用户拍板，用户明确表示自担风险）：** 从 pi 本体私有树整份拷 `@earendil-works/pi-tui@0.85.1`，连同它的两个依赖 `marked@18.0.5`、`get-east-asian-width@1.6.0`（两者在目标目录均**不存在**，无覆盖风险）拷到 `~/.pi/agent/npm/node_modules/` 顶层。选 0.85.1 而非与同目录其余包锁步的 0.85.0，理由：① 该副本就是本机 pi 正在跑的字节，不需要联网；② pi-tui 无任何 `@earendil-works/*` 依赖，只依赖 marked 与 get-east-asian-width，不存在跨包版本耦合。回滚 = 删掉这三个新建目录（拷贝前已确认三者均不存在，回滚是干净的）。执行前须等 pi 执行者空闲 —— e2e harness 正是从这个目录拷贝，边跑边装会撞车。

round_id=claude-pD-2026-09-08-note-25

---

2026-09-08 planner claude-pD **执行安装并复测，§E 与 §G 双双转为真验证；第 1、2 条勾上。**

安装（用户已拍板并明确自担风险）：从 pi 本体私有树 `~/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/` 整份 `cp -a` 三个目录到 `~/.pi/agent/npm/node_modules/`：`@earendil-works/pi-tui@0.85.1`、`marked@18.0.5`、`get-east-asian-width@1.6.0`。安装前逐个确认三者在目标目录**均不存在**（无覆盖），安装时 pi 执行者处于 idle（e2e harness 正是从该目录拷贝，边跑边装会撞车）。

安装后解析验证，两条路径都通了：

```
CJS resolve: /home/tcuni-claw/.pi/agent/npm/node_modules/@earendil-works/pi-tui/dist/index.js
ESM-from-config resolve: /home/tcuni-claw/.pi/agent/npm/node_modules/@earendil-works/pi-tui/dist/index.js
```

宿主未损：`pi --version` → `0.85.1`（退出 0），`pi --help` 正常（退出 0）。回滚方式仍是删掉这三个新建目录。

**装完第一次跑 e2e 直接 exit 1 —— 而且是好消息：§G 从「跳过」变成「真跑并跑挂了」。** 原文：

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /policy-test\\\/worker/. Input:

'policy-test/worker:off'
    at file:///home/tcuni-claw/pi/pi-planner-only/e2e.pi-subagents.test.mjs:365:11
```

这是 `e2e.pi-subagents.test.mjs:365` 自己的**多余转义 bug**：源码里写的是 `new RegExp(roleCase.model.replace("/", "\\\\/"))`，`"\\\\/"` 在 JS 里是两字符 `\\` 加 `/`，构造出的正则要求匹配一个**字面反斜杠**再跟斜杠，永远匹配不到 `policy-test/worker:off`。因为 §G 从来没真跑过，这行错了多久都没人知道 —— 正是「跳过的契约测试从不体检」的代价。改成 `"\\/"`（正则 `policy-test\/worker`）后即通过。这是本仓库唯一一处因本次安装而改的代码，一行。

改完复测（`slot cpu`，日志 `p11-pitui-full-after.log`）：

```
planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)
planner-only pi-subagents E2E: PASS
```

`npm test=0`（16 suite 全 PASS）、`npm run typecheck=0`、`npm run test:release=0`。**§E 与 §G 的「未验证」行都消失了**，只剩 §F。

三条各自的结论因此分开：

- **§E（thinking 契约）—— 已转真验证。** 票面原先把 §E 归成「API 面缺口，本机装什么都没用」，**这条判断是错的**：`resolveSubagentLaunchContract` 一直在 `./preflight` 里导得出来，只是导入链被 pi-tui 卡住。现在 §E 真的拿真实宿主入口跑了 worker(thinking=high) 与 oracle(thinking=medium) 两个契约，`contract.thinking` 与传入值逐一相等。工单 **04 第 2 条据此勾上**。
- **§G（角色模型启动契约）—— 已转真验证。** 四个角色 case 全过：角色→子代理名重映射（worker→worker、reviewer→reviewer、validator→**oracle**、explorer→**reviewer**）、`contract.model`、`contract.thinking`、以及工具白名单不超出 `ROLE_TOOL_PROFILES` 的天花板。工单 09 的宿主侧结论见该票，**但那条 checkbox 我没勾**，理由写在 09 里。
- **§F（预算宿主契约）—— 仍是真 API 缺口。** `resolveSubagentBudgetContract` 确实没被 pi-subagents 导出，装任何依赖都不会变。工单 **05 第 1、2 条继续留空**。

顺带发现一个**闸门缺陷，另开工单 26**：文件头注释 C01 声称「with `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1`（the release gate）the same conditions exit non-zero —— a skipped contract test must never read as a pass」，但全文只有 §G 有这个守卫（`e2e.pi-subagents.test.mjs:69` 与 `:378`）。§E（`:286`）与 §F（`:313`）跳过时只 `console.log` 就往下走。实测 `npm run test:release` 在 §F 未验证的情况下**退出 0** —— 一条被跳过的契约测试正以 PASS 的面目通过发布闸门，与 C01 的承诺相反。

round_id=claude-pD-2026-09-08-install-pitui

---

## 2026-09-08 用户授权真实模型花费

- **Root（主模型）**：GPT-5.6 Luna；**子代理**：qwen3.8-27b（沿用当前配置）。要求最小化花费。
- **总花费硬上限 $1**，覆盖本票在内的**全部**真实模型运行（契约实跑 + 19 的对照实验合计）。
  跑到上限即停：实验驱动必须自己带这道闸门，不能只靠事后对账。
- 19 的样本票取**本仓库自己的小票**（38、39 + 1-2 张同量级 backlog 小票）：
  验收标准已写死在工单里，通过/失败是客观的，不需要另造评分。
- 执行者路由：cursor 额度告急，自本日起优先 pi `w2E:pG`、agy `w2E:pF`。

---

2026-09-09 cursor planner（w2E:pE）勾第 3–5 条。依据 round-3 契约实跑（`p18-contract-run-design.md` §9–§13 + `evidence-extract.md`），不是新代码。

**第 3 条结论（写入 04 / 05，不静默改它们的 checkbox）：**

- **§E**：已是真验证（pi-tui 安装之后）。04 第 2 条维持已勾。不必等新公开接口，也不必再改措辞。
- **§F**：公开 `resolveSubagentBudgetContract` 仍不存在。05 第 1、2 条按 F1（schema 接受 `usageBudget` 形状）已经勾上，**维持**。F3 现已闭合：宿主收下字段但不执行（tokens 与 costUsd，委派时已超与子进程自身用量两条路径）。**不要把 05-1/05-2 改写成「宿主会在 hard 处停下」**。运行途中越线仍未专测（G1 诚实缺口）。

**第 4 条：** 09 宿主侧结论已写入该票 Comments。09 第 2 条 checkbox **不勾**（见该票 2026-09-09 注）。

**第 5 条：** `git diff 6715e03 -- spec.md .scratch/planner-only-cost-control/issues/08-phase-a-acceptance-rerun.md` 为空。契约实跑未勾 08、未改 spec。

round_id=cursor-pE-2026-09-09-note-25

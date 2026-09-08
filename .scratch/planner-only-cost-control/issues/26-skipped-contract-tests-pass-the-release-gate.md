# 26: 被跳过的契约测试正以 PASS 通过发布闸门（§E/§F 无 REQUIRE_CONTRACT 守卫）

**What to build:** `e2e.pi-subagents.test.mjs` 文件头注释 C01 承诺：「Missing package or a version outside the declared range prints a SKIP line and exits 0 for local runs; with `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` (the release gate) the same conditions exit non-zero — **a skipped contract test must never read as a pass (C01)**。」实际只有 §G 兑现了这句话。§E 与 §F 跳过时只 `console.log` 一行「未验证」就继续往下走，最后照常打印 `PASS` 并退出 0，**在发布闸门下也一样**。要求：让「未验证」在 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` 下一律非 0 退出，或者把 C01 那句承诺改写成与实现相符的措辞 —— 两者选其一，不允许注释继续宣称一个实现没做到的保证。

**Blocked by:** None (can start immediately).

**Status:** done（2026-09-08 p13-r061 由 pi `w2E:pG` 落地，planner 复跑核验通过）

- [x] `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 node --experimental-strip-types e2e.pi-subagents.test.mjs` 在 §F 未验证时**退出非 0**，且 stderr 指名是哪一节未验证。
- [x] 不带该环境变量时行为逐字不变：仍打印「§F 预算宿主契约未验证 (…)」、仍打印 `PASS`、仍退出 0。
- [x] §E 与 §G 现在都能真验证（见工单 25），因此本票落地后 `npm run test:release` 应当**因 §F 而红**。这是预期结果，不是回归 —— 若为了让闸门变绿而放宽 §F 的判定，本票判 fail。
- [x] 守卫要写成对「所有分节」统一生效的形式，新增分节默认受保护，而不是再手抄一遍 §G 那段 if。
- [x] 不勾 04/05/08/09/25 的 checkbox、不改它们的 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`。开票人 planner claude-pD，2026-09-08。

现场：`~/.pi/agent/npm/node_modules/` 装上 `@earendil-works/pi-tui@0.85.1` 后（工单 25），§E 与 §G 都从「未验证」转成真跑通过，只剩 §F。此时实测 `npm run test:release`（脚本为 `npm run typecheck && npm test && PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`）**退出 0**，输出末两行是：

```
planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)
planner-only pi-subagents E2E: PASS
```

代码依据：`grep -n REQUIRE_CONTRACT e2e.pi-subagents.test.mjs` 只有四处 —— `:14`（注释里的承诺）、`:69` 与 `:378`（都是 §G 的守卫）、`:384`（收尾）。§E 的跳过点在 `:286`、§F 在 `:313`，两处都是裸 `console.log`。

**为什么现在才暴露：** pi-tui 装上之前三节全跳过，闸门永远绿；那时候「闸门会不会拦」这件事根本没被行使过。这与同一天在 §G 里发现的 `:365` 多余转义 bug 是同一类问题 —— **一条从不执行的断言，错多久都不会被发现**。工单 25 的记录里也有这条教训。

优先级：不阻塞 08 重跑（08 有自己的十四条验收，不依赖 test:release），但**必须在把 0.3.x 当作可发布版本之前闭合** —— 否则「release gate 绿」这句话是假的。

round_id=claude-pD-2026-09-08-open-26

### 2026-09-08 p13-r061 落地 + planner 复跑核验

执行者 pi `w2E:pG`，只改 `e2e.pi-subagents.test.mjs`（+16/−7）。实现：新增 `markContractUnverified(section, reason)`，
§E/§F/§G 三个跳过点统一调用；闸门变量为 1 时向 stderr 打印指名分节的 FAIL 并置 `process.exitCode = 1`。

**planner 在自己 pane 里逐条复跑（不认执行者口述）：**

| 条款 | 复跑 | 结果 |
|---|---|---|
| 1 闸门下 §F 非 0 退出且 stderr 指名分节 | `slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 node --experimental-strip-types e2e.pi-subagents.test.mjs` | exit **1**；stderr `FAIL — release gate requires §F contract coverage: …` ✅ |
| 2 不带变量时逐字不变 | 把 `git show HEAD:e2e.pi-subagents.test.mjs` 落到仓库根跑一遍做基线，与改后 `npm run test:e2e` 的 E2E 行 `diff` | **完全一致**（§F 未验证行 + `PASS`），exit 0 ✅ |
| 3 `test:release` 应因 §F 而红，且不得放宽 §F | `slot cpu -- npm run test:release` | exit **1**，末行正是 §F 的 FAIL；§F 判定本身未动，仍诚实报「未验证」 ✅ |
| 4 统一守卫、新分节默认受保护 | 读 diff | 三处跳过点都改成调用同一函数；闸门分支与 section 无关，新增分节只要走这个函数就默认被拦 ✅ |
| 5 不动其他票／spec | `find .scratch/... -newermt '2026-09-08 13:05'` | 只有 planner 自己改的 08 号票；`spec.md` 未动；工作树只有 `e2e.pi-subagents.test.mjs` 一个 M ✅ |

其余闸门：`typecheck` 0、`npm test` 0、`npm run test:e2e`（无变量）0、`git diff --check` 0。
slot preflight 记在 `.scratch/planner-only-cost-control/p13-r061-planner-verify-slot.log` —— `slot audit` 仍报 `pbbwa`（RSS 50.2G）绕过 slot，**未终止**，cpu 池空闲，按规矩继续。

**两条留痕（不阻塞关票）：**

1. `markContractUnverified` 用 `messages` 字典按 E/F/G 取 stdout 文案。若将来加 §H 而忘了加字典项，stdout 会打印 `undefined`；**但闸门本身与 section 无关**，stderr 与非 0 退出照常生效，安全属性不破。属可读性瑕疵。
2. `reportUnavailable`（`:80`，pi-subagents 缺失/越版的早退路径）仍自带一份 §G 文案与闸门分支，没并进新函数 —— 它必须**立即** `process.exit`，语义与「记下 exitCode 继续跑」的新函数不同，保留是对的。行为未变。

**由此产生的后续事实：`npm run test:release` 现在是红的**，红因是 §F 缺真实覆盖（`pi-subagents` 未暴露无模型调用的 budget 契约公开接口）。这正是本票要的结果 —— 在 §F 拿到真覆盖之前，0.3.x **不得**声称「release gate 绿」。§F 的真覆盖另开票追。

round_id=p13-r061

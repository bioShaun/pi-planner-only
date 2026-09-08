# 26: 被跳过的契约测试正以 PASS 通过发布闸门（§E/§F 无 REQUIRE_CONTRACT 守卫）

**What to build:** `e2e.pi-subagents.test.mjs` 文件头注释 C01 承诺：「Missing package or a version outside the declared range prints a SKIP line and exits 0 for local runs; with `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` (the release gate) the same conditions exit non-zero — **a skipped contract test must never read as a pass (C01)**。」实际只有 §G 兑现了这句话。§E 与 §F 跳过时只 `console.log` 一行「未验证」就继续往下走，最后照常打印 `PASS` 并退出 0，**在发布闸门下也一样**。要求：让「未验证」在 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1` 下一律非 0 退出，或者把 C01 那句承诺改写成与实现相符的措辞 —— 两者选其一，不允许注释继续宣称一个实现没做到的保证。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 node --experimental-strip-types e2e.pi-subagents.test.mjs` 在 §F 未验证时**退出非 0**，且 stderr 指名是哪一节未验证。
- [ ] 不带该环境变量时行为逐字不变：仍打印「§F 预算宿主契约未验证 (…)」、仍打印 `PASS`、仍退出 0。
- [ ] §E 与 §G 现在都能真验证（见工单 25），因此本票落地后 `npm run test:release` 应当**因 §F 而红**。这是预期结果，不是回归 —— 若为了让闸门变绿而放宽 §F 的判定，本票判 fail。
- [ ] 守卫要写成对「所有分节」统一生效的形式，新增分节默认受保护，而不是再手抄一遍 §G 那段 if。
- [ ] 不勾 04/05/08/09/25 的 checkbox、不改它们的 Status、不改 `spec.md`。

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

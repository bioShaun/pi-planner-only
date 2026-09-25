# 01: 测试临时目录改到 `os.tmpdir()` 并清理；删掉仓库根的 652 个泄漏目录

Status: verified
Blocked by: 无
Type: task

**What to build：** 所有测试里 `mkdtempSync(join(process.cwd(), ".planner-only-…"))` 改为 `mkdtempSync(join(tmpdir(), "planner-only-…"))`（`import { tmpdir } from "node:os"`），并保证每个用例结束时 `rmSync(dir, { recursive: true, force: true })`（`try/finally` 或已有的 cleanup 位置）。然后删除仓库根目录下已经泄漏的 `.planner-only-lock-*` / `.planner-only-completion-*` 等目录。

**Why：** 2026-09-15 仓库根有 652 个 `.planner-only-*` 泄漏目录（`ls -d .planner-only-* | wc -l`）。它们被 `.gitignore` 遮住了，所以没人注意，但每次 `npm test` 都在往 cwd 里堆垃圾，而且有测试用 cwd 下的目录做 workspace-lock 断言，目录残留会让某些并发/锁用例的前提悄悄变化。这一轮同时用来跑通「执行 → 交回 → 审核」的流程。

**范围：** 只改 `*.test.mjs` 里的 `mkdtempSync` 调用与对应的清理；**不改**任何 `.ts` 源文件。涉及文件（按 grep）：`orchestrate.test.mjs`、`task.test.mjs`、`completion.test.mjs`，以及其他任何命中 `mkdtempSync(join(process.cwd()` 的测试文件。

**注意：**
- 有的测试断言路径经过 `realpathSync` / `normalizeWorkspaceIdentity` 归一化；`os.tmpdir()` 在 macOS 是符号链接，在本机（Linux）是 `/tmp`，一般不受影响。如果某条用例因为路径归一化失败，把失败输出原样贴到本票 Comments，**不要**改源码去迁就。
- 删除泄漏目录属于删除操作：先 `ls -d .planner-only-* | wc -l` 记录数字，再 `rm -rf .planner-only-lock-* .planner-only-completion-*`（只删这两个前缀）。

**Acceptance：**

```sh
# 1. 源码零改动
git diff --stat -- '*.ts' | tail -1          # 期望：空输出

# 2. 不再有 cwd 下建临时目录的调用
grep -n 'mkdtempSync(join(process.cwd()' *.test.mjs   # 期望：无输出

# 3. 全套件绿
npm run typecheck && npm test                # 期望：exit 0

# 4. 跑完不留垃圾（在 3 之后立刻执行）
ls -d .planner-only-* 2>/dev/null | wc -l    # 期望：0
```

**交回：** 上面 4 条命令的原样输出 + `git diff --stat` + 本票 Comments 里一行「删除前计数 N」。

## Comments

- 删除前计数 652（`.planner-only-lock-*` 650 + `.planner-only-completion-*` 2），2026-09-15 由执行方删除，删后 `ls -d .planner-only-* | wc -l` = 0。
- 除票面要求的 `join(process.cwd(), …)` 外，另有 3 处以 `const cwd = process.cwd()` 间接锚定 repo 根的调用（`task.test.mjs`、`nx02-03.test.mjs`、`ledger-store.test.mjs`），同样改到 `tmpdir()`，否则验收 4 仍会留垃圾。
- 泄漏源头：`task.test.mjs` 的 `.planner-only-lock-*` block 原本没有任何清理（每跑一遍 +2），已补 `try/finally`；`completion.test.mjs` 本有 `finally`，漏的 2 个来自中断运行，迁到 `tmpdir()` 后不再污染 repo。
- 其余所有 `mkdtempSync` 用例原本就有 `rmSync` 清理（审计确认，含 `[rootA,rootB,rootC]` 循环清理与 `rmSync(dirname(artifactsDir))` 两处非直写形式）。

**2026-09-16 审核（Devin）：verified。** 复核 4 条验收命令：`*.ts` 零改动；`mkdtempSync(join(process.cwd()` 零命中；`npm run typecheck && npm test` exit 0（35 文件 fail 0，日志 `/tmp/t01-suite.log`）；跑完 `ls -d .planner-only-* | wc -l` = 0。确认 `task.test.mjs` lock block 的 `try/finally` 是 650 个泄漏的唯一来源。`/tmp/planner-only-nx01-*` 7 个旧残留为本票前遗留，本次运行无新增。

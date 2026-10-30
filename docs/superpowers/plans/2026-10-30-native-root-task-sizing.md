# Native Root 任务拆分粒度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 在 Native 指令末尾追加两条规则：委派按“可单独验收的成果”拆分；子代理交回部分结果后，先缩范围再派，不同时换模型。

**Architecture：** 只改 `NATIVE_PROMPT` 的文本契约和中英文说明，沿用现有的 `before_agent_start` 系统提示注入。分为一个实施任务和一次独立复核，最后由 Root 验收。

**Tech Stack：** TypeScript、Node.js 原生 assert 测试、npm release 检查。

**Spec：** `docs/superpowers/specs/2026-10-30-native-root-task-sizing-design.md`。纸面复核见 `.scratch/native-task-sizing/paper-review.md`。

**基线：** `49740aee10ac8ac6b63fd713f1ddac30ae8c8ca4`。四个目标文件在工作区中没有改动，可以直接在原工作区实施。其余未提交的 bench、scratch 改动属于用户工作，不碰。

## Global Constraints

- 目标指令必须逐字使用下方文本。Native 的注入位置、工具权限和生命周期保持不变，Lite/Off 也不变。
- 不增加配置项、运行时 guard 或测量系统，不运行付费模型。
- 先只写测试并运行，保留红灯输出；红灯的失败原因必须是旧指令缺少新规则，不能是语法或导入错误。之后再改实现，并保留绿灯输出。不得删除或弱化已有断言。
- 只改 `index.ts`、`index.test.mjs`、`README.md`、`README.zh-CN.md`。不提交、不安装到生产环境、不 reload。
- 禁止使用 `/tmp`。`TMPDIR` 设为仓库外的 `/project/tmp/ppo-native-task-sizing/tmp`，证据也放在 `/project/tmp/ppo-native-task-sizing/`。预计超过 1 分钟或 2GB 内存的命令，先读 `~/.config/agents/slot.md`，记录 `slot audit` 和 `slot status` 的结果，再用 slot 提交。

## 目标指令

> 实现和跑测试优先交给子代理，自己负责拆分、检查 git diff 与测试结果。若你已掌握相关上下文，剩余修改与必要验证都明确、局部，且无需进一步调查、设计测试或独立复核，可直接完成修改与验证；否则继续委派。每次委派只交付一项可单独验收的成果，例如一个新模块或命令连同其测试；共用同一验收命令或同一次昂贵读取的步骤合并为一次，有各自测试且互不依赖的部分分开委派。子代理请求拆分或只交回部分结果时，先缩小本次交付范围再派，可续用原子代理，不要只要求它继续或在同一任务内分阶段；缩范围时沿用原模型，仍失败再换模型。

## Review Focus

- `expectedNativePrompt` 独立于导出常量。测试检查实际 Native hook 的返回值，包括首次启动、reload、resume 三处（约第 143、684、824、828 行）。
- Lite/Off 不得获得新指令：保留第 148 行的模式隔离断言。
- 第一句（局部任务例外）一字不变。
- 两份 README 与实际指令一致，中文 README 逐字引用。英文 README 如有对应说明，要如实概括，不能退化成文件数或行数规则。

---

### Task 1：追加拆分规则并固定注入契约

**Files：**
- Modify: `index.ts:30`
- Test: `index.test.mjs:143`（`expectedNativePrompt`）
- Modify: `README.md`、`README.zh-CN.md:96`

**Interfaces：** `before_agent_start` 的接口不变。Native 下返回 `{ systemPrompt: 原始提示 + "\n\n" + 新指令 }`。

- [ ] **Step 1：基线。** 记录原工作区 `git status --short` 和四个文件的 SHA-256。跑一次现有 index 测试，用来区分环境失败。
- [ ] **Step 2：只改测试。** 把 `expectedNativePrompt` 改为上方目标指令全文，不改其他断言。
- [ ] **Step 3：红灯。** 运行 `TMPDIR=/project/tmp/ppo-native-task-sizing/tmp node --experimental-strip-types index.test.mjs`。必须因为 Native 注入文本与新期望不符而报 AssertionError。保存命令、退出码和输出到 `red.log`。
- [ ] **Step 4：实现与文档。** 把 `index.ts` 中的常量替换为目标指令，并同步两份 README。
- [ ] **Step 5：绿灯与回归。**
  - 重跑 index 测试，再运行 `npm run test:release`。
  - 如果遇到已知的本机依赖阻塞（已安装的 pi-subagents 缺少 `@earendil-works/pi-ai`），改用 `npm run test:release:isolated`，并如实记录。
  - 运行 `git diff --check`。
  - 保存 `green.log`、`release.log`、`change.patch` 和 `files.sha256`。
- [ ] **Step 6：独立复核与 Root 验收。**
  - reviewer 只读检查：spec、diff、红绿日志、release 输出，并对照 Review Focus。
  - Root 核对证据和四个文件的 diff，并确认其他未提交改动与 Step 1 记录一致。
  - 验收后由用户决定是否提交。

# Native Local Task Exception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native 保持优先委派，并允许已掌握上下文、修改与验证都明确局部的任务由 Root 完整完成。

**Architecture:** 只调整 `NATIVE_PROMPT` 的文本契约与中英文说明，继续使用现有 `before_agent_start` 系统提示注入。一个实施任务，随后独立检查规格符合性和代码质量；Root 最后验收并将四个文件的变更带回原工作区。

**Tech Stack:** TypeScript、Node.js 原生 assert 测试、npm release 检查。

**Spec:** `docs/superpowers/specs/2026-10-29-native-local-task-exception-design.md`（用户已批准）。

## Global Constraints

- 目标指令必须原样使用下方文本；保持 Native 的系统提示注入位置、工具权限和生命周期，不改变 Lite/Off。
- 不增加独立的 reviewer 规则、配置项、运行时 guard 或新测量系统。
- 不改写已有 bench/P2 改动、历史实验 arm、证据或 STOP，不运行付费模型实验。
- 先只写测试，运行并保留因旧指令缺少行为契约而失败的输出；再实现并保留通过输出。不得删除或弱化原有断言。
- 只改 `index.ts`、`index.test.mjs`、`README.md`、`README.zh-CN.md`；不提交、安装到生产或 reload。
- 禁止 `/tmp`。TMPDIR 在仓库外 `/project/tmp/ppo-native-local-task/`；预计超过 1 分钟、2GB 内存的命令先读 slot 规则，记录 `slot audit`/`slot status` 后用 slot 提交。

## Review Focus

- 从常量生成预期值会掩盖文案丢失：新增独立文本期望，检查实际 Native hook 返回。
- 首次启动与 reload/resume：保留现有生命周期断言，新增契约验证不替换原断言。
- Lite/Off 不得获得新指令：保留模式隔离检查，若缺少直接注入隔离断言则针对现有模式场景补充。
- Native 必要验证仍可由 Root 执行：新指令包含完整“修改与验证”例外，保留 Native 不启用 strict 拦截的断言。
- README 必须与实际指令一致：人工检查双语语义和真实文本；不要为文档建立重复测试框架。

---

### Task 1: 调整 Native 指令并固定注入契约

**Files:**
- Modify: `index.ts:30`（提示词常量）。
- Test: `index.test.mjs`（现有 Native 模式注入场景，约 680 行）。
- Modify: `README.md`、`README.zh-CN.md`（Native 模式说明）。

**Interfaces:**
- Consumes: `before_agent_start({ systemPrompt, systemPromptOptions }, ctx)` 现有接口与 fakePi 测试工具。
- Produces: `NATIVE_PROMPT: string`，Native hook 返回 `{ systemPrompt: 原始提示 + "\n\n" + 新指令 }`；其他接口不变。

- [x] **Step 1: 建立隔离工作区和测试基线。** 从 `6ec1029f5a9e507b6e4c3d815cac563bb943b586` 建立独立 worktree，记录原工作区 dirty 文件。只读复用依赖或在隔离目录补齐依赖，不改原工作区依赖。先跑现有 index 测试以区分环境失败。
- [x] **Step 2: 只添加契约断言。** 保留现有引用 `NATIVE_PROMPT` 的断言；另用独立常量 `expectedNativePrompt` 写入下方精确文本，断言实际 Native hook 输出严格等于 `B\n\n${expectedNativePrompt}`。结合已有模式隔离/启动恢复测试覆盖 Review Focus。

> 实现和跑测试优先交给子代理，自己负责拆分、检查 git diff 与测试结果。若你已掌握相关上下文，剩余修改与必要验证都明确、局部，且无需进一步调查、设计测试或独立复核，可直接完成修改与验证；否则继续委派。

- [x] **Step 3: 运行红灯。** `TMPDIR=/project/tmp/ppo-native-local-task/tmp node --experimental-strip-types index.test.mjs`；必须因为旧指令与新规则不同而 AssertionError，不能用依赖/导入错误代替。保存当时 diff、命令和退出码。
- [x] **Step 4: 实现与文档。** 仅替换 `index.ts` 的常量为批准文本；同步两份 README，可使用精确引用或忠实的简洁说明，避免把整个任务例外退化为文件数/行数规则。
- [x] **Step 5: 验证绿灯及回归。** 重跑 index 测试、`npm run test:release`。若已知依赖环境阻塞，使用现有隔离 release 入口或隔离依赖准备解决；记录所有失败、处理和最终命令。运行 `git diff --check`，保存日志、变更 SHA-256 和四文件 diff 到 `/project/tmp/ppo-native-local-task/`。
- [x] **Step 6: 独立复核与 Root 验收。** 新 reviewer 只读检查设计、精确 diff、红绿日志和 release 输出，分别给规格/质量结论。Root 核对证据并检查四文件 patch，只有通过才带回原工作区；不提交、不发布。

## 执行记录

- 用户已明确批准进入计划和实现，按既定子代理方式连续执行，不再次请求计划批准。
- 原工作区位于 main 且有 P2 未提交改动，因此选择独立 worktree；Pi 托管 worktree 要求干净源目录，采用手动 git worktree。
- 本计划只有一个小型任务，独立复核同时覆盖本次完整变更，不重复启动同范围 reviewer；不审查或修改无关 P2 工作。


## 完成与验收记录

- 实现与独立复核已完成；Root 核对实际 diff、红灯阶段仅测试变更、绿灯与完整 release 日志。
- 基线 index exit 0；新契约红灯 exit 1（旧指令与新文本不符的 AssertionError）；实现后 index exit 0。
- 普通 `npm run test:release` exit 1，原因是本机已安装 pi-subagents 缺少 `@earendil-works/pi-ai`；`npm run test:release:isolated` exit 0，实际执行 typecheck 和完整 release 测试。未修改全局依赖。
- 独立 reviewer 的规格符合性和代码质量均 PASS，无问题发现。
- Root 将四文件 patch 应用回原工作区，四文件 SHA-256 与受测 worktree 完全一致，实际 diff 与复核 patch 完全一致；其余原有 tracked diff 与实施前保存结果逐字一致，`git diff --check` 通过。
- 本次生产代码只有提示词常量变化；没有提交、发布、生产安装或 reload。P2 仍暂停。测试验证的是指令契约及软件回归，不证明模型行为或费用改善。
- 证据目录 `/project/tmp/ppo-native-local-task/`：`implementation-report.md`、`review-report.md`、`commands.log`、`red.log`、`red.patch`、`green.log`、`release.log`、`release-isolated.log`、`change.patch`、`files.sha256`。
- 隔离 worktree `/project/tmp/ppo-native-local-task/worktree` 和分支 `native-local-task-exception-20261029` 保留，便于复现；没有强制删除含未提交变更的工作区。

# 步骤 2 静态验收记录

日期：2026-10-27。范围：仅提示词与 delegate 工具描述。行为会话证据另见 [execution.md](execution.md)，本文件不把静态测试当作会话行为证据。

## 改动面

- `index.ts`：`plannerPrompt()` 两版文案；`delegate` 工具 `description` 的批量派发条件与角色示例。
- `index.test.mjs`：仅更新原先固定旧文案的断言，使其匹配新文案；`1_500` 字符上限断言未改。
- 未改 `README*`、`package*.json`、锁文件；这些是步骤 0 已存在的未提交改动，本次未触碰。

步骤 2 的差异：

```bash
git diff --stat -- index.ts index.test.mjs
#  index.test.mjs | 12 ++++++------
#  index.ts       | 17 +++++++++--------
git diff --check   # 无输出
```

原始差异与哈希见 `code.diff`、`code.sha256`。

## 字符数

```text
nonstrict 1487
strict     1478
delegate description 1345
```

两种 `plannerPrompt` 均严格小于 1500；未提高测试上限，未新增固定提示词原文的新测试。

## 命令与结果

均从仓库根目录执行，`TMPDIR=/project/tmp`。

```bash
node --experimental-strip-types index.test.mjs
# index.test: ok

npm run typecheck
# exit 0

PI_SUBAGENTS_DIR=/project/tmp/pi-planner-host-1.4-contract-20261026/node_modules/pi-subagents \
  slot cpu -- npm run test:release
# exit 0
# contract/git/delegate/host/host-runtime/handoff/status-color/index 全部通过
# host-runtime: 5 tests, 5 pass, 0 fail, 0 cancelled, 0 skipped
```

完整输出：`static-release.log`；长度与 diff 检查：`static-metrics.txt`。

## Bun 1.4 补充验证

本机 `bun --version` 为 `1.4.2`。按 Bun 1.4 运行：

```bash
bun run typecheck                 # exit 0
bun index.test.mjs                # index.test: ok
bun test host-runtime.test.mjs    # 5 pass, 0 fail
```

完整输出：`bun-1.4-summary.txt`。

另用 `bun test` 一次加载全部 8 个测试文件时，Bun 的 `node:test` 兼容层只执行了 5 个测试，并在 `index.test.mjs` 报 `afterAll() outside of the test runner` 类错误（5 pass / 1 fail / 1 error）。同一测试在 Node 下通过；这是 Bun 测试收集/兼容差异，不是提示词或插件行为回归。项目规定的发布验收仍以 `npm run test:release` 为准。原始输出：`bun-1.4-tests.log`。

## 断言范围

- 保留：两版长度上限、strict 差异、超时文案、`cwd`、失败重派、diff 检查、提交规则、小任务自做规则。
- 更新：仅将旧提示词原文断言替换为等价的新文案断言（explorer 定位、条件式前置探索、批量描述）。
- 未删弱既有断言；未新增固定原文测试。

## 环境版本说明

发布检查使用步骤 0 记录的隔离 `PI_SUBAGENTS_DIR` 夹具 `0.81.0`。验收期间全局安装的 pi-subagents 变为 `0.83.0`；实际会话使用 `0.83.0`，两者均在 `>=0.70 <1` 声明范围内。全局安装未回退，版本漂移与实际会话证据见 `execution.md`。

## 证据文件

| 文件 | 内容 |
| --- | --- |
| `static-release.log` | Node 发布检查完整输出 |
| `static-metrics.txt` | 两版长度、描述长度、`git diff --check` |
| `bun-1.4-summary.txt` | Bun 1.4 类型检查与单套件结果 |
| `bun-1.4-tests.log` | Bun `test` 全量收集的兼容性限制 |
| `code.diff` / `code.sha256` | 步骤 2 代码差异与哈希 |

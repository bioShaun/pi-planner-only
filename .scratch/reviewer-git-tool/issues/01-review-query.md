# 01: git_review 查询核心（git.ts）

Status: ready-for-agent
Type: task
Blocked by: none

Source: `../spec.md` 第 3–7 节（v3，计划审查第 3 轮 PASS）。

## 交付
- `git.ts`：从 `prepareReviewRange` 抽出 `resolveReviewCommit(command, root, input)`、`reviewMergeBase(command, root, base, head)`，`prepareReviewRange` 行为不变；新增导出 `runReviewQuery(request, cwd, { signal?, runner? })`，失败抛错、成功返回文本，实现 spec 第 3–6 节（log/diff/show、分页与 contentId、版本 ≥ 2.45、env 清理、统一前缀、三组 diff 选项、子命令白名单、NUL 判定、1 MiB 上限）。
- 新测试文件 `reviewer-git.test.mjs`，并加入 `package.json` 的 `scripts.test`。
- 不改 `git_audit`、`delegate.ts`、`index.ts`，不新建扩展入口（属于 02）。

## Acceptance
spec 第 8 节 A1–A11；先写测试并贴出红灯输出（缺少行为导致的失败），再实现并贴出绿灯输出；每条拒绝规则有故障注入；不删除、不放宽现有断言。

## Comments

2026-10-31 Root：首次委派（run 79ee0d39）只交回红灯骨架，范围过大。拆为三次独立交付，各自过靶向测试后再合入：
- 01a 执行层与 log：受限 runner（env 清理、统一前缀、版本 ≥ 2.45、子命令白名单、1 MiB/30s/UTF-8、AbortSignal）、共享 helper 抽取（prepareReviewRange 不变）、ref/path/字段校验、分页与 contentId、`log` 操作。验收 A1（ref 与字段部分）、A3、A5（merge-base 部分）、A9、A10（argv/env/HOME 部分）、A11，加 log 的分页/contentId 用例。
- 01b `diff`：概览与逐文件 patch。验收 A2、A4、A5（逐字节）、A6、A10（配置注入、promisor）。
- 01c `show`：元数据统计与带 path 读取。验收 A7、A8。

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

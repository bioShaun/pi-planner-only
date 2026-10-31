# 02: reviewer 子代理扩展入口与契约

Status: needs-triage
Type: task
Blocked by: 01

Source: `../spec.md` 第 7 节。

## 交付
- 新文件 `reviewer-git.ts`：只注册 `git_review`，调用 01 的 `runReviewQuery`，失败抛错；不引入 `index.ts`。
- `package.json` 的 `files` 加入 `reviewer-git.ts`；`pi.extensions` 保持只有 `./index.ts`。
- 提示文本：`index.ts:73`、`:566`、`delegate.ts:524` 补充大范围使用 `git_review` 的说明。
- `contract.test.mjs` 新增隔离配置 fixture，用真实 discovery 和 child tool plan 校验 reviewer 最终生效的 allowlist，并加一例故障注入。

## Acceptance
spec 第 8 节 A12–A13；TDD 规则同 01。

## Comments

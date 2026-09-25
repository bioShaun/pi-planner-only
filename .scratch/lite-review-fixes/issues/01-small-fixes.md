# 01：交接事实截断、锁键规范化、strict 文档、小任务措辞

Status: ready-for-agent
Type: task

Source: `../spec.md`（问题 1–4）。

## Changes

1. **交接事实截断**（`index.ts` 的 `gatherGitFacts`）：`split("\\n")` 和 `join("\\n")` 改成真实换行
   `"\n"`。先去掉末尾换行，再取前 30 行；超过 30 行时追加一行 `… N more`。
   输出为空时仍然显示 `(clean)`。
2. **cwd 锁键**（`delegate.ts` 的 `runDelegation`，以及上锁之前的代码）：锁键改为
   `realpath(git rev-parse --show-toplevel)`；不在 git 仓库里时，退回 `realpath(cwd)`；
   realpath 失败时，退回 `resolve(cwd)`。只有锁键变化：传给 child 的 `cwd`、
   任务文本和 git 摘要仍然使用原来 `resolve` 后的 cwd。拒绝文案里写出锁键
   （例如 "…still running in repository /repo"），让 Root 知道冲突发生在哪里。
   `handoffRefusal` 的判断逻辑不变。
3. **strict 文档**（README 和 README.zh-CN 的 strict 小节）：写明 strict 只按名字拦截
   Root 自己的 `edit`、`write`、`bash`，不拦截其他插件提供的写能力，不是安全边界。
   不扩充拦截表。
4. **小任务措辞**（`index.ts` 里 `delegate` 的 `description`）：加一句中性的说明，
   让它在 strict 和非 strict 下都成立。例如：
   "Worth it for multi-file work or long reading; outside strict mode, do small tasks (about ≤2 files) yourself."
   系统提示已有的阈值句保持不变。不加参数。

## Acceptance

- `index.test.mjs` 的入口 harness：假 git 的 status 返回 40 行时，交接提示是多行，
  包含前 30 行和 `… 10 more`，不包含第 31 行；status 为空时显示 `(clean)`。
- `delegate.test.mjs`：
  - `/repo` 有 worker 在途时，对 `/repo/src` 的 worker 委派被拒绝；
  - 经 symlink 指向同一仓库的写法也被拒绝；
  - 两个不同仓库可以并行；
  - 不在 git 仓库时退回按 realpath 锁。
- 工具描述和系统提示里都有小任务阈值（文本断言）。
- README 两个语言版本的 strict 小节都有"不是安全边界"的说明。
- `npm run test:release` 全绿（`TMPDIR` 设在仓库外）；`git diff | grep '^-.*assert'` 没有输出。

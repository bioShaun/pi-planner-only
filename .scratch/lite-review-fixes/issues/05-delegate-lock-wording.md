# 05：delegate 描述写明按仓库互斥

Status: done
Type: task

Source: 票 03 的 bench 统计。

## Problem

bench 里有 40 次 `still running` 锁拒绝，最常见的是同一 turn 并行发出 explorer+validator（22 turn）。
系统提示和工具描述都没说 worker/explorer/validator 按仓库互斥，Root 只能靠被拒绝来发现，每次白费一轮工具调用。
票 01 把锁键扩到仓库根之后，子目录 cwd 也会互斥，这类拒绝只会更多。另外 `cwd` 参数描述仍写着 "per-cwd lock"，已经过时。

## Changes

- `delegate` 工具描述追加："worker, explorer, and validator run one at a time per repository (a second one is refused); a reviewer or another repository can run alongside."
- `cwd` 参数描述改为 "...; the diff summary uses it, and the lock covers its whole repository."
- 不改系统提示（有长度预算）。不改锁语义。

## Acceptance

- `index.test.mjs` 对两段新文本做文本断言。
- `npm run test:release` 全绿（`TMPDIR` 设在仓库外，不用 `/tmp`）；`git diff | grep '^-.*assert'` 没有输出。

## Comments

- 2026-09-25 实现完成，已提交；typecheck 与五套件全绿，无删除断言。

## 已知未做

- 不在 git 仓库时，拒绝文案仍写 "still running in repository <realpath cwd>"。要区分就得改 `resolveLockKey` 的返回类型并改动既有断言，收益太小，不做。
- 2026-09-25 Root 代维护者验收通过（done）：验收条款逐条核对；`TMPDIR=/project/tmp/ppo-review npm run test:release` 全绿，无删除断言；真实 git 冒烟通过（描述文本与断言一致，系统提示未改）。

# 01：T2c 任务定义待 target 提交进入 canonical 仓后才能入库

Status: ready-for-human
Type: task
Execution: 未开始；`bench/tasks/T2c.{json,md}` 暂由 `.gitignore` 排除，落库后再删除排除行。

## Problem

`bench/tasks/T2c.json` 的 `repo` 指向本仓库内的 `.scratch/lite-t2c-preparation-20260927/task-source`：
一个无 remote 的本地克隆（`.git` 约 20MB），该目录已在 `.gitignore` 中排除。其余四个任务
（T1/T2/T2b/T3）都使用 canonical 仓 `/public/scripts/tc-probe-design-v2`。

核对结果：canonical 仓有 T2c 的 parent `a131527` 与 T2b 的 target `46d408a`，但没有 T2c 的 target
`c3dd016`（"test(allele-pair): enforce empty wide ALT source schema"）。所以现在把 `repo` 改回
canonical 路径任务也跑不起来，照原样提交则提交一个无法复现的配置——两种做法都会留下坏账，
因此本次先只提交 T2b 与两个新 arm，T2c 定义留在 `task-source` 旁边。

## Work

1. 把 `c3dd016` 推入 canonical 仓；推之前核对 `a131527..c3dd016` 的 diff 与
   `.scratch/lite-t2c-preparation-20260927/gold-application.patch` 一致，且新增的 44 项边界测试
   就是冻结证据里跑过的那份。
2. `bench/tasks/T2c.json` 的 `repo` 改为 `/public/scripts/tc-probe-design-v2`，并删除 `.gitignore`
   中 `bench/tasks/T2c.{json,md}` 两行和上面那条前置条件注释。
3. 复核 `bench/tasks/T2c.md` 的"13 列 / 空宽表"口径与
   `.scratch/lite-cross-task-next-20260926/issues/04-t2-no-alt-contract-wording.md` 的结论一致，
   再随配置一起提交。

## Acceptance

- `git -C /public/scripts/tc-probe-design-v2 cat-file -t c3dd016` 成功，且该提交包含两个目标测试文件；
- `bench/prepare-clone.sh T2c <空目录>` 在只有 canonical 仓的机器上成功克隆并检出 target 测试；
- 已提交的 T2c 运行证据与报告不改写，本票只改任务定义与 `.gitignore`。

## Comments

- 2026-09-27 建票：整理待提交清单时发现 `repo` 指向仓库内克隆、target 提交不在 canonical 仓，
  维护者决定本次先不提交 T2c 定义（见 `.scratch/lite-t2c-focused-20260927/execution/report.md` 的运行结论）。

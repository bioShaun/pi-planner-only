# 证据假阳性：未跟踪目录内新建文件被误判 "no longer present"

Status: verified

## 现象
worker 声明创建 `.scratch/nx-followups/host-validation/c14-rev1.txt`（实际存在，38 B，内容正确），host 证据核验却判 `decision: revalidate` / `failure: evidence (evidence-stale)`，理由同时包含 `reported changes no longer present`、`over-declared`、`missing`——三者互相矛盾，且与 Root 直接 read 到文件的事实冲突。白白触发了一轮 revalidate 和一轮仅重报声明的纠正。

## 根因
workspace-snapshot / evidence 比对逻辑使用 `git status --porcelain`（未加 `--untracked-files=all`）：对整体未跟踪目录只报一条 `?? .scratch/nx-followups/host-validation/`；该目录条目不可哈希，记为 `dirtyPathHashes={\".scratch/nx-followups/host-validation/\": null}`；于是目录内单文件声明永远无法与 snapshot 匹配 → 同时落入 missing 与 over-declared。

## 复现证据
- Session 2026-09-13T08-30-29-108Z_01a099e3…，Task T-20260913-023（alias T-C14-1），branch fix/host-validation-cumulative-patch @ 017773c
- rev-1 worker run 301ce958-e87a-4f8b-bbab-961cb6413452：报告摄取即判 evidence-stale
- 对照：rev-2 bounded oracle 使用 `git status --porcelain --untracked-files=all -- <dir>` 能正确列出单文件，validation passed

## Suggested fix
snapshot 侧对齐口径二选一：
1. porcelain 调用统一加 `--untracked-files=all`，使未跟踪目录下钻到文件级；或
2. 对 declared changedFiles 逐路径 `git status --porcelain -- <path>` 做存在性核验，而不是依赖整体 snapshot 匹配。

## 影响面
任何 worker 在全新未跟踪目录下创建文件的任务都会误触 revalidate/reject，产生无谓的纠正轮。属于既有行为，非 cumulative host-validation 补丁引入（C14 演练发现，定为 D1）。

- 2026-09-13 D1 fix host-verified on host (session 01a09aca, T-D1-RV: file attributed fresh); status flipped by Root.

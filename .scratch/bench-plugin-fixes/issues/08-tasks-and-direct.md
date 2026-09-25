# 08：新任务与 direct arm

Status: needs-info
Type: task
Blocked by: 01, 02

- 新增一个 direct arm：Root 用 cpass-ds（`cline/cline-pass/deepseek-v4.1-flash`），不加载插件。
- 从其他仓库挑 2–3 个任务，要求难度让通过率落在 30–70%，并且都通过 goldcheck。候选仓库需要维护者确认。

## Comments

- 2026-09-25 已完成：新增 arm `direct-pds`（cpass-ds 做 Root，不加载插件）和 `lite-pds-strict-head`（pluginRef 为 WORKTREE，campaign 启动时冻结成 HEAD），提交 a59588e。
- 候选任务（explorer 在 /public/scripts 下初筛，还没做 goldcheck）：

  | 仓库 | target / parent | 规模 | 备注 |
  |---|---|---|---|
  | genonova-cli | 7f35df4 / 03d0791 | 2 个文件，44 行 | 偏简单 |
  | system-py | 1601e9d / e7d9330 | 2 个文件，81 行 | 偏简单 |
  | hermes_bio_job_manager | c66310e / ee8f2f8 | 2 个文件，74 行 | 偏简单 |
  | nf-pangenome-design | a04c1d7 / 8bda135 | 3 个文件，289 行，涉及 2 个测试文件 | 难度可能适中 |
  | nf-batch-design-probe | b647c04 / f9fc7ed | 8 个文件，669 行 | 太大 |

- 阻塞项：这些仓库都没有 `.venv`，需要维护者确认能否用它们做任务，以及用哪个 Python 环境。前三个是单源文件改动，通过率可能接近 100%，达不到 30–70% 的目标。要找到难度适中的任务，可能得选多文件改动（例如 nf-pangenome-design），或者自己设计任务。

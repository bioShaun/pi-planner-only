# 08：新任务与 direct arm

Status: ready-for-agent
Type: task
Blocked by: 01, 02

- 新增一个 direct arm：Root 用 cpass-ds（`cline/cline-pass/deepseek-v4.1-flash`），不加载插件。
- 从其他仓库挑 2–3 个任务作为成本评测任务。入选条件：goldcheck 通过，且 direct 与 lite 两臂都能稳定通过（成本比较算的是完成的代价，不是失败的代价）。候选仓库需要维护者确认。
- 困难任务另立能力评测线，用于测能力边界；不替代日常任务分布，也不根据少量试跑结果更换正式评测任务。

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

- 阻塞项：这些仓库都没有 `.venv`，需要维护者确认能否用它们做任务，以及用哪个 Python 环境。前三个是单源文件改动。
- 2026-09-25 Root 决定（维护者授权由 Root 判断）：
  - 先接入 **nf-pangenome-design `a04c1d7`**，作为 T4。这个改动涉及 3 个文件、289 行，同时改了 2 个测试文件。
  - genonova-cli、system-py、hermes_bio_job_manager 这三个暂不接入（原理由是通过率接近 100%；按下方 2026-09-25 修订，这不再是排除理由，是否接入待重新判断）。nf-batch-design-probe 改动太大，不用。
  - Python 环境：不改 /public/scripts。在 `/project/tmp/ppo-bench/envs/nf-pangenome-design/` 建一个专用 venv，按仓库声明的依赖安装，T4.json 的 `python` 字段指向它。
  - 接入 T4 的门槛：
    - 在 BASE 上，目标测试必须失败；
    - `bench/goldcheck.sh T4` 必须 PASS；
    - 基线用 masked suite 生成。
  - 上线前先确认 direct 与 lite 两臂都能稳定通过（次数和预算待定，恢复测试时再定）。
  - 目前暂停：维护者要求今天先停止测试，控制 token 消耗。
- 2026-09-25 修订（[方向评估 §2.5](../../../docs/lite-direction-review-2026-09-25.md)）：删除"通过率落在 30–70%"和"两次都通过就换更难任务"两条，这是能力评测的标准，不适用于成本评测。成本评测任务改为要求两臂都能稳定通过 goldcheck；困难任务另立能力评测线。

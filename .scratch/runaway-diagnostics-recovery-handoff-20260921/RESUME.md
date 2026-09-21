# 继续执行（已于 2026-09-21 完成，保留为历史记录）

> 下列步骤已全部执行完毕：release-odQcJL exit 0；host-7iH0yO exit 0（首轮 host-xS2LKF 125 已归因并修正 harness）；strict-A7XBX7 PASS (final)。结论见 REPORT.md 与 execution/final-state.json。剩余未授权事项（更新本机安装、推送、上游 PR）见 RELEASE-STEPS.md。


当前代码见 execution/source-manifest-r3.json / product-r3.patch。已通过的完整 release 与真实宿主证据仅属于 r1；不得继承为 r3 PASS。先阅读 REPORT.md、execution/validation-interruption.md 和最新 code-review 报告。

1. 检查 heavy.slice 的 memory.current / memory.pressure 和 slot status；不终止他人作业，不调高槽位。当前环境仍持续阻塞时保留 BLOCKED，避免无进展重试。
2. 在正常终端运行（每次 wrapper 已记录 slot audit/status 并走 slot cpu；临时文件仅用 /project/tmp）：

```bash
bash .scratch/runaway-diagnostics-recovery-handoff-20260921/execution/run-validation.sh release
bash .scratch/runaway-diagnostics-recovery-handoff-20260921/execution/run-validation.sh host
```

先确认 release 全部通过，再运行 host。host 会使用现有凭证调用真实子模型，但不修改本机安装和全局配置。保留所有退出码和日志；不要在运行时编辑 wrapper。超时后确认所属 scope 已结束；不要广泛 kill。

3. 若当前源文件哈希仍匹配 r3，更新 execution/ReviewRequest.md 的运行证据路径；若源码改变，重新冻结 manifest 和快照，并重新取得 fresh code review。必须用当前 release 与 host 证据，原 host 的纯解析复核只作为历史记录。ReviewRequest 当前只是待补齐模板，不能直接作为最终门禁前置条件已满足的声明。
4. 前置证据齐全后，正常终端运行：

```bash
bash .scratch/runaway-diagnostics-recovery-handoff-20260921/execution/run-validation.sh strict
```

保留 launcher 退出码、实际权限探针和 reviewer verdict。缺少其中任一项不得标为 final_acceptance=PASS。不降级为同会话 ordinary review；未改善的同一证据缺口不重复最终审查。

5. 更新 REPORT.md 状态，明确各快照；00/05 仍只交付 RELEASE-STEPS.md 和 UPSTREAM-PROPOSAL.md。用户未授权推送、更新脏安装副本或提交上游 PR。

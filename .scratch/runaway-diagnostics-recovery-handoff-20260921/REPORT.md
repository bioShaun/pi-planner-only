# 本轮交付记录

范围：本地实现 01–04；00/05 按用户选择只交付发布步骤与上游提案。本机安装、远端分支和上游 PR 均未修改。当前代码已完成两轮审查修正；2026-09-21 资源压力解除后，r3 快照的发布复验、真实宿主复验和 strict 最终审查均已完成并通过，最终验收关闭。

## 实现

- 执行记录保存最近 64 条有界 UPDATE；诊断显示首个观测到的非只读工具序号、最大 token 增量、只读比例和覆盖情况。
- 取消且缺少终态用量时，保存未分类用量下界；usage.jsonl 可重放，迟到完整用量替换快照，未知缓存和费用保持未知。
- worker 可选择 `maxReadOnlyTools` 或 `preparationTokensShare`；默认关闭，触发 `preparation_runaway`，保留原有取消、停止确认、writer hold 和恢复门禁。
- retry_same_plan / fix_environment 子包附带结构化 `priorExecution`，包含旧执行身份、触发观测、前后 diffstat、最近工具参数、输出和恢复原因，Root instructions 独立，TaskSpec 不变。
- retry_same_plan 的 token 预算低于上次已观测用量时，以 `RECOVERY_ENVELOPE_BELOW_OBSERVED` 拒绝；相等可用，墙钟数值不作为 token 比较。

## 验证与证据

- 基线：`execution/baseline/`、`baseline.patch`、`baseline-status.txt`；最新 r3 本轮差异为 `execution/product-r3.patch`（r1/r2 也保留），不能把整个工作区的旧差异归于本轮。
- **历史 r1 快照**完整 `npm run test:release`：`execution/release-Pq0WE7/`，exit 0，源码前后哈希一致。旧 npm 安装位置不存在，原有 contract-parity 检查跳过；实际 Git 安装的传输链路另由下面的宿主验收覆盖，不据此扩大版本兼容声明。
- **历史 r1 快照**真实 Pi SDK 0.86.1 + pi-subagents 0.70.0@bbb30096 + `tcuni-luna/gpt-5.6-luna:low`：`execution/host-run-RXGj2l/`。首次和恢复执行均在第 2 次只读调用时超过上限 1，均 `preparation_runaway`、停止确认成功、无 writer hold；实际子会话任务消息包含完整 priorExecution，TaskSpec 保持一致。
- Root 使用脚本化 provider 精确驱动注册工具；子任务使用真实模型、真实读取工具、实际 launcher 和 Git。归档开头的宿主占位 user 行是 `[prompt redacted]`；已核实第一条实际 Task 用户消息。
- 原宿主 harness 最后的原文搜索错误地直接匹配 JSON 转义内容，exit 1；保留在 `execution/host-6i2Tco/` 和 `host-run-RXGj2l/result.json`。修正为解析原始子消息后复核，`node execution/verify-host-evidence.mjs execution/host-run-RXGj2l` 通过，证据为 `verification.json` 与 `recovery-child-message.json`。未重新调用付费子模型，未覆盖失败记录。
- 首轮 release 和一次 focused 失败因原恢复测试低于新增预算下界；已将夹具改为合法预算并保持各测试原本的时间门禁/恢复去重断言。期间修正了取消终态无 usage 时漏写快照的分支。失败日志均保留。
- 每次重任务启动前均保存 slot audit/status，并经单个 slot cpu 作业执行。临时文件位于 `/project/tmp`；真实宿主复制的 auth/models 配置已删除。

### r3 当前证据（2026-09-21 07:25Z–07:51Z，heavy.slice 已回落至 12–19GiB）

- 启动前核对：`source-manifest-r3.json` 62/62 文件哈希一致；`slot status` 无运行作业，`slot audit` 无绕过进程。
- **release**：`execution/release-odQcJL/`，`npm run test:release` exit 0，63 秒。stdout 与 r1 同为 70 行、末步 request-stop PASS；stderr 那条 EISDIR 是 request-control durable-faults 注入，r1 同样出现。
- **host 第一次**：`execution/host-xS2LKF/` + `host-run-Nrhynh/`。harness 在 07:27:53Z 写出 verdict PASS，`verify-host-evidence.mjs` exit 0，但 node 进程正常结束后没有退出，被 wrapper 的 320 秒 timeout 收掉，退出码 125（本机 `timeout` 超时返回 125，`timeout 1 sleep 5` 直连与经 slot 均实测）。拆卸时残留 FSWatcher + ChildProcess，来自宿主 SDK/上游 launcher；产品源码无 fs.watch/spawn，本轮补丁未新增任何定时器。r1 之所以"立即退出"，是因为它以未捕获断言异常强退，并不能证明句柄干净。
- **harness 修正 2**：`host-acceptance.mjs` 收尾处新增 `active-resources-at-exit.json` 记录并在 PASS 时显式 `process.exit(0)`（FAIL 路径保留 throw）。修改前副本 `host-acceptance.pre-exit-fix.mjs`（sha256 90c3ca3b…），修改后 df3d84e0…。修改在两次运行之间进行，运行期间未编辑任何脚本。
- **host 第二次**：`execution/host-7iH0yO/` + `host-run-sdRHiU/`，exit 0，43 秒。Pi 0.86.1 + pi-subagents 0.70.0@bbb30096 + `tcuni-luna/gpt-5.6-luna`；probe-first/probe-retry 均 `preparation_runaway`、停止确认、无 writer hold；`verify-host-evidence.mjs` exit 0。两次运行之间源码哈希一致。
- **cli-probe 归因**：wrapper 的 `cli-probe` 再次 125，原始输出为 `Reading additional input from stdin...`——是探针没有关闭 stdin，不是 codex 故障。`execution/cli-probe-stdin-closed-TLdJqr/` 用 `</dev/null` 重测，17 秒返回 READY，exit 0。
- **strict 最终审查**：`execution/strict-A7XBX7/`，ReviewRequest 为 `ReviewRequest-r3-final.md`（sha256 6eb1b5d0…，副本 `ReviewRequest-as-launched.md`）。launcher exit 0，07:41:10Z–07:50:56Z；reviewer 首行 `PASS (final)`；父探针 `O_CREAT|O_EXCL` 于仓库根得到 errno 30 EROFS，子探针经 reviewer 转述同为 errno 30，仓库根无探针残留。全文见 `reviewer-verdict.md`。reviewer 列出的限制：未在沙箱重跑子进程/付费测试；npm-path contract parity 仍跳过；host 证据只覆盖一个安装版本组合且 Root 为脚本化；显式退出记录了残留句柄，"自然拆卸"未被证明。

## 后续交付

- [发布步骤](RELEASE-STEPS.md)：包括脏安装副本的处理顺序、当前 CLI 的单包更新命令、模型配置核对与新会话验收。
- [上游提案](UPSTREAM-PROPOSAL.md)：包含累计 usage 契约、投影和去重改动、取消/重试测试要求；没有声称上游已实现。
- 本轮不包含 `uncached | total` 策略切换，不扩展插件原有 `<0.70` 的声明范围。

## 审查修正与当前限制

- 首轮普通代码审查要求保留 UPDATE/终态用量最大值，并在 planner_tasks 暴露工具及参数；已修正并新增回归断言。
- 第二轮普通代码审查发现：非 token runaway 的早期峰值可能被64条滚动记录淘汰，及可选 recentTools 后的工具记录可能遗漏。现以独立 observedTokenHighWater 持久化峰值，并合并后续工具序号；覆盖低终态用量、70帧淘汰和稀疏 recentTools 的测试已补入。回归测试已在正常终端通过（release-odQcJL）。
- 当前 r3 快照：`89e4a4cbae991e01b163e11e8e0add6d6291f6222662b3e85c9679f58ba1a018`；`execution/source-manifest-r3.json` 固定源码。r3 TypeScript 检查 exit0。
- r1 strict launcher 600秒超时（stdout 0 字节，codex 未启动），无 verdict、无只读权限证明；r2 发布复验停滞后已停止。当时共享 heavy.slice 内存约69GiB，超过64GiB软阈值，full avg60约73%。压力解除后同一 launcher 于 strict-A7XBX7 在 586 秒内完成并 PASS，支持环境阻塞的归因。
- 验证脚本曾在执行中被修改，引起中断后的误重提；两个自有 scope 均已确认 inactive/dead。原始失败、超时和中断证据未覆盖，详见 `execution/validation-interruption.md`。
- **01–04 实现已落地，r3 快照最终验收已关闭（release PASS、host PASS、strict PASS (final)）**。仍未做、且未获授权的事项：更新本机脏安装副本、推送、开上游 PR；步骤见 [RELEASE-STEPS.md](RELEASE-STEPS.md)。[RESUME.md](RESUME.md) 保留为历史记录。

## 当前状态

普通代码复核（r1–r3）结论 `PASS (code)`；strict 最终审查（strict-A7XBX7）结论 `PASS (final)`，附 launcher 退出码与父/子权限探针。`execution/final-state.json` 与下列一致。

```json
{
  "scope_id": "runaway-diagnostics-recovery-01-04-20260921",
  "snapshot_id": "89e4a4cbae991e01b163e11e8e0add6d6291f6222662b3e85c9679f58ba1a018",
  "code_review": "PASS",
  "validation": "PASS",
  "final_acceptance": "PASS",
  "review_kind": "final",
  "review_verdict": "PASS",
  "isolation_requirement": "strict",
  "evidence_refs": [
    "execution/source-manifest-r3.json",
    "execution/code-review-r3.md",
    "execution/r3-typecheck.txt",
    "execution/release-odQcJL/",
    "execution/host-7iH0yO/",
    "execution/host-run-sdRHiU/",
    "execution/host-xS2LKF/",
    "execution/host-run-Nrhynh/",
    "execution/host-acceptance.pre-exit-fix.mjs",
    "execution/cli-probe-stdin-closed-TLdJqr/",
    "execution/ReviewRequest-r3-final.md",
    "execution/strict-A7XBX7/",
    "execution/strict-A7XBX7/reviewer-verdict.md",
    "execution/validation-interruption.md"
  ],
  "contract_error": null
}
```

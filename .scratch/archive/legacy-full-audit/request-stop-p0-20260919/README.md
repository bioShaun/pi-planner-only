# P0 请求停止：证据、spec 与执行进度

开始：2026-09-19；整理：2026-09-20（Asia/Shanghai）。基线 `3991c5c762584cbbc235576359734259f69931ce`。

2026-09-20 用户批准建议值和五票拆分；01–05 已完成，P0 保底验收通过，随后纳入提交 `85bdd2a`。当前状态以 [验收记录](evidence/acceptance.md)为准。原始 drafts、失败尝试和历史证据保留不改。

- [前置验证结论](evidence/discovery.md)
- [P0 spec](spec.md)
- [独立验证记录](evidence/validation.md)
- [六场景宿主独立验证](evidence/validation-v2.md)

## 执行依赖

| Ticket | 完整行为 | Blocked by |
|---|---|---|
| [01](issues/01-durable-request-stop.md) | 一个请求耗尽总额度后持久封锁、取消活动 child，并如实保存 Writer hold | None（已批准） |
| [02](issues/02-semantic-no-progress.md) | 改文案、换 Task、重复 recovery 无法逃逸无进展边界；合法参数修复有有限机会 | 01 |
| [03](issues/03-trusted-request-resume.md) | 可信新用户输入或 operator-only 操作开启新请求；续跑、重载不能解锁 | 01 |
| [04](issues/04-revalidation-dispatch-accounting.md) | 实际 evidence revalidation 派发准确计数，现有三次上限生效 | None |
| [05](issues/05-host-and-release-acceptance.md) | 固定版本完成宿主、故障、回归和独立审查，明确交付能力 | 01、02、03、04 |

01–04 各自必须包含行为测试和相应契约文档更新。05 做整合验收，不把前面票的测试推迟到最后。按依赖执行并不等于并行写入：同一 cwd 始终只有一个写入者。

执行顺序：04 → 01 → 02 → 03 → 05。正式工单在 `issues/`。唯一写入者由 Root 在每次交接时指定。

当前进度：01–05 完成。普通终端 [release](release-run-Xg0XFH/test-release.log)、[真实 CLI](cli-acceptance/REPORT.md) 和 [strict delta review](evidence/review-r4/strict-verdict.md)通过。实现了 Request 持久准入、失败因果链、可信恢复与实际 revalidation 派发记账；采用批准的 32/8/3/2/15 分钟默认值，每 Task revalidation 仍为 3。早期[首轮失败（21/22）](evidence/final-validation/summary.md)、[复验（7/7）](evidence/final-validation-r2/summary.md)及 [r3 行为复审](evidence/review-r3/behavioral-review.md)仅是中间版本历史证据。

单进程证据使用三个新增测试（request-control、request-stop、revalidation-accounting）及真实 SDK 0.85.1 的 [集成探针](request-host-probe.mjs)。该层模拟 Git 与 child 来源；普通终端真实 CLI/launcher 证据单列。实现与验证记录见 [日志](evidence/implementation-log.md)。

## 验证环境约束

项目禁止在 sandbox agent executor 内跑 release 或生成子进程的测试。历史插件探针的 fingerprint 路径实际上调用了 Git 子进程，原始记录保留，此处纠正先前“全部无子进程”的范围说明。新增 fixture 显式替换该边界，不改受保护的原测试探针。最终 release、真实 CLI/TUI/launcher 验收需普通终端或 CI。可在普通终端执行 `bash .scratch/request-stop-p0-20260919/run-release-terminal.sh`，自动记录 slot preflight、源码指纹和测试输出。

严格代码审查必须使用全局独立只读 launcher 并验证实际权限。早期 sandbox [启动受阻](evidence/strict-review/blocked.json)的记录保留；随后普通终端 [r4](evidence/review-r4/strict-verdict.md)已获得父/子 EROFS 证据和 reviewer PASS。该次 launcher 仍以 124 超时结束（父最终转述未完成），不能写成正常退出 0。[SDK 结果](request-host-run-mZtnv0/results.json)证实队列可能多调用一次模型；真实 print 场景的完整停止不外推到 TUI 或所有续跑模式，也不承诺 token/费用硬上限。

项目引用的 `.codex/codex-subagent-config-astra-planner.md` 不存在；已搜索确认，本轮使用当前用户级 `/home/tcuni-claw/.codex/astra-planner.md`。未改角色配置。

## 2026-09-20 收尾（05 完成）

release、真实 CLI + pi-subagents 0.69.0、strict gate 三项强制门禁已在普通终端（Claude Code Bash）完成；过程中修正了 `requestFor` 的 `previouslyManaged` 跨 workspace 误判（产品缺陷）并把终端脚本的临时根改到 `/project/tmp`。最终状态与结论见 [evidence/acceptance.md](evidence/acceptance.md)，工单见 [issues/05](issues/05-host-and-release-acceptance.md)。

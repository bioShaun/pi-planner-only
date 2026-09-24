# 05: 固定版本宿主与发布验收

**What to build:** 用完整、可复查的证据交付 P0，并明确哪些运行模式只封锁委派，哪些已经证明整个 Root 请求停止。

**Blocked by:** 01、02、03、04。

**Status:** done（2026-09-20；验收后纳入 `85bdd2a`，无发布证明）

**Approval:** 2026-09-20 用户批准建议值和五票拆分；同日要求“将 05 处理完”。

- [x] 固定插件源码/版本、实际 host 与 launcher；记录本地 peer 0.84.4 和全局 host 0.85.1 的差异，真实 launcher 目标为 0.69.0。→ `cli-acceptance/cli-run-*/versions.json`、`evidence/review-r4/source.sha256`
- [x] 各票的 focused tests 已通过；真实 SDK/faux 断言相同参数、文案改写、跨 Task/recovery、mixed tool batch、scheduled/queued continuation 与下一新输入。→ `release-run-Xg0XFH`（全量）、`request-host-run-mZtnv0`
- [x] 请求封锁后所有 child REQUEST 为 0；确认/未确认取消及 Writer hold 重载均有证据；无 hard cancel 时明确显示 Root 可能继续消耗 token。→ `cli-run-deadline` requestsAfterClosure 0；request-stop 测试；acceptance.md 结论列明 SDK 队列多一次调用
- [x] 真实普通终端/CI 的 CLI+0.69.0 transport 验收覆盖 request/terminal 关联、CANCEL 和 usage；自然语言有界运行与程序注入的 faux 实验分开记录。→ `cli-acceptance/REPORT.md`
- [x] 对声称 full stop 的模式证明 halt 后无模型/child/自动续跑；TUI 源码或 replica binding 不算真实 TUI 通过，缺失时保持未验证标记。→ print 模式已证明；TUI 标未验证
- [x] 在普通终端或 CI 跑完整 npm run test:release 及子进程测试，记录 result.error、signal、exit 和输出；sandbox EPERM 不改测试、不算产品回归。→ `release-run-Xg0XFH` exit 0；首轮失败保留在 `release-run-LICUcN`
- [x] 代表性正常任务验证建议默认值的可用性，失败样本保留；若需改值，先明确新值与理由，不让模型自动抬高边界。→ natural 用 5/32 工具、2/8 child；未改值
- [x] 冻结中性证据并以独立只读父 launcher 完成 fresh Reviewer strict gate，实际权限探测有证据；最终状态与被审版本一致。→ `evidence/review-r4/strict-verdict.md` PASS；父/子 EROFS 探测；`source-final.sha256` 与冻结相同。launcher 退出 124（父的最终转述超时），verdict 取自 child 线程原始记录
- [x] 历史模型核验独立列示，当前 0.69.0 无模型证据时标未知；不恢复路由，也不承诺成本节省。→ 0.69.0 上 Root/child 实际模型均为 `tcuni-luna/gpt-5.6-luna`（REPORT.md）；无路由；不承诺成本
- [x] 最终报告将“P0 保底通过”和“完整 Root stop 通过/缺失”分列；缺少强制验收就保持未完成。→ `evidence/acceptance.md` 结论段

## Comments

- 2026-09-20：01–04 已实现并完成限定的独立单进程验证；[首轮](../evidence/final-validation/summary.md) 21/22，修正 fixture 与 SDK 参数修复计数后，[复验](../evidence/final-validation-r2/summary.md) 7/7。源码哈希在每次验证期间保持一致。
- 真实 SDK 0.85.1 / faux / fake Git 与 child 来源：[结果](../request-host-run-X60LCM/results.json)。封锁后仍多一次 queued 模型调用，但关闭请求内 child 为 0；下一独立 interactive 请求可启动一次。不能把该证据等同 CLI/TUI/0.69.0 launcher 验收。
- strict gate 首次在 sandbox 内启动受阻（[阻碍记录](../evidence/strict-review/blocked.json)）。
- 最终代码曾修正独立审查提出的 pending resume 和 typed terminal 分类问题；[r3 行为复审](../evidence/review-r3/behavioral-review.md) PASS。
- 2026-09-20 普通终端收尾：首次完整 release 失败（[release-run-LICUcN](../release-run-LICUcN/test-release.log)），根因是 `requestFor` 的 `previouslyManaged` 未按 (session, workspace) 命名空间判定，跨 workspace 首个 controller 误判为“记录丢失”并进入不可恢复的 persistence fault；已修正并加回归用例 `sibling-workspace`。两个 fixture 在切换 workspace 前后补设计内的可信输入序列，未删任何断言。`evidence.test.mjs:1532` 在基线上同样失败，属临时目录放在仓库内的环境问题，脚本改为 `/project/tmp`。复跑 [release-run-Xg0XFH](../release-run-Xg0XFH/test-release.log) exit 0。
- 真实 CLI + pi-subagents 0.69.0（print 模式）两场景见 [REPORT.md](../cli-acceptance/REPORT.md)；strict gate r4 见 [strict-verdict.md](../evidence/review-r4/strict-verdict.md)（PASS，无 findings；launcher 因父转述超时退出 124，child 结果与父的只读证明均来自原始记录）。总结见 [acceptance.md](../evidence/acceptance.md)。

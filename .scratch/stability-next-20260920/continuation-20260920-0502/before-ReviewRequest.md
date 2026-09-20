# ReviewRequest: P0 后委派与停止演进

Goal: 独立审查当前工作树相对于 85bdd2a93b994d3e4894e7534ab91cf6b16c9043 的产品改动，按 findings 的严重性给出 PASS / REQUEST_CHANGES / BLOCKED。必须区分产品缺陷、证据缺口与未实现范围，不沿用旧 P0 verdict。

Scope: 根目录所有修改/新增的 TypeScript、测试、package.json、README/CONTEXT 及 ADR-0006/0007。冻结清单 .scratch/stability-next-20260920/source-manifest.json；原始契约 spec.md。首轮冻结证据与 findings 保留在 review-r1/；本轮是 findings 修正后的 fresh 复核。辅助验收脚本 run-study.mjs、study-observer.ts、study-summary.mjs、study-summary.test.mjs、tui-driver.py、run-release-terminal.sh 和 terminal-validation.md 也可审查。不得修改文件、启动模型、运行 release、子进程探针或新建子代理（strict 父按全局协议发起一次 fresh reviewer 除外）。

User scope: 按顺序同步状态、简化委派/default envelope、验证停止、固定上游能力/路由、准备成本与读取政策对照。上下文见 docs/pi-planner-only-stability-and-delegation-plan.md。用户同意实施；没有提交/发布请求。

Implementation report:
- P1-A: 新 Task 定义保持显式；redelegate 使用 canonical 已存 TaskSpec，旧定义字段忽略并警告，host cwd admission 不放宽。有限默认100000 token/300000ms，可 operator 配置；显式 envelope 保留原维度。非法/不安全整数在分配 Task 前拒绝。
- Stop: closed Request 在新的 agent_start 重新 abort；SDK 0.85.1/faux 队列探针同时验证零额外 provider entry 和下一独立用户输入可运行。
- P2: operator role policy 默认关闭；启用时经 available registry 预检、公开 REQUEST 接线、terminal 实际身份比较，未知/不匹配不得接受 completed 报告；保留 usage 与诊断。
- P1-B: 0.69.0 无 partial grace/raw-invalid-output 契约；完整受权限约束的 report-only correction 未实现，保持待办，不宣称完成。
- P3: 普通终端三组 smoke/真实 TUI harness 与离线汇总，尚未运行真实模型；Idle 读取政策保持现状，决策等待对照证据。

Evidence:
- before-p1.patch / before-p1-status.txt; p1-a-implementation/ 为 Worker 自测历史。
- logs/final-checks.json：typecheck、P1/P2、controller、model policy、ledger、汇总等；exit 记录及同名 stdout/stderr。
- logs/final-host-checks.json：request-stop、revalidation、SDK/faux；SDK 原始 request-host-run-56ckjH/。
- logs/p1-p2-available-registry.stderr：一次 fixture 的 30ms Request 在 dispatch 前过期；将该场景 Request/envelope 调整为1000/10000ms保留先后断言；logs/p1-p2-available-registry-r2.* 为随后通过。生产截止未放宽。
- stage-2-3*.json 与早期 SDK失败保留；SDK首次仍断言旧额外调用1，实际0；第二次最终console变量错误，第三次修正。旧 P0 原始证据未改写。

Limitations: 当前为 sandbox agent executor。项目 AGENTS 禁止在此运行 test:release 与 spawn 子进程测试；只有原有 delegate.test 的语法检查。普通终端真实路由/TUI、成本对照与新源码 strict gate 没有当前通过证据。slot audit 还遇到共享 audit.log 只读，不绕过。独立静态审查不能替代这些门禁。

Protocol: /home/tcuni-claw/.codex/astra-planner.md；项目 .codex/codex-subagent-config-astra-planner.md 当前不存在。角色 astra_reviewer、fork_turns=none。禁止 /tmp；只读任务不创建产物。若必须重任务，先记录 slot audit/status，再走 slot，当前不授权此审查执行重任务。Return findings with source path/line, behavior, evidence and minimal correction; missing required executable evidence means BLOCKED. Never claim runtime read-only solely from role name.


## 修正轮 r2

前轮 findings: review-r1/verdict.md（完整原证据清单同目录）。修正：delegation-model.ts 独立使用 getAvailable 的精确 qualified identity，不复用旧 fuzzy alias matcher；collision/date/case 与显式 fallback 回归已加。README 旧默认模型说明已统一。release/study/strict 普通终端入口共用 slot-audit-gate.mjs，在 bypass/错误/未知格式时停止，纯函数边界回归已加。Root 同轮发现并修正汇总质量检查的数字前缀误判、invalid JSON 抛错漏记与 observer Request ID 字段名。

logs/review-r2-checks.json：修正后 typecheck、真实入口 fixture、slot gate、统计、脚本语法、diff 均 exit 0。当前 manifest 已更新，旧清单未覆盖；仍没有普通终端实跑、真实路由/TUI 或 strict PASS。请独立确认 findings 是否关闭及修正是否产生新缺陷，不携带前轮实现讨论。


## 修正轮 r3（第二次修正）

前轮 findings 与旧 manifest 保留 review-r2/。前轮两个 Major 已关闭，只剩中文 README 相同说明遗漏，本轮已同步。Root 同轮边界检查发现，新 operator 大数墙钟配置可触发 Node setTimeout >2147483647 溢出成1ms；delegate.ts 将初次和重置唤醒切成支持的最大延迟，保留完整 envelope/elapsed 判断不提前取消。真实入口回归验证大数 envelope 原样持久化、无取消、所有定时器参数在 Node 范围内。也补了 smoke 中被删除输出文件的失败保留、Root 观测到调用却缺 usage 的 incomplete 标志。

本轮重点复核 delta：delegate.ts 的两处定时器与新入口回归、README.zh-CN.md 说明、study-summary/run-study 的失败统计。其余产品未变。logs/review-r3-checks.json（typecheck/入口/diff）和 review-r3-support-checks.json（SDK、统计/语法）均 exit 0。r3-sdk.stdout 指向最新原始 SDK run；额外调用仍为0。产品/脚本重新冻结在当前 manifest；外部门禁仍明确缺失。

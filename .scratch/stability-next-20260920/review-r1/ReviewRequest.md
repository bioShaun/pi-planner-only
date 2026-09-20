# ReviewRequest: P0 后委派与停止演进

Goal: 独立审查当前工作树相对于 85bdd2a93b994d3e4894e7534ab91cf6b16c9043 的产品改动，按 findings 的严重性给出 PASS / REQUEST_CHANGES / BLOCKED。必须区分产品缺陷、证据缺口与未实现范围，不沿用旧 P0 verdict。

Scope: 根目录所有修改/新增的 TypeScript、测试、package.json、README/CONTEXT 及 ADR-0006/0007。冻结清单 .scratch/stability-next-20260920/source-manifest.json；原始契约 spec.md。辅助验收脚本 run-study.mjs、study-observer.ts、study-summary.mjs、study-summary.test.mjs、tui-driver.py、run-release-terminal.sh 和 terminal-validation.md 也可审查。不得修改文件、启动模型、运行 release、子进程探针或新建子代理（strict 父按全局协议发起一次 fresh reviewer 除外）。

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

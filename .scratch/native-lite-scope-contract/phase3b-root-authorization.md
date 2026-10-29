# Phase3a 两处时序例外批准与后续离线集成门

用户在本轮对 Phase3a Root 复核建议明确回复「按照你的推荐处理」。

## 批准范围

仅豁免既有 unbound/reload（重载后遗留未绑定记录拒绝）和 corrupt-state（损坏 JSON/schema 拒绝）两处守卫的测试时序缺口。保留 phase3a-root-review.md 与 phase3a-final-root-review.md 中的不合规事实；不追认为先红后绿，不扩大此前 checksum 例外，不豁免费用、传播、停止或清理证明。

允许继续离线集成。Phase3a 整体仍未验收，真实两臂校准均未启动，本批准不签发任何 provider launch gate，不增加 USD30 总授权。旧冻结材料不得覆盖或作为修改后 runtime 的启动凭证。

## 执行门

后续行为改动分为独立子任务：
1. 测试 worker 只新增/修改测试及必要纯 fixture，保存初始实现快照、实际 diff、原始红灯、命令退出码、hash，完成后退出。禁止实现变更，禁止删除/弱化旧断言。
2. 后续 worker 起步必须通过 contact_supervisor 阻塞请求 Root 检查上述文件。Root 亲自读取实际 diff、原始失败输出，确认失败来自缺少目标行为，才单独发放具体实现授权；未收到授权不得修改实现。
3. 实现只覆盖 Root 已接受的红灯；新守卫需先另行提交有效红灯并等待 Root 授权。完成后 Root 核对实际 diff、原始绿灯及费用，不以子报告自述代替验收。

第一小步 Phase3b：runner 启动监测接线。以真实 run-rpc-arm.mjs + 本地 executable fixture 证明每臂独立初始化 monitor state、向启动进程传递明确目录、加载 Root monitor 扩展，继承污染不能复用另一臂状态；初始化失败/已有状态不得覆盖或启动。仅离线测试；不宣称该 fixture 已验证真实 Native/Lite child 扩展传播。后续仍包括完整费用关联汇总、child 停止清理、真实委派路径的离线集成验证、适用 release 及重新冻结。

## 资源和预算

截至此前结算累计 known reported USD9.67524082（不含交互 Root，不与 reserved 相加）。延续 USD30 累计授权、USD26 reported 停止点和严格 <26 的共享预留门；共享账本本步只读。Root 为这次测试与实现子任务分配合计最多 USD0.75 的 reported 控制检查额度，取自原总授权，包含失败及收尾，不是新的总预算或真实 ledger reservation；达到检查点先停报结算，不自动清零。

cwd /home/tcuni-claw/pi/pi-planner-only，基线 HEAD e45b9d843acaa79ebbb914325b5a1033592b3f48，已有 dirty 内容全部保留。不提交/推送/安装，不改候选/产品源码/全局插件/真实共享账本，不运行真实 provider 或实验臂。所有临时文件放 /project/tmp 或项目子目录，TMPDIR/TMP/TEMP 使用仓库外 /project/tmp。重任务先读 ~/.config/agents/slot.md，每次启动前 slot audit/status 写项目日志，再 slot cpu/io 提交；并行工具不超过4，不再委派。

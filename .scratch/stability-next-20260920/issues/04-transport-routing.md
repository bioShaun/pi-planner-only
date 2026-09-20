# 04 上游兼容与模型路由

Status: ready-for-agent
Blocked by: none for the measured route; strict launcher completion tracked in 06

固定 pi-subagents 0.69.0，补 partial、run/session spawn budget 能力矩阵；各 counter/timeout/cancel 有唯一 owner。只走版本化事件契约，不 import 上游 raw TypeScript。模型路由从配置到实际 terminal/usage 身份闭环；缺能力显式失败，不能仅凭配置认定廉价 child 生效。

Completion: implemented and measured — 0.69.0 能力矩阵、owner 划分与 operator 路由接线完成；Kimi Root / Luna child 的单个真实路由 smoke 已通过。价格与普遍成本结论属于工单 05。

新 delegation-model.ts 与真实插件入口覆盖可用模型预检、显式 fallback、worker/reviewer、调用参数无法覆盖策略、actual model/thinking 不明或冲突拒绝报告但保留诊断。默认关闭。日志 logs/p1-p2-available-registry-r2.* exit 0；实际模型对照入口 run-study.mjs。

不新增重复 Request/session/run 预算 owner，不在旧协议上虚构 finish/grace，详见 transport-capabilities.md。廉价 child 的实际费用结论仍为空。

独立复核纠正：精确确认完整 provider/model，不复用会删除标点/日期的旧 alias matcher；碰撞/显式 fallback 回归通过，两项 Major 已由第二轮独立 reviewer 确认关闭，见 review-r2/verdict.md。

## Comments

2026-09-20：study-run-D1Lacq/ 的真实 Root 为 kimi-coding/kimi-for-coding，child 为 tcuni-luna/gpt-5.6-luna，requested thinking=low。正确 ANSWER=10、同身份 completed 终态和 usage 关联均通过；取消场景的 usage 另见 study-run-g9NOIF/。本轮严格代码审查和独立验收核验均 PASS；外层 launcher 超时独立记入工单 06，未冒称正常退出。

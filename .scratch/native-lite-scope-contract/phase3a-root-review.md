# Phase3a Root 复核：不验收，先修去重测试收窄

Root实读worker最终报告、cost-monitor.mjs、cost-monitor.test.mjs、cost-stop-host.test.mjs、wrapper实际diff、final-green.log和原始session工具记录。当前为离线组件，真实校准未启动。

## 核对结论

1. 功能证据：新monitor+registry与本地host聚焦15/15通过，相关controller/stage-a隔离既有依赖27/27通过。绿灯只支持这些fixture，不证明真实Native/Lite传播、请求身份完整关联或停止清理。生产runner尚未初始化monitor state且未完成Root+child汇总/停止接线，不可运行实验。
2. 新时序违规属实：2026-10-28T09:22:34Z初始monitor已含无绑定记录/不同实例及损坏JSON/schema拒绝分支；对应unbound/reload及corrupt-state测试于09:28:02Z才添加。缺少实现前有效红灯。此前用户仅豁免checksum，不涵盖本次；Root不接受本组件为时序合规，不后补重放伪造时序。
3. 去重测试被收窄：09:23:13Z原测试每次调用handlers.message_end({message})与turn_end({message})，包装对象每次新建但消息与entry身份相同，期望仅一条记录。09:23:34Z改成缓存messageEvent/turnEvent并反复传入同一对象；09:24:03Z实现WeakSet（后改WeakMap）只按事件对象去重。两种测试不等价。report称早期red“equivalent”不准确；恢复原场景，不删现有同对象及冲突断言，再以有效行为红灯修复。
4. 初始快照遗漏untracked host test；原始SHA及此前内容仍有证据，允许按只读历史恢复并验证hash，不允许重建后声称当时已快照。该证据问题与TDD违规分别记录。

## 费用结算

worker97f34ccf已退出，session按assistant entry id去重38条，重复0，缺费0。本次reported USD0.20410620。前阶段累计USD9.32991182加本次后known reported USD9.53401802；session SHA256 6c4cd68f8be1fff4a80d6405dc8940c9d924350e831158fac780b365cbe8f629。新控制步USD0.75检查额度剩余USD0.54589380，恢复后整session重新去重替换，不重置额度/重复加快照。

## 下一步仍在既有授权内

仅恢复原去重测试语义，记录当前实现对新包装/同message/同entry会重复的行为红灯，再修复以正确身份去重；不得把不同真实消息仅因内容相同合并。保留现有同对象冲突测试及host相同内容不同entry测试。必要的身份分支均先新增有效红灯再实现。修正报告对于“等价红灯”的说法，保存旧报告/旧测试以追溯。不开真实provider、不改候选/guard/账本/全局，不进入cleanup或批次冻结。

这是功能修正授权，不是对新测试时序违规的豁免。此次unbound/reload及corrupt-state时序缺口继续单独阻塞最终验收；先使功能与测试可审查，再决定需提交用户的精确例外问题。Root不批准删除守卫或重演开发以制造历史合规。

# 日常观察：尚不足 2 个真实任务

状态：**incomplete**。本次用户要求执行整份计划，记作一个真实维护任务 O1；不能把其中同步、归档、审查阶段拆成多个独立样本以满足数量。后续还需 1–2 个真实任务。没有配对实验结果。

## O1：计划执行与同步、证据归档

选择方式：Native subagent workflow；理由是已有授权的 worker 准备后依赖其候选进行 fresh reviewer 审查，存在真实顺序依赖。当前会话插件模式的持久状态与加载版本 unknown，工具调用可证明使用 Native 工作流入口，不能据此补写加载证据。

初始 SHA `3db1846aedb23a6b5552f69ffb70b552cdb94c7a`，同步候选 `f818cc91c98d6129a152fb28161e00d2f601e494`。工作流 `2214029c-2ab9-471f-8e5b-e778cc863edf`；准备 child `5b53303e-deeb-4137-988a-38b3459d4969`，审查 child `ddf3e9be-8f0d-4a01-9715-07fdcecf85cd`。模型配置候选见 [protocol.md](protocol.md)，实际执行消息与用量尚未做完整日志对账。

实际问题：reviewer 只能读文件、不能运行 shell，未独立执行 Git/哈希/测试命令；其报告明确此边界。Root 将“命令复核”交给这个角色的 brief 与该角色工具权限不匹配，属于调度干预记录。reviewer 正确发现准备交付缺少可移植的实际命令输出，给出 BLOCK；Root 随后亲自读实际 merge 对象和完整 diff，并要求 worker 补齐命令证据。此失败保留，不改写为首轮成功。

实际执行 receipt 确认准备 worker 为 `tcuni/gpt-6.1-terra:medium`、reviewer 为 `tcuni/gpt-6.1-sol:high`；这证明模型选择记录，不证明 provider 内部 reasoning 执行。Root 实际模型及完整用量尚未对账。

返工：一次证据补齐委派 `b034a4f8-93c1-4bf7-816e-c0e70d8ca87c`（最终结论见最终验收）；不涉及产品行为修改。首次两阶段顺序执行，无声称计算并行或并发收益。最终文档收尾再复核链接，属于检查收尾而非新的独立任务。

用量：Root/worker/reviewer 的 input、output、cache read/write、实际费用、完整用户端墙钟均 unknown（未完成日志覆盖与账单口径核验），不能用零代替。准备和审查属于实际维护，不能并入未来两臂实验。supervisor 没有真实待决请求，回复链路未验证。

任务最终验收、提交与剩余阻断见 [recommendation.md](recommendation.md)。后续 O2/O3 尚未发生，不创建模拟成功样本。

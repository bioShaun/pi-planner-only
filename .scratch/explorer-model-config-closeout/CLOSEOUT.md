# Explorer 模型配置收尾记录

日期：2026-09-18。结论：本地已确认缺陷已修复并通过独立定向验证；**最终交付仍为部分完成/验收阻塞，不可发布为三个工单全部完成**。

## 已落地

- scout 标准定义发现、builtin thinking=low、builtin 项目覆盖整体替换、custom 覆盖逐字段合并；保留显式 inherit、false 删除和 provider 覆盖语义。
- 模型字符串完整交给宿主解析，移除错误的本地精确匹配；模型不可用由 native launch_failure 显式报告，不静默换 Root。
- 已知配置字段和 scout 元数据校验；有效 broad capability 配置仍仅投影 model/thinking。
- Explorer 模块纳入加载指纹并覆盖回归；测试临时目录改为项目内并清理。
- 验收脚本每次使用独立运行目录，清理敏感配置，保留脱敏元数据和原始 session，校验真实 execution.runId 与已接纳报告；删除旧凭据副本并补全忽略规则。
- 已同步修正本地三个已发布工单、三个草稿及验收 REPORT/summary；保留历史原始日志与账本。

## 当前证据

[定向独立验证](final-focused-report.md)：Explorer、delegate、rs01 和 typecheck 均 exit 0，git diff --check 通过。对应代码哈希：[after-config-correction2.json](after-config-correction2.json)。红测试：[配置语义](red-r1-r3.log)、[非法配置](red-config-validation-round3.log)。

[全量发布检查](final-validator-report.md)：npm run test:release exit 1（3.710 秒），停于未改动的 task.test.mjs:287。独立 allocator 探针证明创建了不同 ID，但 Node console 的 pipe 输出丢失；fs.writeSync 与常规文件输出正常。此问题未修复，余下套件未运行。本次不改无关的 allocator 或放松断言。

[真实宿主验收](../explorer-model-config/evidence/REPORT.md)：历史运行确证模型/thinking/只读边界，但报告 runId 不匹配，Task changes_requested、reports=[]。当前收尾版本未重新运行宿主，旧证据不能当作当前版本通过。

## 未关闭条件

1. 票 01：原规格完整宿主兼容性仍未满足。当前仅针对 pi-subagents 0.68 核对的有限投影；复杂 frontmatter、包贡献 plain scout、额外扫描目录，以及 defaultProvider/modelScope/maxThinking/disableBuiltins=true 等有效宿主配置明确拒绝。依赖范围其他版本也未验证。需兼容实现或受支持的轻量发现/投影接口；不能把拒绝当作支持。
2. 票 02：本地生命周期用例已通过，依赖票 01 以及完整发布/真实宿主验证后才能关闭。
3. 票 03：需上游在子会话报告前提供真实 runId；不能猜测、回写或放松身份校验。该接口到位后针对最终源码重跑并取得已接纳报告。
4. 环境：修复子进程 stdout 捕获异常后重跑完整 release。slot jobs/audit 目录只读、cpu.socket EPERM 阻塞需排队的真实宿主和独立 strict 只读 launcher；见 [slot 失败日志](../explorer-model-config-review-20260918/release.log) 和 [预检查](../explorer-model-config-review-20260918/preflight-validator.log)。未取得 runtime permission proof，因此不得将行为只读复核写作 strict gate PASS。

## 独立复核

安全清理与验收脚本纠正复核已通过（行为约束只读）。配置纠正的最终独立复核结果记录于 correction-review.md；其结论仅适用于明确覆盖的配置子集，不表示原规格或最终验收完成。

未提交 commit、未发布版本。用户原有无关事件目录保持不变。

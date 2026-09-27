# 04：澄清 T2/T2b 无 ALT 空表分支的任务文案

Status: needs-triage
Type: task
Execution: 真实运行暴露并经独立核对确认；原任务与原始证据未改。

T2b 继承 T2 的“运行前断言 13 个来源列都在，缺一即抛”，但目标测试 `test_both_sides_ref_produces_no_alt_rows` 在没有 ALT 需求时传入零列空表并期望生成 REF 行。不可变 gold 也只对非空 aligned table 检查来源列。第二个 worker 因这项冲突请求 supervisor 决策，Root 裁定保留该测试要求；不能据此断言模型违反了明确一致的任务定义。

证据：execution/intercom-receipts.json、原始 JSONL 的 subagent_supervisor_request/reply、execution/instruction-evidence/task-fix1.md、execution/independent-validation.txt，以及 T2b target `46d408a34211bf39558430342abc97bc71e655f8` 的 stage 与目标测试。

下次付费运行前，明确区分无 ALT 需求且空宽表、需要 ALT 的空/缺列宽表、非空宽表三类输入的验收规则，对照现有 gold 和独立目标测试核实；必要时新增独立故障用例，不能为让某次模型产物通过而削弱原断言。

若改提示词或验收条件，用新任务版本并重新冻结，不覆盖原 T2/T2b，也不混算不同任务定义的配对结果。此票不包含付费模型调用；不修改已停止的样本来追认通过。

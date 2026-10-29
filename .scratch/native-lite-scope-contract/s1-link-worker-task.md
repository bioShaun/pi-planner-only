# S1 最小真实链路执行交接

cwd /home/tcuni-claw/pi/pi-planner-only；当前 dirty 工作区不能重置/提交/推送/安装。你是唯一执行 writer；Root 负责决策、diff 和证据验收。先读 AGENTS.md、CONTEXT.md、.scratch/native-lite-scope-contract/{checksum-exception-and-s1-authorization.md,root-review-final.md,protocol-v2.md,preflight.md,prepare-batch.review.mjs,arm-preflight.mjs,run-arm.review.sh.txt,calibration/inputs/S1-link-task.md}、.scratch/native-lite-budget-scope/{authorization.md,final-acceptance.md}，按需读既有 controller 与预算规则。

用户已批准 checksum 测试时序一次例外及推进 S1 两臂校准；不需再次询问用户。但每个真实实验臂必须先通过 contact_supervisor(reason=need_decision) 向交互 Root 提交具体冻结材料和命令，等待本臂明确批准；不要把阶段授权当单臂 launch gate。使用该原生通道；若不可用，保存准备报告并终止，不启动。单一子任务覆盖准备→Root gate→S1-native→Root验收/gate→S1-lite→最终证据。不得另外启动控制子代理；仅既定实验 RPC runner 可按授权拓扑创建实验 child。

第一阶段：保存初始 git status/diff 及本轮 scope-contract 文件快照/hash 到全新 /project/tmp/pi-native-lite-s1-link-control-<unique>/，不覆盖旧证据。使用已验收 prepare-batch.review.mjs 准备唯一新 calibration batch/attempt，显式 S1-link 与 S2-topology 模板，已有脚本若生成四个壳仅属模板准备，S2绝不执行。只使用原候选 f818cc91c98d6129a152fb28161e00d2f601e494，Root tcuni/gpt-6.1-terra high、worker tcuni/gpt-6-luna medium；S1恰好一名worker、成对同字节brief。冻结实际 runtime/config/controller/brief/workspace、manifest/runtime-lock。核对真实共享ledger前缀及checksum、当前reserved、无锁；不手工改账本，不退款/追加控制事件，不清锁。保持原历史报告与失败批次不变。记录目前本控制会话原始 session 路径与去重费用，历史 known reported USD8.01491262，不重复累计快照、不加 reserved。累计授权USD30、reported USD26停点，请求reserve严格<26；每臂reported USD1.25停点、300000ms deadline，控制会话USD1.50检查点。提交确切费用监测/停止办法，若现有执行方式不能落实停止要求，先向Root报告，不悄悄放宽。

预检仅运行本新批的真实 per-arm checker，读取生产依赖，不复跑已通过且无新变更的整套release。准备/环境漂移或命令失败即停并报告，不自动改实现、不变更运行依赖以绕过检查。记录两臂manifest、brief、runtime-lock hash、每臂预检原始输出/exit、候选、账本和锁状态、费用余量、实际slot audit/status。准备好后 contact_supervisor 送报告绝对路径及S1-native具体命令，等待Root亲自审查。

单臂执行：Root明确批准后使用既定slot+RPC harness一次；不切其他CLI。run-arm.review.sh.txt有LAUNCH确认，只有Root审查本次audit/status并明确批准才能输入；若gate后的新audit/status有变化应再请求Root。不改变controller/guard/插件。先native，原始终态/内容/usage evidence全齐后报Root，Root验收并明确第二臂gate后才lite。任一失败/超时/停止线/锁/漂移/不明费用/报告或角色异常停止全批，不重试，不自动修复。保留本臂实际命令cwd/env、开始结束/exit/wallclock、raw session、provider fingerprint及账本事件关联、child创建身份/唯一runId/异步终态、报告bytes/hash、实际实验Root acceptance JSON/理由、Root/child费用去重与缺失情况、候选与所有冻结输入保持验证，三个结果层分开记录。本轮是链路校准，正式样本/完整pair仍0；不能推出优劣或复杂语义已通过。

所有临时文件禁止/tmp；放/project/tmp或项目子目录；TMPDIR/TMP/TEMP外部，实验子进程按已验收runner使用新batch/tmp，核验realpath。重活预计>1min或>2G或大量/data_0 IO，首次先读 ~/.config/agents/slot.md，每次启动前slot audit、slot status写入项目日志，经slot cpu/io/gpu/nf提交；不调大槽、不杀他人进程。并行工具<=4。

本任务不授权行为变更。若必须修改，停报Root；任何后续获准行为变更必须先只写测试并运行，在报告贴出因缺失行为而失败的真实输出，再写实现并贴通过输出，不能以语法/导入失败或事后重放当红灯，不删除/弱化既有断言，新增guard必须故障注入。纯记录无需写测试。

最终报告必须含改变文件、实际diff位置、各命令/exit和原始证据路径/hash，校准每臂三个结果层、全部费用及账本前后/锁状态、所有子进程终态，以及未完成/停止原因。可在scope-contract新增本轮校准记录，不改写旧证据，Root最终复核由Root写。所有可执行实现和测试都由你完成，Root只读验证。

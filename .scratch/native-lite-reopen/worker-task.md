# 新批次执行交接（Root → worker）

用户要求继续下一步，实现与测试交给子代理，Root 负责拆分、git diff 和测试证据验收。你是唯一写者。cwd `/home/tcuni-claw/pi/pi-planner-only`，当前基线 HEAD `27c316574a02c17c877c75d4b34437ca53920bee`（先核实）。主目录有大量历史未跟踪文件，不清理、不覆盖、不提交、不推送、不安装或 reload。

## 先读

- `AGENTS.md`、`CONTEXT.md`
- `.scratch/native-lite-lifecycle/acceptance.md`、`offline-batch-template.md` 及实际 runner/observer/guard
- `.scratch/native-lite-comparison/protocol.md`（旧批次停止，保留其已授权模型、场景、预算与顺序）
- `.scratch/native-lite-comparison/batches/20261028T054700+0800/closeout.md` 及 retry1 配置/执行证据（只读复用准备方法，绝不重新启动旧批次）
- `~/.config/agents/slot.md`

## 权限及边界

只可新增 `.scratch/native-lite-reopen/` 中本次准备脚本、证据入口和记录，以及新的 `/project/tmp/pi-native-lite-<timestamp>/` 外部批次、独立 worktree、日志。已验收生命周期控制器先保持原字节，若必须改变行为，先停向 Root 报告，不能边实验边修。不要修改产品代码、全局配置、旧账本事件或旧证据。外部共享历史账本只允许 Root 审查具体承接方案后追加预留；不得复制成新账本、归零、退款或改旧前缀。

允许按已冻结 RPC harness 执行真实实验（这是原定实验入口，不是子代理启动失败后的替代 CLI）。不要另启非协议子代理或把本次控制 worker 算入样本。你自身只负责准备/执行控制命令和证据收集；实验 Root/children 由受控 harness 产生。上级亲自审查各阶段，不能由你自批自跑。

临时/中间文件禁止 `/tmp`，使用本次外部目录；TMPDIR 必须在仓库外。超过1分钟、2G内存或大量 /data_0 IO 的命令必须先保存 `slot audit`、`slot status` 到本机项目日志，再 `slot cpu|io -- ...`（长任务可 -b）；不调整槽位、不杀其他任务、不补做审计。同时最多4个工具调用。测试全部由你执行。任何行为变更脚本或 guard 必须先只写针对缺失行为的测试并运行，保留原始红灯（不是语法/导入错误），再实现并保存绿灯。不得删弱断言；新增 guard 加故障注入。纯静态配置/文档不需造测试。

## 阶段 A：离线准备，先交 Root 门禁

1. 核对当前 HEAD/status、已验收控制器最终哈希、实际运行依赖与费率；从 protocol 和原批次得到正确配置，不能从 dirty 全局插件猜基线。四臂候选固定 `f818cc91c98d6129a152fb28161e00d2f601e494`，独立外部 worktree。Root Terra/high，worker、oracle、reviewer Luna/medium。S1 exactly worker；S2 validator→oracle + reviewer，reviewer 无 shell，validator 可检查。保持已授权任务正文，成对 brief 同字节，仅路径和验收契约按新模板完善。顺序 S1-native → S1-lite → S2-lite → S2-native。新 attempt 不用 retry1。
2. 预算：已知控制 4.58301852，历史实验 0.05930370，已知合计 4.64232222（主会话未知，不是账单）。历史共享账本 `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json` 原19事件/预留4.60623375，原sha256 `dc9e71b30b194b79ce1a15c09500341e74b90ab17904e84e7ade55878616cf5e`。重新核对。已知控制超 seed 1.58301852 必须承接，另建议本轮新增控制预留 US$1，最终去重核对实际会话费用，若超过再追加。不要把实际费用与已有预留重复叠加。US$16 请求停止线、US$20 上限和US$4余量不变，失败不退款。先提出精确追加事件/总额/旧前缀证明及新脚本的离线测试证据，不先改真账本。
3. 新批次需要冻结配置、依赖/工具/能力/模型、源码、忽略文件（尤其 .pi/settings.json）、brief、公共S2 diff和独立manifest。runner只覆盖非ignored候选内容，ignored配置必须额外冻结并在执行前/后核对。避免把历史brief路径带到新CWD。提供确切启动命令、cwd/env、timeout、output不覆盖检查，所有日志在外部。
4. 执行必要离线预检，复用已绑定的最终15/15及release证据，只有发生变更或需核对真实配置时补测。绝不把离线预检作为样本。所有命令记录 cwd、起止、exit 与原始日志；不要用 *.test.mjs 误跑历史故意失败文件。任何产品/控制器行为变更必须向 Root 阻断报告。
5. 把准备报告写到 `.scratch/native-lite-reopen/preflight.md`，列精确可审查路径、hash、差异、预算方案、测试与局限。通过 `contact_supervisor(reason:"need_decision")` 发送 Root 门禁请求并等待明确答复；不要结束任务、不要自行启动实验。该工具如果不可用，停止并报告，不静默继续。

## 阶段 B：Root 门禁后执行

仅在上级明确批准具体承接与首臂后，原子追加真账本并核对旧前缀，冻结其后manifest。如准备时脚本已变更，先将最终变更证据交Root。启动 S1-native 一次，20分钟上限，保留真实 session、provider payload 指纹、模型/thinking、child launch/status/process-terminal、Root acceptance、report hash、候选/config不变、共享账本一致性与成本。必须核对 guard/fingerprint 必需 child extensions 实际传播、所有 Root/child provider 请求覆盖；任何缺失/失败/超时停后续臂。不要重试或变换 CLI。

每臂完成后整理本臂原始证据与结果，发送 `contact_supervisor(reason:"need_decision")` 让上级验收并明确下一臂，不自己连续启动。如Native真实链未通过，结束本次实验启动，保留失败和费用、记录下一步具体阻断，不擅自修复或追加请求。

全部四臂完成或停止时，汇总有效样本/成对完整性、质量与可比边界、分角色tokens/费用/墙钟/人工干预。控制费、历史实验与新实验分列；保留未知主会话与最终账单限制。费用按唯一session/message去重，返回本控制worker会话路径供Root最终核对。报告实际改动、命令、exit、hash、失败和stop状态，不做超出样本的优劣推断。

最终输出短中文报告及所有证据入口路径；持久最终报告由 launch output 参数绑定。不执行提交、推送或全局安装。

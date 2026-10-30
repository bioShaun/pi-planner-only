# om36 会话 01a18d37 复盘：herdr-fleet #24–#27 叠放链（2026-10-30）

样本：om36 `~/.pi/agent/sessions/--home-glx-scripts-tc-skills--/2026-10-30T14-30-10-527Z_01a18d37-*`（原始 jsonl 在 `snapshot/`，不提交）。时间线由 `timeline.py` 生成（`timeline.txt`、`timeline-text.txt`）。

环境：Root 为 `claude-sonnet-5-5`，模式 **native**（第 4 行 `{"mode":"native"}`）。插件为 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only` 的 e1d0ab6，即本仓库当前 HEAD。Root 引用的"委派规则"就是 `index.ts:30` 的 `NATIVE_PROMPT`。om36 上没有 `~/.pi/agent/AGENTS.md`，因此也没有 reviewer 时机规则。

## 事实

- #26 首次派出 76 秒后，worker 只写了一条红灯测试就结束，没有请求拆分（第 46 行）。Root 按 NATIVE_PROMPT 中"只交回部分结果时先缩小范围"，续用该 worker，分三段交付（15:00、15:05、15:10），三段都一次通过。这条规则这次是有效的。
- Root 对 #26 各段和 #27 只做了自查（"diff 没问题"，第 53、59 行）。直到 16:13 用户说"继续推进"之后，才第一次派独立 reviewer，此时四个 PR 已经全部叠好。reviewer 结论为 BLOCK，含 P0 三项（F1–F3）。
- 修复分三轮串行（16:22 F1+F5、16:27 F2+F4、16:33 F3），每轮约 5–6 分钟。前两轮改的是同一个 `fleet.py`，验收命令都是全量 pytest。Root 在第 239 行一次性列出三轮计划，并不是因为子代理只交回了部分结果。NATIVE_PROMPT 中"共用同一验收命令的步骤合并"与"有各自测试且互不依赖的部分分开"指向相反，Root 选择了分开。
- F3 需要先抓真机载荷，再由 Root 定规则（16:32–16:33）。单独拆出一轮是合理的。
- 16:39 先把 #33 rebase 到 #32；16:46 复审发现 R3；16:55 修复后，16:59 再 rebase 一次。如果先复审 #32 的修复 diff，再 rebase #33，可以省掉一次 rebase。
- reviewer 没有 shell，审查开始后通过 supervisor 求助，Root 临时把 diff、issue 和 spec 导出为文件（16:13:53，第 229 行）。复审时 Root 已提前导出（第 266 行）。

## 可写进插件的候选（仅 Native 提示词；Lite 本次未使用）

1. 依赖判定：同一文件或同一状态/锁逻辑上的多项修复视为相互依赖，合并为一次委派；只有需要等待新事实或用户决定的项单独派。
2. 审查时机：涉及并发、锁或持久化状态的改动，验收后先派独立 reviewer，再在其上叠加后续工作；Root 自查 diff 和测试不能代替审查。
3. reviewer 材料：reviewer 没有 shell，派出前把 diff 和依据导出为文件，并在任务中写明路径。

不建议写入插件：叠放分支的 rebase 顺序（过于具体，第 2 条已覆盖其根因）；修改"部分结果→缩小范围"规则（本次有效）。

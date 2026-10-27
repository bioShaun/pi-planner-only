# Native/Lite 执行委派（Root brief）

用户授权执行 docs/native-lite-execution-plan-2026-10-27.md；实现与测试交给 child，Root 负责拆分、diff 与证据验收。本轮是实际维护，不是配对实验。

## 边界

仓库 /home/tcuni-claw/pi/pi-planner-only，初始 main HEAD 3db1846。先读 AGENTS.md、CONTEXT.md 和计划。唯一写者是你。仅新增 .scratch/native-lite-comparison/ 内证据与文档；既有未跟踪文件全部保留、不覆盖。可在 /project/tmp 下建独立 integration worktree 并执行本地 merge commit；不得修改主分支 HEAD、暂存主仓库、提交主仓库。不得产品改动、安装、reload、push、release、切换模式或发起配对实验。若冲突或远端新增产品修改，保存证据并停止 P1 的 merge，仍可盘点不依赖它的证据。

临时文件禁止 /tmp，使用 /project/tmp/pi-native-lite-20261027/，TMPDIR 也指向外部目录。预计 >1 分钟、>2G 或大量 /data_0 读写的命令必须先读 ~/.config/agents/slot.md，执行 slot audit / slot status 并把输出保存在本地日志，再用 slot cpu/io/... -- 命令。原始资源日志含其他任务信息不得入库。单轮工具并行 <=4。不得再委派。任务若意外需要行为修复先停报；任何已授权行为修复都要求先写测试并运行，保留因缺少行为而失败的红灯，再实现及绿灯；新增 guard 必须 fault injection，不删弱断言。

## P1

保存 HEAD、原 origin/main、merge-base、git status porcelain（含未跟踪）、index tree、tracked diff、未跟踪文件指纹（排除巨大缓存，只列边界与覆盖限制）。fetch origin 后重新核对远端 log 与净 diff。用实际当前 HEAD 建外部 worktree + 唯一集成分支 native-lite-integration-20261027（存在则不要覆盖，选新后缀）。预期远端净差仅 CHANGELOG.md 四行；如果属纯文档可 merge --no-ff origin/main 保留两边祖先；记录父提交、实际净 diff 和 git diff --check。不要更新 main。

复核 .scratch/reviewer-range-integration-20261027/combined-source-manifest.sha256 对集成候选的 192 项指纹、测试/锁文件与原证据。必要时核实依赖/验证环境；来源不完整不能声称完整复用。纯文档不跑产品 release；若需重新 release 必须 npm run test:release:isolated、外部 TMPDIR、slot 与退出码，不能修改全局安装。保存 sync.md 与精简的可移植检查记录。

## P2

盘点计划列出的本地研究、reviewer 集成证据、Native 临时验收，区分 committed、untracked、machine-local、future。在 evidence-index.md 记录来源、commit/sha256、关键命令/退出码与限制。把有价值的未跟踪研究及 Native 关键验收做最小安全归档副本到 archive/；绝对本机链接只标补充，不作为唯一证据。保留原字节或明确摘录/脱敏，指纹可追溯，原件不变。不要提交会话全文、凭据、其他任务数据。对所有新增 Markdown 本地链接做实际检查并保存命令、stdout、退出码。归档原文含历史绝对链接可明确列出不可移植限制，提供新入口内可移植证据。

## P5

只读核实源码版本、实际安装位置/版本/source 指纹和与当前候选差异；仅读取非敏感配置字段，不输出全套设置或认证信息。记录当前可见工具与模式观测，区分配置值与活跃加载证据、unknown。不 reload。写 native-runtime.md。supervisor 无真实请求就写未验证，不人为制造。遇到确实需 Root 决策可以正常 contact_supervisor。

## 交付

sync.md、evidence-index.md、native-runtime.md、archive/ 和必要脱敏日志/manifest；记录新分支/worktree/SHA、每条检查命令和 exit。最后提供任务结果、是否阻断、改动文件列表与需要 Root 判定的具体问题。不要把普通准备工作当配对结果，不虚构费用/耗时。工作尽量有界，约 15 分钟内完成能完成的部分，缺失资料明确记录。

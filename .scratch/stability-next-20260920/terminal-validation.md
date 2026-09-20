# 普通终端验收入口

Release 已在普通宿主环境通过（release-run-dWGu9v，exit 0）；真实模型、TUI 与 strict gate 的结论分别以各自运行证据为准。按顺序在普通终端/CI 或已确认解除沙箱限制的宿主执行环境运行；不要从受限 sandbox agent executor 运行。2026-09-20 权限调整后的子进程 stdout、PTY、/project/tmp 和 slot 预检通过，证据在 continuation-20260920-0502/host-preflight.json。每次重任务脚本均先记录 slot audit/status，再验证 audit 内容没有绕过进程/错误且格式可识别，才进入 slot cpu；若审计发现其他绕过 slot 的重进程，等待或降低本任务并发，不终止它们。运行前可用 `slot audit` 和 `slot status` 人工检查。禁止 /tmp。

## 1. 新版本 release

```bash
bash .scratch/stability-next-20260920/run-release-terminal.sh
```

要求：exit 0，源码前后哈希一致。新 test:p1 已并入 test:release；保留每次失败，不用 P0 的 33 文件通过替代。

## 2. 固定版本对照及实际模型路由

需已配置且可用的 Root 与 child 模型；不把模型名字里的 small/luna 当作价格证据。脚本通过必填变量避免擅自决定模型/费用，基线 commit=85bdd2a、host=0.85.1、launcher=0.69.0 固定，版本漂移直接退出。

```bash
export STUDY_ROOT_MODEL='kimi-coding/kimi-for-coding'
export STUDY_CHILD_MODEL='tcuni-luna/gpt-5.6-luna'
export STUDY_THINKING=low
node .scratch/stability-next-20260920/run-study.mjs
```

默认三组 × 三个隔离小任务：直接 Root、85bdd2a 委派、当前委派；词数、JSON 查询、单字段修改。每个运行最多 300 秒，串行 slot。`STUDY_ARM=optimized STUDY_CASE=count` 可先验证一个真实路由样本；随后完整运行保持相同版本/模型/题目，不选择性丢弃失败。默认每格一个样本只能用于 smoke，不能支撑总体节省或默认政策决策。正式对照应事先固定重复次数、交错组序、冷热缓存条件及价格表，再采样。

本轮先执行用户选定模型的单个真实路由 smoke，再执行下节 TUI 停止验证；不将这两个样本作为完整成本对照。

真实凭据和 runtime 放在权限 0700 的 `/project/tmp/planner-study-*`；复制的 models/auth 文件权限 0600，不进入仓库证据。结果位于本任务 `study-run-*`；不要把私有 runtime 整体打包或提交。观察文件只记录身份、usage、调用和答案。

验收时核对：质量检查、实际 Root/child 模型与 thinking、所有 child claim 都有带 usage 的关联终态、失败/取消尝试被计入、缺失 usage 明确标出。费用始终 null，直到可信价格补齐。当前脚本不对真实价格作网络查询，不自动宣称廉价路线省钱。普通运行的单个 child CANCEL 不计为 Root closure。

## 3. 真实 TUI 停止

```bash
node .scratch/stability-next-20260920/run-study.mjs --tui
```

真实 pi 交互模式进入 PTY，Request 截止降低到 45 秒，child 任务包含 sleep 90。要求实际 hasUI、Request closure、同身份 CANCEL/cancelled terminal、agent_settled，以及关闭后 model hook/tool/REQUEST 均为 0。随后观察 3 秒安静窗口，再发送 Ctrl-D；窗口前强杀、无终态或没有进入真实 TUI 一律 NOT_PROVEN。整个驱动上限 150 秒，清理只针对自建进程组，不冒称已证明任意 shell 孙进程死亡。此场景验证 deadline，不覆盖所有排队/定时输入组合；SDK 队列场景另见 sdk-stop-probe.mjs。

## 4. 新源码 strict gate

使用本目录 ReviewRequest.md、source-manifest.json 与上述新日志。先将普通终端新结果位置追加到审查请求，再执行：

```bash
bash .scratch/stability-next-20260920/run-strict-terminal.sh
```

按全局协议核对父/子实际只读探测、fresh reviewer verdict、源码无漂移及 launcher 退出状态。缺 release/真实宿主证据不得以静态 review PASS 代替；当前旧 P0 的 strict PASS 不覆盖工作树。

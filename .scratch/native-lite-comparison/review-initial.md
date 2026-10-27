## Review

**结论：BLOCK。发现 1 项 P1 证据交付缺陷；没有发现已经证实的错误 merge、产品改动或隐私泄漏。实际 merge parents、完整净 diff 和指纹复算仍有 unknown，不能给出完整 PASS。**

本次为独立只读审查，范围是 `.scratch/native-lite-comparison/`，对照执行计划与 `root-brief.md`。未修改文件、提交、安装、reload、运行产品测试或再次委派。

- **Correct：主分支与外部集成分支的引用符合边界。**  
  独立读取 `.git/HEAD`、`.git/refs/heads/main` 和 main reflog，当前 main 仍为 `3db1846aedb23a6b5552f69ffb70b552cdb94c7a`，最后一条 main reflog 是原 Native 提交。集成分支引用为 `f818cc91c98d6129a152fb28161e00d2f601e494`；其 reflog 记录先从 `3db1846` 建分支，再 merge `origin/main`。worktree 元数据指向 `/project/tmp/pi-native-lite-20261027/worktree/`。这些证据支持 [sync.md:3](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/sync.md:3) 的主分支边界；不等同于已验证 commit 对象中的两个 parents。

- **Correct：历史 release 输出存在，复用范围表述克制。**  
  独立读取历史 `release-combined.log`，确有 isolated release、typecheck、CLI 7/7、contract、git/reviewer-range、delegate、host、host-runtime 5/5、handoff、status-color、index 的通过输出。日志没有嵌入 shell exit，退出 0 来自历史 acceptance；新入口如实说明这一限制。[sync.md:8](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/sync.md:8) 也明确未证明完整依赖／环境一致，没有将历史绿灯夸大为当前安装验证。

- **Correct：归档没有把历史材料包装成新实验。**  
  已读取六份归档正文，未见凭据、完整会话或其他任务资源日志。Native 原 acceptance 仍可读取，正文与归档副本目视一致；字节级相同及 SHA-256 尚未独立复算。绝对路径和本任务 run 标识仍存在，但已标为历史、本机补充来源。原文中出现 `/tmp` 是历史状态描述，不是本次执行输出路径。

- **Correct：安装状态与加载状态分开。**  
  独立读取安装 checkout 的 main 引用及 `package.json`，分别为 `8168e126…`、`0.9.0-lite.0`；安装的 pi-subagents `package.json` 为 `0.83.0`，与 [native-runtime.md:4](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/native-runtime.md:4) 一致。[native-runtime.md:6](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/native-runtime.md:6) 正确将活跃模式、加载版本及真实 supervisor 回复链路标为 unknown／未验证。

- **Fixed：无。** 本次审查不修改仓库。

- **Finding：P1 — 本轮关键检查未保存可移植的实际输出，无法完成要求的证据验收。**  
  位置：[sync.md:7](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/sync.md:7)、[sync.md:8](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/sync.md:8)、[evidence-index.md:17](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/evidence-index.md:17)、[native-runtime.md:4](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/native-runtime.md:4)。

  `sync.md` 给出了 parents、仅 CHANGELOG 四行变化、候选 191/192 等结论，但交付目录中没有这些检查的实际输出。所指本机目录目前只有 `initial.txt`、`base-manifest-check.log`、`untracked.sha256`、`untracked-recheck.log`、`link-check.log` 和 worktree；其中 base 日志仅有逐文件 `OK`，没有命令、cwd、时间和 shell exit。候选的 manifest 失败输出、实际 merge diff／parents 输出未保存。运行安装清单也缺少完整命令及对应输出；证据复制检查仅写成泛称 `sha256sum exit 0`。

  这与执行计划“完整日志保存真实命令、cwd、环境、时间与实际 exit”，以及 Root brief 的“保存精简可移植检查记录、每条检查命令和 exit”要求不符。主要影响是：长期入口保留了结论，却不能独立追溯关键检查；本机临时目录清理后缺口进一步扩大。

  **最小修复：**补充一份脱敏的可移植检查记录，包含固定候选 SHA 的 parents、两侧祖先检查、第一父提交至候选的完整 diff、候选 manifest 的全部输出，以及最终 main／index／tracked 状态。补齐归档来源与副本指纹、安装清单的精确命令和输出；每项保存 cwd、时间、必要环境和实际 exit。保留现有历史限制，不必为纯文档重跑产品 release，也不要归档原始 slot 或会话全文。

- **Merge verdict：BLOCK。** 阻断的是本轮交付的完整验收，不是已证明该 merge 内容错误。

### 独立核验状态

| 核验项 | 本次结果 |
|---|---|
| main 当前仍为初始 SHA | 已通过引用及 reflog 核实 |
| 外部集成分支／worktree／候选 SHA | 已通过引用、reflog 和 worktree 元数据核实 |
| `origin/main` 当前本地引用为 `8168e126…` | 已读取核实；fetch 当时的实际命令 exit 未独立验证 |
| merge 对象的精确 parents、共同祖先及双方祖先关系 | **unknown**；reflog 只能提供旁证 |
| 实际完整 Git merge 净 diff 仅 CHANGELOG 四行 | **unknown**；已读取的 CHANGELOG 内容与该描述一致，不能替代完整 Git diff |
| 历史 manifest 中 index／lock 指纹与新文档抄录一致 | 已核对字符串；当前文件的哈希未独立重算 |
| main 192/192、候选 191/192 | 前者有历史 stdout；后者仅有交付文档结论；本次复算均 **unknown** |
| 六份归档与来源字节相同、各 SHA-256 正确 | **unknown**，未独立运行哈希命令 |
| 本次新入口的 Markdown 本地链接 | 已逐项检查入口及目标存在；未独立执行检查脚本 |
| 当前活跃 Pi 模式／加载版本／真实 supervisor 回复 | **unknown**，交付物正确保留该边界 |

### 命令与退出码边界

本 reviewer 仅有文件读取、搜索、目录列表和 `watchdog_diff` 工具，且 reviewer 规则禁止 shell 命令。因此**没有独立执行 Git、Node 或 SHA-256 命令；本次 shell exit 均为 N/A**。没有把读取到的 worker 日志当作独立复跑。

读取到的既有检查记录如下：

| 既有命令／检查 | 记录的 exit | 本次核对 |
|---|---:|---|
| `sha256sum -c …/combined-source-manifest.sha256`，main | 文档称 0 | `base-manifest-check.log` 有逐文件 OK；日志未内嵌 exit |
| 同一检查，候选 worktree | 文档称 1 | 未找到候选实际输出 |
| `link-check.md` 中完整 `node -e` 命令 | 文档称 1 | 本机日志确为 `checked=27 missing=11`；日志未内嵌 exit |
| 历史 `npm run test:release:isolated` | 历史 acceptance 称 0 | 已读取实际套件通过输出；未复跑 |

11 个失效链接均位于两份归档原文，且 [link-check.md:11](/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/link-check.md:11) 已明确披露，没有伪称链接检查通过。Root brief 允许保留历史原文的链接限制，因此**不将这些断链本身另列缺陷**。

已读取 `~/.config/agents/slot.md`。本次未启动重任务，无需使用 slot；未生成测试输出，也未向 `/tmp` 写入。后续独立命令核验仍须完成，输出限定在 `/project/tmp/pi-native-lite-20261027/review/`，不能将本报告作为已完成命令复验的证明。
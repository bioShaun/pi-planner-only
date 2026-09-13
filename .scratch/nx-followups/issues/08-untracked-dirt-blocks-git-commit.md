# git_commit：truth 之外的未跟踪脏路径会阻断已跟踪文件的合规提交

Status: verified

## 现象
`git_commit`（D3 解析修复后，`git-audit.ts parseGitStatusPaths` 已正确解析 porcelain v2）仍会拒绝"仅修改了已跟踪 truth 文件"的合规提交，理由是工作区存在 **truth 之外的未跟踪路径**（例如离线测试工件目录）：

```
git_commit refused: dirty paths outside Task T-20260913-032 truth paths:
  .scratch/c13-repo/, .scratch/nx-followups/host-validation/
```

这是 handler 的**设计内闸门**（"External dirty paths are rejected"，`index.ts:1056-1058`），不是解析缺陷 —— 拒绝信息现在列出的是**真实路径**。

## 设计问题
在长期存在未跟踪工件目录的仓库（如本仓库的 `.scratch/`）里，该闸门使 `git_commit` 对**任何**已跟踪文件修改都不可用，除非先清理/移走全部未跟踪路径。需要产品决策：

1. 未跟踪（`??`，未暂存）的 truth 外路径是否应与"已跟踪的 truth 外修改"同等对待（阻断）？
2. 或提供有界豁免：例如仅当 truth 外路径为**未跟踪**且不在 Task scope 时降级为 warning / 记录为 external finding，仍允许提交？
3. 或要求调用方传入"已知外部路径"豁免清单（受 policy 约束）？

任何放宽都不得削弱 ticket-20 的语义（out-of-scope 运行时噪声不归属、不计费）。

## 复现证据
- 真实宿主 session `2026-09-13T12-43-06-809Z_01a09aca…`，Task T-20260913-032：worker 修改已跟踪票据文件 `07-git-commit-porcelain-v2-tracked-file-refusal.md`（恰好一行），Root accept 后 `git_commit` 被上述理由拒绝。
- 对照：D3 修复前同一调用会把整条 porcelain 行当路径报出（见 07 号票）。
- 离线回放（`c13-isolation/`，S4/S5）证明 handler 的 commit/linkage 路径本身正常，仅被本闸门拦截。

## 关联
- 07 号票（D3 解析缺陷）已修复并验证；本票是**另一道独立闸门**的策略问题。

## Triage 结论（2026-09-13，operator 裁定）

采用方案 2（收窄版豁免）：
- truth 外、scope 外、**未暂存**的未跟踪路径 → external finding：不阻断、不归属、不计费（ticket-20 语义不变）。
- truth 外的已跟踪修改 → 维持硬拒（可能被 `git commit -a` 扫入，有真实安全收益）。

边界条件：
1. **scope 内但未被 truth 包含的新文件不适用 external 豁免**——必须进入任务归因 / 声明一致性检查，否则与票 09 的目录前缀归属冲突。
2. **已暂存（index 内）的新文件不属于豁免**。仅限制本次 `git add` 只加 truth paths 不够：提交前必须检查 index 实际内容，确保提交不夹带既有的 truth 外暂存变化。

配套（纵深防御）：git_commit 实现本身只 add truth paths。

- 2026-09-13 08 fix host-verified on host (session 01a09b32, T-20260913-045: typecheck + evidence/git-audit/index suites exit 0); status flipped by Root. Implementation commit e5281f6.

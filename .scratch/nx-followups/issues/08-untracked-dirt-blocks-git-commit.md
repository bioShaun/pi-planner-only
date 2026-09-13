# git_commit：truth 之外的未跟踪脏路径会阻断已跟踪文件的合规提交

Status: needs-triage

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

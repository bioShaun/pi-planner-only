# git_commit 误拒已跟踪文件的修改：porcelain v2 路径解析错位

Status: ready-for-agent

## 现象
`git_commit` 在"**仅 truth 路径本身脏、且该路径是已跟踪文件的修改**"时被误拒：

```
git_commit refused: dirty paths outside Task T-... truth paths: 1 .M N... 100644 100644 100644 <h> <h> declared.txt
```

报错把**整条 `git status --porcelain=v2` 原始行**当成了一个"路径"（见 `declared.txt` 前面的字段串）。未跟踪文件（`? ` 行）不受影响，可正常提交。

## 根因
`git-audit.ts:116-136` 的 `parseGitStatusPaths` 对 `1 ` / `u ` 行按**制表符**切分（`line.slice(line.indexOf("\t") + 1)`），
但 handler 在 `index.ts:1055` 运行的是 `git status --porcelain=v2 --branch`（**未加 `-z`**）。
porcelain v2 的非 rename `1 ` 行中，路径与前面字段之间是**空格**而非制表符（实测：`1 .M N... 100644 100644 100644 <h> <h> declared.txt`），
于是 `indexOf("\t") === -1` → `slice(0)` 返回**整行**当作路径 → `dirtyPathsOutsideTruth` 判定"truth 外脏" → **恒拒**。
只有 `? `（未跟踪）分支能正确解析出路径。

## 复现证据
- 隔离回放：`.scratch/nx-followups/host-validation/c13-isolation/`（插件 = 安装 HEAD 的 `git archive` 精确副本；独立 `git init` 仓库；mock `pi` 捕获并调用**真实** `git_commit` handler）。工作区零影响（跑前/跑后 `HEAD`+`status` 一致）。
- 结果文件 `c13-isolation/c13-results.json`：
  - **S5**：仅 `declared.txt`（truth 路径）被修改 → 拒绝，报文含上述整行。
  - **S4 对照**：truth 路径为**未跟踪**文件 `newfile.txt` → 提交成功、`commitLineage.before != after`。
- 直接探针：`parseGitStatusPaths(<真实 v2 输出>)` 返回 `["1 .M N... 100644 100644 100644 <h> <h> declared.txt"]`（整行）；
  `dirtyPathsOutsideTruth(…, ["declared.txt"])` 返回同一整行。

## Suggested fix
让解析格式与调用格式一致，二选一：
1. `parseGitStatusPaths` 按 porcelain v2 解析：`1 `/`u ` 行取**最后一个空格分隔字段**为路径；`2 `（rename）行为 `<path>\t<origPath>`（或统一切到 `-z`）；或
2. handler 改用 `git status --porcelain -- <paths>`（v1）并按其 `XY path` 格式解析。

并补测试：用**真实** `git status --porcelain=v2` 输出断言解析出正确路径，覆盖「已跟踪修改 / 未跟踪 / rename」三类。

## 影响面
插件 `git_commit` 对**任何已跟踪文件的修改**恒被误拒，只有未跟踪路径可提交 —— 使 C13「合规提交」场景对已跟踪文件不可达，实际提交能力受限。
属于**既有缺陷**，非 cumulative host-validation 补丁引入（`index.ts`、`git-audit.ts` 均不在该补丁的 9 文件内；`index.ts` sha 与 base 相同）。

## Comments
- 来源：宿主验证扫描 C13 隔离回放，场景 S5（2026-09-13）。规范：`docs/runtime-session-013147-2026-09-12-followup-split.md`。

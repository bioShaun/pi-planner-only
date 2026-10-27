# Git 操作摘要归属：Root 验收

基线：`8ada1b3`。结论：接受实现，准备本地提交。

## 行为

`captureBase` 与 `summarizeWork` 使用既有安全 Git 调用检测 `MERGE_HEAD`、`REBASE_HEAD`、`CHERRY_PICK_HEAD` 和 `REVERT_HEAD`。任一端检测到操作，摘要开头会说明差异可能包括该操作带入或重放的改动，不应全部归于 child。委派期间完成操作后仍保留提示，措辞不声称操作仍在进行。两端均未检测到则不显示；探测失败不伪造操作；非工作树不新增探测。既有 dirty 分类和摘要长度上限保留。

## Root 核对

- 阅读实际 `git.ts`、`git.test.mjs` 和票 02 的 diff；未删弱既有断言，改动限于约定范围。
- `red.log` 中真实仓库先发生合并冲突，由模拟 child 解决并提交；原摘要缺少合并归属提示，正则断言失败（退出 1），不是语法或导入失败。相同测试修复后输出 `git.test: ok`（退出 0）。
- 补充测试覆盖四类标记分别在委派前/后存在、普通仓库、非工作树不探测、抛错/非零退出/无效结果故障注入，以及摘要长度约束。
- `release.log` 包含真实隔离安装、typecheck、contract、git、delegate、host、host-runtime 5/5、handoff、status-color、index，CLI 7/7；contract 未跳过。Root 读取 slot 状态确认作业 3618 为 finished、退出 0。
- 原始 `sha256sums.txt` 六项全部匹配。Root 的 `git diff --check` 通过，检查前暂存区为空。未重复运行已通过且源码未变的测试。

## 边界与证据保存

仅检测约定的四个标记及两个时点；在两个时点之间开始并完成的操作不被检测。没有增加通用 sequencer 识别。每次正常委派最多新增八次 Git 标记探测；本次未进行性能收益测量。极小摘要上限仍可能截断提示。

资源预检原始日志保留本机，避免将其他作业名称纳入提交。`sha256sums.txt` 保留原始内容，其中资源日志条目在新检出中不可用；可用 `sha256sum --ignore-missing -c .scratch/git-operation-summary-20261027/sha256sums.txt` 核对随提交保存的五项源码/日志，完整六项核对需要本机资源日志。未修改用户正在调查的 supervisor 相关文件或全局配置。

执行记录：[execution.md](execution.md)。红绿证据：[red.log](red.log)、[green.log](green.log)。完整检查：[release.log](release.log)。

# T2c 任务源还原

`task-source.bundle` 包含完整 parent、原 gold 和修正 gold 历史，三个 refs 为 `t2c-parent`、`t2c-original`、`t2c-target`。固定哈希见 `freeze/task-source.json`；先校验 bundle SHA256。

在新的、父目录已确认的还原目录中执行以下步骤。不要覆盖现有 task-source，也不要对外部 `/public/scripts/tc-probe-design-v2` 执行写入。

```bash
git init <新的任务源目录>
git -C <新的任务源目录> fetch --no-tags <task-source.bundle的绝对路径> \
  refs/heads/t2c-parent:refs/heads/t2c-parent \
  refs/heads/t2c-original:refs/heads/t2c-original \
  refs/heads/t2c-target:refs/heads/t2c-target
git -C <新的任务源目录> checkout --detach c3dd01696b2757cbcb2055d26c1c5e4b38028c5d
```

当前 `bench/tasks/T2c.json` 指向本 effort 下的 `task-source`。若迁移路径，应在新的准备副本中更新 repo 路径、重新冻结并验证；不得修改已经用作结果依据的任务定义。`freeze/source.tar` 保存当前 bench 及插件输入，`freeze/source.sha256.json` 逐文件列出哈希。插件 HEAD 固定为 `ad51067da379edf5735cb9b03d70f17bda331675`。

真实候选仍由 `bench/prepare-clone.sh T2c <全新候选目录>` 准备：只 fetch parent，再注入两份目标测试。不要把还原的完整任务源作为模型任务 cwd。验证脚本已独立比较从原源和 bundle 源得到的候选 tree；模型候选不包含 gold descendant commits。

完整离线复现入口：在项目根执行 `bash .scratch/lite-t2c-preparation-20260927/validate-t2c.sh`。脚本为每次验证新建目录，记录 slot audit/status，使用 slot cpu 与 Landlock、仓库外 TMPDIR；输出 parent RED、2652项基线、gold54项目标与2652项masked结果。预计超过一分钟，不直接运行内部 body。此命令不调用 Pi 模型。

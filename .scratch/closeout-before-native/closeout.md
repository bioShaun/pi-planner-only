# Native 试用前收尾验收

Root 接受范围：优化方案步骤 0–2，以及恢复接受前核对 diff 和 output 的最小修正。起点为 `6e2c95a091fd0eb17e0ec3b8915affcebc3c29ab`。本记录是 Root 最终验收与检查点说明，不改写历史审核状态。

- 实现与测试由 workflow `8d56ebf0-601c-4075-b7d0-3567800c1330` 的 child `2b3b62ca-cea9-44e2-a6cc-21dc511cd6c9` 执行。
- fresh 独立审查 child `55807f75-dd7e-4de2-b15c-e17231c10b95` 返回 `PASS (final)`；原文保存在 [reviewer-result.md](reviewer-result.md)。ordinary 只读行为约定，不声称严格沙箱。
- Root 检查最终 Git diff、红绿日志、完整发布日志、分析测试、版本说明和包源码比较记录；接收工具重新核对冻结包后产生 [acceptance.json](acceptance.json)，final_acceptance 为 PASS。调度完成不作为验收依据。

## 验证

修正前两版提示词探针均因缺少 output 要求失败；修正后 2/2 通过，默认长度为非 strict 1498 / strict 1489，均严格小于 1500。没有删弱现有产品断言或扩大长度上限。

`npm run test:release` 的 typecheck 及全部套件通过，包含真实宿主离线集成 5/5；离线基线分析测试 4/4 通过。命令及完整日志见 [execution.md](execution.md)。当前 0.83.0 全局源码包缺少 optional `pi-ai` peer，默认发布检查失败已保留；在 `/project/tmp/pi-planner-closeout-before-native` 安装源码及角色定义一致的 0.83.0 副本并补 peer 后，通过 `PI_SUBAGENTS_DIR` 完成发布检查。未修改全局安装，未把旧 0.81.0 夹具冒充当前版本。

当前复现命令：

```bash
mkdir -p /project/tmp/pi-planner-closeout-before-native
# 每次重检查前，slot audit 与 slot status 的输出须记录到项目日志。
TMPDIR=/project/tmp/pi-planner-closeout-before-native \
PI_SUBAGENTS_DIR=/project/tmp/pi-planner-closeout-before-native/node_modules/pi-subagents \
slot cpu -- npm run test:release
```

隔离副本的安装命令见执行记录。该临时目录需要保留或按记录重建。

## 检查点与后续

本轮提交代码、测试、研究/方案/基线报告及必要验收证据。原始会话 JSONL/stderr、本机 `.claude` 配置和中间调度产物保留本地，不纳入检查点；历史证据中指向原始日志或机器绝对路径的引用因此仍需本机文件。基线 JSON 保留源路径和哈希，未复制全部历史日志。

历史步骤 2 受控会话没有重新运行，不能据此证明修正后的自然路由或性能收益；host-runtime 使用真实宿主及可控 provider/委派对端，不等于完整 child 进程或付费 provider 验证。

提交前暂存区检查中，两个原始 `.diff` 证据文件的补丁上下文前缀被 Git 判为行尾空白/空格后制表符；它们是未改写的历史/冻结补丁，不是源码格式错误。保留原始字节，排除这两个补丁证据文件后，全部暂存代码、测试、文档及其余证据的 `git diff --cached --check` 通过；冻结包再次 check 通过。

`check v1`、遥测和 thinking 实验（步骤 3–5）暂缓，待下一轮 Native 真实任务试用后评估。模式配置尚未改变；下一轮由 `/planner-only native` 后新开会话，并用 `/planner-only status` 确认。此次仅本地提交，不发布、不推送。

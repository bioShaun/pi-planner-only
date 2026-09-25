# bench 与插件修复（来源：2026-09-25 control campaign 复盘）

来源：对 `/project/tmp/ppo-bench/results/*/runs` 下 116 条有效 run 的复盘。
分析脚本在 `../bench-review/`（`metrics.py`、`timeline.py`）。

## 发现

bench 侧：
1. 答案泄漏：`run.sh` 用 `git clone` 复制本地仓库的全部历史，target 提交就在克隆里。
   T1 的 33 条 run 里有 18 条 `git checkout 978392f -- ...` 直接抄答案，T2 有 3 条看到或抄了答案。
2. 标准答案过不了评测：T1 的 target `978392f` 会让 `tests/contracts/test_replace_primaries_cli_wiring.py`
   的 2 个测试失败，上游后来在 `cee4c0f` 改了测试。T1 的 6 次失败中有 5 次是抄了答案。
3. 插件版本混杂：arm 写 `pluginRef: WORKTREE` 时，每条 run 各自取当时的 HEAD。
   control-gemini-strict 的 base arm 跨了 5 个插件版本，aa arm 却固定在 `b1f83cb`，所以 aa 噪声估计里混进了版本差异。
4. 指标太粗：只有费用和通过率。Root 费用约占总费用 97%，机制问题（拒绝、detach、截断、Root 自己读文件）都看不到。
5. 没有 direct arm，也没有难度适中、来自其他仓库的任务。

插件侧：
6. 子 agent 请示导致 detach：scout 和 oracle 在第一轮就调用 `contact_supervisor`（need_decision），
   这时 delegate 返回 `failed · Detached for intercom coordination`。cpass-ds 和 gemini 两组共 56 次。
   每次 Root 要多花约 2 轮（`subagent_supervisor` 和 `bg_wait`）。插件把 detach 当成终态处理，会提前释放仓库锁，而子 agent 其实还在跑。
   诱因：Root 写了"不要修改任何东西"，但运行时要求 scout 把报告写进 artifact 文件（scout frontmatter 里是 `output: context.md`）。
   pi-subagents 的结构化请求支持 `intercomBridge: { mode: "off" }`，可以按次关掉桥。
7. 报告截断：`MAX_CHILD_TEXT_CHARS = 4000`，截断时保留开头 25% 和结尾 75%。cpass-ds 里 41% 的报告被截断。
   截断之后 Root 下一轮平均自己读 0.63 个文件，不截断时是 0.11 个。
8. 同仓库委派被拒：`297b065` 上有 11 次。票 05（`2f934a8`）改过措辞，但没有测过效果。
9. 小问题：validator 有 7/250 次说自己不能运行命令；子 agent 在 `/tmp` 下建 git worktree。

更正：control-kimi-strict 全组子模型 503 的问题，`summarize.py` 会调用 runcheck 判为 INVALID，不需要另外处理。

## 票

| 票 | 内容 | 依赖 |
|---|---|---|
| 01 | 克隆只含 parent 可达历史；runcheck 检查 target 泄漏 | |
| 02 | 标准答案检查脚本；修 T1 | 01 |
| 03 | campaign 把 WORKTREE 冻结成提交号 | |
| 04 | summarize 加机制指标 | |
| 05 | 插件：委派关闭 intercom 桥 | |
| 06 | 插件：报告长度要求与截断上限 | |
| 07 | 插件：validator 不能运行、临时目录（先调查） | |
| 08 | 新任务与 direct arm | 01, 02 |
| 09 | A/B 测量：297b065 对比修复后的 HEAD | 01–07 |

## 约束

- 插件改动：`npm run test:release` 全绿（`TMPDIR` 设在仓库外，不用 `/tmp`）；不删、不弱化现有断言；每个新守卫都配故障注入测试。
- bench 改动：不改动 `/public/scripts/...` 下的源仓库；克隆和临时文件放在 `/project/tmp/ppo-bench`。
- 重任务（跑评测套件、campaign）先执行 `slot audit` 和 `slot status`，再用 `slot` 提交。

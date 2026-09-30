# 01：Root 委派指导文本与单测

Status: done
Type: task

Source: `../spec.md`（Solution 1–4、Implementation Decisions、Testing Decisions）。

## 要做的事

只改 Root 看到的指导文本，加上对应的单测和文档同步。不改运行逻辑。

1. `index.ts` 的 `plannerPrompt`：只改角色那一行，在 validator 的描述里加一个表明"不写文件"的短语。strict 与非 strict 两种模式都必须少于 1,700 字符（当前 1,662 和 1,678）。其他句子不改原文。
2. `index.ts` 里 `delegate` 工具定义的 `description`：在现有文字之后追加以下四点，保持现有句子不变。
   - 交付物需要写文件（脚本、报告、输出文件）时用 worker；
   - 超过子任务时限的运行分两次委派：先"实现并启动后台作业，立即返回作业标识、输出路径和完成条件"，运行结束后再单独派一次验收；
   - 等待后台作业时，每个作业一次只发一条有界的状态查询，不在同一轮发出相同的等待命令；
   - `completed` 只表示子任务结束；答复里区分"实现完成""检查通过""真实运行通过"。
3. `role` 参数说明：validator 改为"运行已有检查，不写文件"；reviewer 在现有说明之后补上"改动已提交时，在任务里写明基线 commit"。
4. 措辞与机器无关，不出现 `slot`、`nextflow` 等命令名。描述里如果要写时限数字，不写死"10 分钟"；工具定义拿不到配置时只写"the child time limit"。
5. `README.md` 和 `README.zh-CN.md` 中与新指导矛盾的角色或委派说明同步更新；`CHANGELOG.md` 记一条。

## 测试

在 `index.test.mjs` 里沿用现有写法（第 75–104 行附近的 `plannerPrompt` 正则断言，以及 `h.tools.get("delegate").description` 断言），新增：

- `plannerPrompt(false)` 和 `plannerPrompt(true)` 里，validator 都标明不写文件；
- `delegate` 的 description 包含上面第 2 条的四点，每点至少一个正则；
- `role` 参数说明包含 validator 不写文件、reviewer 需要基线 commit；
- 保留现有的少于 1,700 字符断言，不改它。

不删除、不放宽任何已有断言。实现者要手动做一次故障注入自检：临时删掉一句新指导，确认对应断言失败，再恢复。在报告里写明试的是哪一句。

## 验收命令

```bash
mkdir -p /project/tmp/ppo-rdg && TMPDIR=/project/tmp/ppo-rdg npm run test:release   # 全绿
git diff -U0 -- '*.test.mjs' | grep '^-.*assert'                                     # 无输出
node --experimental-strip-types bench/overhead.mjs static --ref HEAD                  # 报告字符增量
```

报告需包含：两种模式的 `plannerPrompt` 长度、overhead 字符增量、故障注入自检的结果。完成后用一次提交，提交信息以 `feat(prompt):` 开头，并把 commit sha 写进本文件的 Comments，票 02 的 treat arm 要用它。

## Comments

- 2026-09-30 完成，commit `d186304`（`feat(prompt): Root delegation guidance for role routing, long runs, acceptance`）。票 02 treat arm 的 `pluginRef` 用完整 sha `d186304e2de209a38cb1dfbde5f869e2158142c8`。
- 实现摘要：`plannerPrompt` 非 strict 1,681 字符、strict 1,697 字符（上限 1,700，未用 fallback）；overhead vs 前一 HEAD：提示 +19 字符、工具定义 +842 字符（delegate description +690、参数 +152，约 +211 token）；README 两版无矛盾未改；CHANGELOG 记一条。故障注入自检：临时删掉 "completed" 句，index 测试对应断言（第 107 行）失败，恢复后全绿。`npm run test:release` 全绿；无删除/放宽已有断言。

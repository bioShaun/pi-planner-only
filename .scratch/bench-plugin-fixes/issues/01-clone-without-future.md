# 01：克隆只保留 parent 可达历史；runcheck 检查 target 泄漏

## Comments

Implemented parent-only clone preparation, target-reference detection in `runcheck.py`, and the README note. Verification: T1/T3 target objects were absent (both `cat-file` exit 1); clone history sizes matched parent reachable count + 1 (523=522+1 and 525=524+1); all six staged test files matched target; target pytest exit codes were T1=2 and T3=1. Runcheck returned T1 invalid with `target commit referenced x9` and T3 valid; `bash -n bench/run.sh bench/prepare-clone.sh` passed.


## Problem

`bench/run.sh` 用 `git clone "$REPO"` 复制本地仓库的全部历史，target 提交就在克隆里。Root 会用 `git checkout <target> -- ...` 直接抄答案（T1 有 18/33 条 run 这样做）。

## Changes

- 新增 `bench/prepare-clone.sh <task-id> <dest>`，把 run.sh 里的克隆步骤搬过去，并改成：
  - `git init` 后只 fetch parent 这一个提交（不带 tags，也不带其他 refs）；
  - 目标测试文件用 `git -C "$REPO" show "$TARGET:<path>"` 写入，不能让 target 对象进入克隆；
  - 提交一个 `bench: target tests`，最后一行输出 BASE 提交号。
  run.sh 改为调用这个脚本，其他行为不变。
- `bench/runcheck.py`：如果 jsonl 旁边有 `<id>.meta.json`，就读取其中的 `task.target`。Root 的 toolCall 参数或工具结果里出现 target 的前 7 位时，判为无效，原因是 `target commit referenced xN`。没有 meta 时跳过这项检查。`summarize.py` 调用的是同一个 `check`，不用单独改。
- README 对应段落补一句说明。

## Acceptance

- 用 T1 和 T3 各准备一个克隆（放在 `/project/tmp/ppo-bench/clones/verify-*`），检查：
  - `git cat-file -e <target>` 失败；
  - `git log --all` 中不含 parent 之后的提交；
  - 目标测试文件内容与源仓库 target 版本一致；
  - 这三个测试在 BASE 上是失败的。
- `python3 bench/runcheck.py` 在 `/project/tmp/ppo-bench/results/control-cpass-ds-strict/runs/T1-lite-pds-strict-1.jsonl` 上判为无效（原因是泄漏），在同一目录的 `T3-lite-pds-strict-1.jsonl` 上判为有效。
- `bash -n bench/*.sh` 通过。

## Comments

- 2026-09-25 实现：新增 `bench/prepare-clone.sh`，它 `git init` 后只 fetch parent，目标测试文件用 `git show TARGET:path` 写入；run.sh 改为调用它。runcheck 读取同名 meta.json 中的 target，检查前 7 位是否出现在 Root 的工具参数或工具结果里。
- Root 验收：T1 克隆里 `git cat-file -e 978392f` 返回 128，`log --all` 共 523 条，等于 parent 的 522 条加 1 条 bench 提交，没有其他 ref。runcheck 判定 T1-pds-strict-1 无效（x9），T3-pds-strict-1 有效，T2-pds-strict-1 也无效（x9，与复盘中 T2 有 3 条 run 泄漏一致）。
- 影响：summarize 通过 runcheck 会把历史上抄过答案的 run 标为 INVALID。这是有意为之，这些 run 已经被答案污染。

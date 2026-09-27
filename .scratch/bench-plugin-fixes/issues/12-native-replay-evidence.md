# 12：native 回放用例依赖仓库外归档与本机 scratch，新克隆上恒跳过

Status: done
Type: task
Execution: 已实现（方案 B：gz 入库，运行时解压）。fixture 与断言哈希见 `../ticket12-fixture-20260927/fixture-shas.json`；可写 TMPDIR 下 36 项离线测试 OK 且无 skipped，`npm run test:release` 全过。

## Problem

`bench/test_native.py::NativeBenchTest.test_archived_detached_terminal_replay` 要求两个不随仓库分发的
位置同时存在，任一缺失就 `self.skipTest('archived T2b evidence unavailable')`：

- `/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926/runs/T2b-native-opus-calibration-1.jsonl`
  （campaign 归档，仓库外）；
- `.scratch/lite-cross-task-next-20260926/execution/child-evidence/T2b-native-opus-calibration-1/`
  （child meta 与两条 transcript，1.07MB + 502KB）。

这是"detached child 的终态产物替换累计中间用量"这条计费规则的唯一端到端断言：
`collect_bundle` → `check(valid=True)` → `parse_run` 总额 `$1.88898237`，以及篡改 manifest 后必须拒收
（`cost=null`）。新克隆、换机器或清空 `.scratch` 后它静默跳过，读测试结果的人看不到这条规则已经没有覆盖。

`.gitignore` 现在排除 `child-evidence/**/*.jsonl`、克隆与临时产物，仓库外归档本来就不在版本控制内，
所以只补两条 transcript 不足以让该用例在任何机器上运行。

## Options

- 把这次 attempt 的主 JSONL 与两条 child transcript 作为 fixture 收进仓库，用例改读仓库内路径；主 JSONL 实测 24.9MB、转录 1.54MB，故按 gz 入库（0.50MB + 0.32MB）运行时解压——**本项被采纳**；
- 改成合成 fixture：保留被断言的事件形状（detached 终态 + 累计快照），不再依赖真实 transcript；
- 明确接受它只是本机回归，并在 docstring 与 `bench/README.md` 写明前置条件。

## Acceptance

- 选定方案后：仓库外 TMPDIR 下 `python3 -B bench/test_native.py` 全绿，且该用例不再自行跳过；
- 若保留跳过行为，`bench/README.md` 必须写明它只能在保留归档的主机上运行，避免把"跳过"读成"通过"；
- 不删除、不 weaken 现有断言；改动计费判定时按 AGENTS.md 的要求补故障注入用例。

## Comments

- 2026-09-27 建票：整理待提交清单时发现该用例的仓库外依赖；本次按现状提交 `bench/test_native.py`
  （用例在无归档的机器上跳过），缺口转本票处理。
- 2026-09-27 实现：新增 `bench/fixtures/native-detached-replay/`——真实归档的 gz 主 JSONL 与两条 child 转录，
  加原样的 `meta.json`/`eval.json`/`.exit`/`.wall` 与两条 child `meta.json`。`bench/test_native.py` 新增
  `materialize_fixture()`：解压到 TMPDIR、钉住解压后主 JSONL 的 sha256（`542c4ea5…`，fixture 被替换即失败）、
  并把 JSONL 里 `artifactPaths` 声明的机器本地路径重绑到解压后的 child 证据目录，让显式 source 与 CLI
  两条采集路径都不再依赖 `/project/tmp` 归档；`skipTest` 改为缺失即失败。
- 核对：归档原文件、仓库内旧拷贝与 fixture 解压后字节三方一致（主 JSONL `542c4ea5…`，转录 `fc18f20f…`
  / `b3ec67aa…`，两条 child meta `30d4df11…` / `0da585b2…`）。`.exit` 必须随 fixture 入库：`runcheck` 现在把
  缺失或非 0 的 Pi 退出记录判为无效。
- 验证：`git check-ignore` 对新 fixture 无输出（未被忽略规则吃掉）；`TMPDIR=<仓库外可写> python3 -B
  bench/test_native.py` 36 项 OK 且 skipped 为 0；`TMPDIR=<仓库外可写> npm run test:release` exit 0。
  证据 [ticket12-fixture-20260927](../ticket12-fixture-20260927/)。
- 估算修正：上面 Options 里写的"约 1.6MB"只算了 child 转录，主 JSONL 实为 24.9MB。gz 后合计 0.82MB；
  仓库现有最大 blob 0.60MB、整个 pack 3.6MB，故选择 gz 而不是让工作树多背 26.5MB。

# 提交后验收：f2dc9e3..21990d1

2026-09-27 在可写 `/project/tmp` 下，对本轮四个提交（`f2dc9e3` .gitignore、`0a6ec3e` bench、`dfd283d` docs、
`21990d1` 票与证据）跑的验收。原始目录 `/project/tmp/ppo-bench/verify-commit-20260927T224656/`，这里是它的
副本（未复制其中的 `node-compile-cache/`）。

## 命令与结果

| 命令 | 结果 | 日志 |
|---|---|---|
| `slot cpu -L bench-verify-offline -- bash -c "cd <repo> && TMPDIR=<verify> python3 -B bench/test_native.py"` | exit 0，`Ran 36 tests ... OK` | `native-tests.log` |
| `slot cpu -L bench-verify-release -- bash -c "cd <repo> && TMPDIR=<verify> npm run test:release"` | exit 0，typecheck + contract/git/delegate/host/index 全过 | `release.log` |
| `BENCH_OUT=/project/tmp/ppo-bench/results/dryrun-commit-<stamp> BENCH_DRY_RUN=1 bench/run.sh T2b native-pds 1` | exit 0，guard 报 `{"abi": 7, "backend": "landlock", "policy": "deny /tmp writes; allow safe root directories"}` | `dryrun-native.log` |
| 预检 `slot status` / `slot audit` | 已记录 | `slot-status.log` / `slot-audit.log` |

## 注意

同一套用例在 `/project/tmp` 只读的环境下会有 8 项失败（都属 guard/Landlock 环境用例，例如
`TMPDIR must resolve under /project/tmp`）；那是环境限制，不是代码缺陷，必须在可写环境复跑后才能
声明通过。票 12 之后的 fixture 改动另见 `../ticket12-fixture-20260927/`。

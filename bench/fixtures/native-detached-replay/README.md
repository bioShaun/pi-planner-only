# native-detached-replay fixture

`bench/test_native.py::NativeBenchTest.test_archived_detached_terminal_replay` 的输入。它是 campaign
`opus-cross-task-t1-t2b-20260926` 里 `T2b-native-opus-calibration-1` 那次真实运行的归档，用来断言
"detached child 的累计中间用量只在终态产物通过验证后由终态替换"这条计费规则（总额 $1.88898237）。

来源：`/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926/runs/T2b-native-opus-calibration-1.*`
与它声明的两条 child 产物。四条 child 产物（2 meta + 2 转录）与主 JSONL 里 `artifactPaths` 声明的原文件
以及仓库内旧拷贝逐字节一致（2026-09-27 核对）。

## 文件

| 文件 | 说明 | 解压后 sha256 |
|---|---|---|
| `runs/T2b-native-opus-calibration-1.jsonl.gz` | 主 JSONL，24,958,798B → 512KB（gz sha256 `bc132b1f0630a15db83b0ed07b515187312aa642281ddccd134bd66c87a22659`） | `542c4ea51b620fa73ce2ad83855e25900fa1550abf15a46fa1b4f266a98bb0e4` |
| `runs/T2b-native-opus-calibration-1.meta.json` | arm/Task 元数据，`runcheck` 与 `parse_run` 都读它 | `00d8f8933559ab1c199a0315fc1253637204f19adcc04f48a3664b2e058689a5` |
| `runs/T2b-native-opus-calibration-1.eval.json` | 该次运行的冻结评测结果 | `c20d12fb0d32e33b5c5185721856a80c05c873af625d73dbd952b0f3f7a2fe93` |
| `runs/T2b-native-opus-calibration-1.exit` | Pi 退出码 `0`；缺失或非 0 会被判无效 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `runs/T2b-native-opus-calibration-1.wall` | 墙钟秒数 | `c67fce7616d16855108653e28cd044ae3e5cc8c0cf77fa879cc6af02a7f3558e` |
| `child-evidence/5037c020-…_worker_0_transcript.jsonl.gz` | 终态 child 转录，1,069,020B（gz sha256 `c9816f2c879d03553f9d62723e46d9f692c8cf31eff700cc082ec21371c74aaf`） | `fc18f20f337230b40295b236d3fed36eb2ef1bb35322074a851eb0a7e3e4e829` |
| `child-evidence/0669d2da-…_worker_0_transcript.jsonl.gz` | 被替换的累计快照转录，502,166B（gz sha256 `f2d49982149cea22b1271148e3b31dbfb0b93d8726f78e852ff86976f9e47ca2`） | `b3ec67aa672c18745a6e251578d2acb95cab469b20a246a3ddea0cbb81070e20` |
| `child-evidence/*_worker_0_meta.json` | 两条 child 元数据（7644B / 8043B） | `30d4df11948e585a…` / `0da585b2675a8796…` |

gz 由 `gzip -9 -n` 生成（不写时间戳）。文件命名必须保持 `{runId}_{agent}_{index}_meta.json` /
`..._transcript.jsonl`：`native_results.collect_bundle` 按这个形状拼 `source / name`。

## 为什么是 gz 而不是原样入库

主 JSONL 24.9MB，原样入库会让工作树多背 26.5MB——仓库现有最大 blob 只有 0.60MB、整个 pack 3.6MB。
gz 之后两者合计 0.82MB，而解压后字节与归档完全一致，所以断言的价值没有损失。

## 使用时的两点注意

- fixture 里 `artifactPaths` 仍写着产出机器上的绝对路径（`/project/tmp/...`）。`materialize_fixture()`
  解压后会把这些声明重绑到解压出来的 child 证据目录，因此显式 source 与 CLI（只读声明路径）两条采集
  路径都能在只有仓库的机器上跑通。
- `eval.json` 的 `"valid": false` 是修复前的冻结判决，历史事实，不要"修"它；用例直接调 `check()` 与
  `parse_run()`，不走 `summarize.py` 对旧 eval 的 INVALID 规则。

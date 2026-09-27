# 票 12 验收：仓库内 gz fixture

改动：`bench/fixtures/native-detached-replay/`（gz fixture）、`bench/test_native.py`（解压 → 钉住解压后
sha256 → 重绑 `artifactPaths` → 缺失即失败，删除 `skipTest`）、`bench/README.md`（fixture 与离线回归说明）。

fixture 来源、gz 与解压后哈希见 `fixture-shas.json`。gz 由 `gzip -9 -n` 生成；解压后与归档原文件逐字节
一致（主 JSONL `542c4ea5…`、两条转录 `fc18f20f…` / `b3ec67aa…`），四条 child 产物也与主 JSONL 里
`artifactPaths` 声明的原文件一致。

## 命令与结果

| 命令 | 结果 | 日志 |
|---|---|---|
| `git check-ignore -v bench/fixtures/native-detached-replay/...` | 无输出（fixture 未被忽略规则命中） | — |
| `TMPDIR=<仓库外可写> python3 -B bench/test_native.py` | 36 tests OK，且无 skipped（回放用例真的执行了） | `native-tests.log` |
| `TMPDIR=<仓库外可写> npm run test:release` | exit 0 | `release.log` |

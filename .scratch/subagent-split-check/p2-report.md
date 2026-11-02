# P2 暂停报告

Root 决定：费用未知按预算暂停，证据不足，不改生产 `NATIVE_PROMPT`。不得重试第 5 次、启动第 6 至 12 次或清 STOP；恢复需可核验费用或用户明确修订未知费用停止约束。消息前缀不等于生产系统提示，且样本极少。

| 样本 rep=1 | eval pass | 当前 runcheck | 费用 USD | wall s | Root edit/write/bash | worker 委派 | reviewer |
|---|---|---|---:|---:|---|---:|---:|
| 重启 pilot G1 luna | true | 旧独立重分析有效、当前版重算失败 | 0.03278488 | 99 | 0/0/14 | 1 | 0 |
| G1 treat | true | 有效，原始 invalid 保留 | 0.0588796 | 74 | 0/0/7 | 1 | 0 |
| G1 base | true | 有效 | 0.082592 | 91 | 0/0/13 | 1 | 0 |
| T3 treat | true | 有效，原始 invalid 保留 | 0.306635 | 419 | 0/0/22 | 1 | 0 |
| T3 base | true | 有效 | 0.4173528 | 392 | 0/0/16 | 1 | 0 |
| T2b treat | true | 失败，502 和收集失败 | 未知；下界 1.5704718 | 1195 | 0/0/48 | 2 | 0 |

指标来自当前 `guidance_metrics.py`；人工逐条核验四个正式样本全部 58 个 Root bash 命令，均只读，无脚本写文件，清单及限制见 `/project/tmp/ppo-p2/seq5-offline-audit/root-bash-commands.txt` 和 `review.md`。每次仅委派一个 worker，无 reviewer，H2 不适用。仅 G1、T3 rep1 成对且均 eval pass，未见通过率翻转；H1 的顶层 edit/write 和委派计数未变。每格 n=1，T2b 不成对，不能依据局部费用作正式 20% 采纳判断。

历史旧失效批次 $0.2527056 永久计费，前四正式及两批 pilot 已报告费用 $1.15094988；加第五次已报告费用后的累计下界 $2.72142168。Root 与第二 child 各有一个 502，错误虽显示零 usage 字段但无 usage 报告，无法确认收费。详见 `/project/tmp/ppo-p2/seq5-offline-audit/seq5-audit.md` 与 `seq5-requests.jsonl`；eval pass 不证明第 5 次有效。

最终版 `runcheck.py` 对 seq1-4 使用各自证据 bundle 均 valid，计价与上表一致；原始结果、精确命令、退出码及解析 SHA 见 `/project/tmp/ppo-p2/seq5-offline-audit/recompute.json`、`review.md`。pilot 旧 reanalysis bundle 缺最终版要求的 status，失败；用冻结 status 和 artifacts 调用当前收集器又遇 `conflicting child artifact references`，不放宽校验或追认当前版有效。pilot 历史 Root 验收和旧 reanalysis 保留。T3 base 两个测试文件已从 transcript 重建并核验：新增测试与 fail-closed、无重叠及诊断契约相符，已有测试无删除或弱化；证据和范围限制见 `/project/tmp/ppo-p2/seq5-offline-audit/review.md`。

已有验证：`/project/tmp/ppo-p2/status-identity-suite.log` 记录 41 native + 3 guidance 通过，本轮未重跑。release 预检有既有依赖阻塞，本轮未重跑。原始 run、eval、STOP 和独立重分析位置见 `p2-checkpoint.md` 与日志。

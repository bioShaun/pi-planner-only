# 契约实跑证据摘录（2026-09-09）

每条结论对应的逐字原文，从会话记录里机械提取。完整记录留在
`.scratch/planner-only-cost-control/p18-contract-run/session-*/`（未入库，960K）；
本文件由该目录下的提取脚本重跑即可复现。

**读法**：每组有两份记录 —— 根进程的 `session-X/*.jsonl`，和被委派子进程自己的
`session-X/<sess>/<uuid>/run-0/*.jsonl`。两份都要看：`usageBudget` 是根发出去的，
而"子进程实际烧了多少"只记在子进程那份里。把两者分开列，是因为 A3 的结论
（子进程花掉上限的 22 倍仍未被拦）只有在子进程那份记录里才可见。


## group SMOKE

- 根记录 `session-SMOKE/2026-09-08T23-33-25-466Z_01a0835e-8759-7345-bd0e-35ee83672000.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`(无委派)`
- 委派次数：0
- 根花费：`$0.000000`
- 本组合计：`$0.000000`

## group C

- 根记录 `session-C/2026-09-08T23-54-33-337Z_01a08371-dff9-743c-93cc-08784bcdea58.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`(无委派)`
- 委派次数：0
- 根花费：`$0.000000`
- 本组合计：`$0.000000`

## group D

- 根记录 `session-D/2026-09-08T23-55-23-405Z_01a08372-a38d-7163-8b9a-6e8b964b5579.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`(无委派)`
- 委派次数：0
- 根花费：`$0.000000`
- 本组合计：`$0.000000`

## group C-aborted-slashcmd-loop

- 根记录 `session-C-aborted-slashcmd-loop/2026-09-08T23-43-40-280Z_01a08367-e8f8-7404-968d-468a986c8a8a.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`(无委派)`
- 委派次数：0
- 根花费：`$0.000000`
- 本组合计：`$0.000000`

## group A-free

- 根记录 `session-A-free/2026-09-08T23-59-25-182Z_01a08376-53fe-77dd-be36-c63b200811c2.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=1`
- 委派次数：1
- 根花费：`$0.000000`
- 子进程记录 `session-A-free/2026-09-08T23-59-25-182Z_01a08376-53fe-77dd-be36-c63b200811c2/277cf74c-e49b-4a39-8d6f-5eaa3dbfd859/run-0/session.jsonl`
- **子进程自身花费：`$0.000000`，自身 token：`0`**（模型 `qwen-local/qwen3.8-27b`）
- 本组合计：`$0.000000`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 0/$0.0000 (4 turns) · children 0/$0.0000 · root share 0%`

## group B-free

- 根记录 `session-B-free/2026-09-09T00-06-27-905Z_01a0837c-c740-77f6-b5b4-39a981e61993.jsonl`
- 宿主实跑模型：`qwen-local/qwen3.8-27b`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=200000`
- 委派次数：1
- 根花费：`$0.000000`
- 子进程记录 `session-B-free/2026-09-09T00-06-27-905Z_01a0837c-c740-77f6-b5b4-39a981e61993/a06c063d-3791-4425-b6ee-5844d88d2eca/run-0/session.jsonl`
- **子进程自身花费：`$0.000000`，自身 token：`0`**（模型 `qwen-local/qwen3.8-27b`）
- 本组合计：`$0.000000`
- 插件状态行：`state: reviewing`
- 插件状态行：`decision: review_pending`

## group A

- 根记录 `session-A/2026-09-09T00-09-18-683Z_01a0837f-625b-72fd-adee-77a713ed08e2.jsonl`
- 宿主实跑模型：`tcuni/gpt-5.6-luna`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=1`
- 委派次数：1
- 根花费：`$0.006944`
- 子进程记录 `session-A/2026-09-09T00-09-18-683Z_01a0837f-625b-72fd-adee-77a713ed08e2/917685e4-d86b-4886-8470-f502a8e393f1/run-0/session.jsonl`
- **子进程自身花费：`$0.000000`，自身 token：`0`**（模型 `qwen-local/qwen3.8-27b`）
- 本组合计：`$0.006944`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 3.8k/$0.0023 (3 turns) · children 0/$0.0000 · root share 100%`

## group B

- 根记录 `session-B/2026-09-09T00-09-45-782Z_01a0837f-cc36-72a1-858a-1347c91e0c47.jsonl`
- 宿主实跑模型：`tcuni/gpt-5.6-luna`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=200000`
- 委派次数：1
- 根花费：`$0.008172`
- 子进程记录 `session-B/2026-09-09T00-09-45-782Z_01a0837f-cc36-72a1-858a-1347c91e0c47/7628cc38-ec89-42c2-9c50-c78c12e2859f/run-0/session.jsonl`
- **子进程自身花费：`$0.000000`，自身 token：`0`**（模型 `qwen-local/qwen3.8-27b`）
- 本组合计：`$0.008172`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 4.3k/$0.0025 (3 turns) · children 0/$0.0000 · root share 100%`

## group A2

- 根记录 `session-A2/2026-09-09T00-13-34-866Z_01a08383-4b12-719f-af3e-8fb6ee62250f.jsonl`
- 宿主实跑模型：`tcuni/gpt-5.6-luna`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=1`
- 委派次数：1
- 根花费：`$0.006968`
- 子进程记录 `session-A2/2026-09-09T00-13-34-866Z_01a08383-4b12-719f-af3e-8fb6ee62250f/bd80715c-ed0f-4154-b63c-8ab0d2ed4ac3/run-0/session.jsonl`
- **子进程自身花费：`$0.002298`，自身 token：`9306`**（模型 `tcuni/gpt-5.6-luna`）
- 本组合计：`$0.009266`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 3.7k/$0.0023 (3 turns) · children 9.3k/$0.0023 · root share 50%`

## group B2

- 根记录 `session-B2/2026-09-09T00-14-08-468Z_01a08383-ce54-7658-818b-ca2d154f2d39.jsonl`
- 宿主实跑模型：`tcuni/gpt-5.6-luna`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.05 usageBudget.tokens.hard=200000`
- 委派次数：1
- 根花费：`$0.007112`
- 子进程记录 `session-B2/2026-09-09T00-14-08-468Z_01a08383-ce54-7658-818b-ca2d154f2d39/649af01f-bbb6-4799-862a-9441055e1523/run-0/session.jsonl`
- **子进程自身花费：`$0.002303`，自身 token：`9292`**（模型 `tcuni/gpt-5.6-luna`）
- 本组合计：`$0.009415`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 4k/$0.0024 (3 turns) · children 9.3k/$0.0023 · root share 51%`

## group A3

- 根记录 `session-A3/2026-09-09T00-15-59-120Z_01a08385-7e8f-7219-a0f2-1da2cf5fdba8.jsonl`
- 宿主实跑模型：`tcuni/gpt-5.6-luna`
- 委派时发到线上的上限：`usageBudget.costUsd.hard=0.0001 usageBudget.tokens.hard=100000`
- 委派次数：1
- 根花费：`$0.003581`
- 子进程记录 `session-A3/2026-09-09T00-15-59-120Z_01a08385-7e8f-7219-a0f2-1da2cf5fdba8/b5380056-a3b2-49c7-a333-c2fb3e47092c/run-0/session.jsonl`
- **子进程自身花费：`$0.002198`，自身 token：`9194`**（模型 `tcuni/gpt-5.6-luna`）
- 本组合计：`$0.005779`
- 插件状态行：`state: completed`
- 插件状态行：`decision: accept`
- 插件状态行：`usage: root 3.6k/$0.0022 (3 turns) · children 9.2k/$0.0022 · root share 51%`

## 关键对照

| 组 | 发到线上的 hard 上限 | 子进程实际用量 | 是否被拦 |
|---|---|---|---|
| A  | tokens=1        | 子进程用 qwen-local，自报 0 token | 未拦（此组不具判别力，见 A2） |
| B  | tokens=200000   | 同上 | 未拦（对照） |
| A2 | tokens=1        | **9.3k token** | **未拦，跑完** |
| B2 | tokens=200000   | 9.3k token | 未拦（对照） |
| A3 | costUsd=0.0001  | **$0.0022（上限的 22 倍）** | **未拦，跑完** |

A 组单独看是空转的：子进程自报 0 token，`0 < 1` 成立，一个正确执行上限的宿主
同样会放行，因此"A 组启动了"无法区分"宿主不执行"和"宿主执行了但没超"。
A2 换成会如实上报 token 的付费模型，A3 换到 costUsd 这一维，两条路径才真正具备判别力。


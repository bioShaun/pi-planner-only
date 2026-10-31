# reviewer-git-tool log

## 2026-10-31T09:42:04+08:00 01a mutation check preflight
```
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
=== heavy.slice 资源用量 ===
  内存 39.0G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 2   CPU权重 50

=== 池 io（6 槽）===
3197 finished   /project/tmp/slot/ts-out.b9XM1x 0        1169.88/563.12/119.29 [nmu-ssr-profile-retry]/home/tcuni-claw/.local/share/slot/jobs/1793311321-2501926-4837.sh
3201 finished   /project/tmp/slot/ts-out.N4SOhz 0        15.72/13.23/0.82 [TC-Ai-50K-T44-stage1-acceptance]/home/tcuni-claw/.local/share/slot/jobs/1793325700-2850087-126.sh
3228 finished   /project/tmp/slot/ts-out.0OohyT 0        49.41/31.68/5.69 [tc-ai50k-ref-identity]/home/tcuni-claw/.local/share/slot/jobs/1793327212-2898679-6210.sh
3401 finished   /project/tmp/slot/ts-out.5X6PbP 0        17.12/2.53/0.37 [20261030T052245-f4938743]/home/tcuni-claw/.local/share/slot/jobs/1793337779-3293263-24259.sh
3402 finished   /project/tmp/slot/ts-out.LqAX1h 0        4.38/3.09/0.36 [20261030T052400-dd5dcc5f]/home/tcuni-claw/.local/share/slot/jobs/1793337855-3295852-28938.sh
3403 finished   /project/tmp/slot/ts-out.ajmyra 0        6.76/5.97/0.59 [20261030T052435-8ffbf7b2]/home/tcuni-claw/.local/share/slot/jobs/1793337887-3296987-14222.sh
3404 finished   /project/tmp/slot/ts-out.vwfoYr 0        0.38/0.28/0.05 [20261030T052518-a6f6934e]/home/tcuni-claw/.local/share/slot/jobs/1793337933-3299007-13733.sh
3406 finished   /project/tmp/slot/ts-out.rvqrfD 0        48.38/7.98/2.95 [tc-ai50k-cache-hash]/home/tcuni-claw/.local/share/slot/jobs/1793348362-3758816-6761.sh
3407 finished   /project/tmp/slot/ts-out.2rkOxp 0        44.04/8.10/2.52 [tc-ai50k-cache-hash2]/home/tcuni-claw/.local/share/slot/jobs/1793350012-3916289-28999.sh
3411 finished   /project/tmp/slot/ts-out.M0oqPo 0        9.11/0.23/0.50 [wheat-panel-b-search]/home/tcuni-claw/.local/share/slot/jobs/1793351609-4020910-21317.sh
3415 finished   /project/tmp/slot/ts-out.T37W5M 0        243.73/78.72/12.87 [TC-SXAU-xy6-db]/home/tcuni-claw/.local/share/slot/jobs/1793364192-205672-22984.sh
3417 finished   /project/tmp/slot/ts-out.Y1P6Dl 0        902.89/387.23/51.94 [TC-SXAU-3b-vdb182]/home/tcuni-claw/.local/share/slot/jobs/1793364242-206915-23641.sh
3419 finished   /project/tmp/slot/ts-out.1nVci0 0        14.83/1.38/0.98 [nmu-ssr-c2-preflight]/home/tcuni-claw/.local/share/slot/jobs/1793376808-572382-9133.sh
3420 finished   /project/tmp/slot/ts-out.KmTtya 0        0.73/0.50/0.19 [20261030T161344-3b293a39]/home/tcuni-claw/.local/share/slot/jobs/1793376858-573807-31510.sh
3422 finished   /project/tmp/slot/ts-out.fFhVIo 0        1.34/1.08/0.18 [20261030T161451-1f57f470]/home/tcuni-claw/.local/share/slot/jobs/1793376952-577160-13786.sh
3423 finished   /project/tmp/slot/ts-out.8iUAGj 0        0.80/0.49/0.21 [20261030T161853-5b2d38dc]/home/tcuni-claw/.local/share/slot/jobs/1793377160-582840-9978.sh
3424 finished   /project/tmp/slot/ts-out.fgYnCg 0        3.41/1.13/0.20 [20261030T161943-52c031b4]/home/tcuni-claw/.local/share/slot/jobs/1793377261-586028-4604.sh
3425 finished   /project/tmp/slot/ts-out.kK7aBO 0        0.52/0.31/0.07 [20261030T162155-aa2ab288]/home/tcuni-claw/.local/share/slot/jobs/1793377339-588201-5629.sh
3426 finished   /project/tmp/slot/ts-out.734ErY 0        737.02/354.73/45.65 [TC-SXAU-3b-vdb180]/home/tcuni-claw/.local/share/slot/jobs/1793400400-1264070-6168.sh
3421 finished   /project/tmp/slot/ts-out.O1knQF 1        28369.22/27318.62/180.86 [nmu-ssr-c2-full]/home/tcuni-claw/.local/share/slot/jobs/1793376878-574481-30739.sh

=== 池 cpu（16 槽）===
4331 finished   /project/tmp/slot/ts-out.vHQCIM 0        5044.84/4906.11/148.27 [TC-SXAU-s6-t-t]/home/tcuni-claw/.local/share/slot/jobs/1793335074-3171199-12919.sh
4363 finished   /project/tmp/slot/ts-out.qLld64 0        3346.78/3254.03/100.60 [TC-SXAU-s6-w-t]/home/tcuni-claw/.local/share/slot/jobs/1793340593-3391422-9281.sh
4375 finished   /project/tmp/slot/ts-out.i1B4gx 2        0.71/0.68/0.27 [tc-ai50k-ws2-ci]/home/tcuni-claw/.local/share/slot/jobs/1793344441-3543003-24624.sh
4376 finished   /project/tmp/slot/ts-out.G2xZfC 0        526.68/506.49/36.04 [tc-ai50k-ws2-ci2]/home/tcuni-claw/.local/share/slot/jobs/1793344514-3548014-30148.sh
4379 finished   /project/tmp/slot/ts-out.rbWbZd 0        6.28/2.68/0.53 [tc-ai50k-ws2-blast]/home/tcuni-claw/.local/share/slot/jobs/1793345150-3579729-24623.sh
4380 finished   /project/tmp/slot/ts-out.nmXmdF 1        1902.10/1848.00/28.80 [tc-ai50k-pool-screen]/home/tcuni-claw/.local/share/slot/jobs/1793345446-3600638-16090.sh
4385 finished   /project/tmp/slot/ts-out.DWTqYg 0        4.15/3.69/0.43 [tc-ai50k-tail-diag]/home/tcuni-claw/.local/share/slot/jobs/1793347603-3701179-7054.sh
4392 finished   /project/tmp/slot/ts-out.FahWlr -1       505.04/6.88/0.47 [tc-ai50k-pool-screen-r2]/home/tcuni-claw/.local/share/slot/jobs/1793348495-3769989-11174.sh
4400 finished   /project/tmp/slot/ts-out.BbEtS3 0        631.00/1733.73/41.54 [tc-ai50k-chunk13r]/home/tcuni-claw/.local/share/slot/jobs/1793349177-3865892-5470.sh
4388 finished   /project/tmp/slot/ts-out.AoxjWq 0        1885.21/2121.13/27.23 [tc-ai50k-chunked-blast]/home/tcuni-claw/.local/share/slot/jobs/1793348027-3732648-30135.sh
4402 finished   /project/tmp/slot/ts-out.eAfx5T 0        383.81/600.38/11.13 [tc-ai50k-chunk13tail]/home/tcuni-claw/.local/share/slot/jobs/1793349731-3907232-31041.sh
4403 finished   /project/tmp/slot/ts-out.EWvbKn -1       285.30/7.18/0.39 [tc-ai50k-pool-screen-r3]/home/tcuni-claw/.local/share/slot/jobs/1793350183-3923119-29395.sh
4374 finished   /project/tmp/slot/ts-out.ktNfWZ 0        6770.67/6594.09/183.78 [TC-SXAU-s6-t-w]/home/tcuni-claw/.local/share/slot/jobs/1793344303-3535526-19740.sh
4405 finished   /project/tmp/slot/ts-out.UtZHwC 0        1221.27/886.72/276.56 [tc-ai50k-pool-screen-r4]/home/tcuni-claw/.local/share/slot/jobs/1793350617-3949786-6440.sh
4418 finished   /project/tmp/slot/ts-out.UvZ6n2 1        33.20/27.91/4.95 [tc-ai50k-riskv2]/home/tcuni-claw/.local/share/slot/jobs/1793352041-4047201-2011.sh
4422 finished   /project/tmp/slot/ts-out.gOStwI 0        39.30/33.16/5.64 [tc-ai50k-riskv2-r2]/home/tcuni-claw/.local/share/slot/jobs/1793352337-4070406-20568.sh
4424 finished   /project/tmp/slot/ts-out.GZD4FI 0        2295.33/2244.60/47.36 [TC-SXAU-s9-xy6]/home/tcuni-claw/.local/share/slot/jobs/1793364672-219492-13920.sh
4434 finished   /project/tmp/slot/ts-out.bQVS5v 0        0.69/0.37/0.25 [20261030T162249-d81d4903]/home/tcuni-claw/.local/share/slot/jobs/1793377398-589750-22338.sh
4435 finished   /project/tmp/slot/ts-out.lCxcw3 0        1.22/0.93/0.21 [20261030T162341-75d97a36]/home/tcuni-claw/.local/share/slot/jobs/1793377450-591195-8292.sh
4436 finished   /project/tmp/slot/ts-out.yVA1b8 0        0.30/0.12/0.11 [20261030T162434-92a2d9ac]/home/tcuni-claw/.local/share/slot/jobs/1793377506-592893-3733.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
590  finished   /project/tmp/slot/ts-out.17LagV 1        175768.12/960790.06/19550.97 [TC-Ai-50K-T44-resume-a2]/home/tcuni-claw/.local/share/slot/jobs/1793092030-3427860-27919.sh
602  finished   /project/tmp/slot/ts-out.IHokxZ 0        38.01/243.87/11.17 [rimu-ngs-current-fixture]/home/tcuni-claw/.local/share/slot/jobs/1793348531-3776176-26689.sh
603  finished   /project/tmp/slot/ts-out.0BcVzj 0        10.26/10.51/1.07 [rimu-g2-executor-harness]/home/tcuni-claw/.local/share/slot/jobs/1793349221-3875223-28318.sh
604  finished   /project/tmp/slot/ts-out.AjAkaE 0        5.26/17.48/0.85 [rimu-split-module-fixture-163719]/home/tcuni-claw/.local/share/slot/jobs/1793349478-3898942-21456.sh
610  finished   /project/tmp/slot/ts-out.iLpvTy 0        275.96/291.74/6.89 [rimu-ngs-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793351203-3991814-20404.sh
611  finished   /project/tmp/slot/ts-out.8ArDB3 0        249.23/266.22/6.50 [20261030T162615-83842e5b]/home/tcuni-claw/.local/share/slot/jobs/1793377627-596837-30072.sh
```

## 2026-10-31 01a 验收核对（Root）
- 01a 提交 e86744a（分支 feat/reviewer-git-query，worktree /home/tcuni-claw/pi/worktrees/reviewer-git-query），worker run 4475b12d。
- Root 复跑（TMPDIR=/project/tmp/reviewer-git-tool）：reviewer-git.test.mjs exit 0（约 30s）；git.test.mjs exit 0；reviewer-range.test.mjs exit 0（由 delegate.test.mjs import，进入 npm test）；tsc --noEmit exit 0。
- 变异检查：脚本 /project/tmp/reviewer-git-tool/mutate.mjs，经 `slot cpu` 运行，结果在 /project/tmp/reviewer-git-tool/mutate-01a.txt。19 个变异里 17 个被测试杀死；2 个存活：
  - refsOnly：去掉 `refs/(heads|remotes|tags)/` 限制后测试仍过，缺少 `stash`、`refs/notes/x` 等应被拒绝的用例；
  - whitelist：去掉运行时子命令白名单检查后测试仍过，缺少直接调用非白名单子命令被拒的用例。
- 待办：补这两个用例后 01a 才算验收；worker 自述执行器故障注入和 SHA-256 用例是实现后补写的（TDD 顺序偏离），由变异检查替代红灯证据。
- 已知小问题（不阻塞，02 处理）：query 层空串 path 会被拒绝，spec 第 3 节要求“空字符串视为未提供”，应在 02 的入口层把空串映射为 undefined；log 的 `${mergeBase}..${head}` 后没有 `--`（建议补上）；head/rev 的 ref 错误信息仍写作 "invalid base ref"。

## 2026-10-31 01a 补测核对（Root）
- worker run 0cb7de1a（续用 4475b12d，模型不变）提交 df2d0d0：补 refsOnly（stash、notes 被拒）与 whitelist（非白名单子命令被拒且未调用底层执行）用例；log 范围后补 `--`；ref 错误信息按字段区分 head/base。worker 报告了四项红灯与绿灯。
- 重跑变异检查前：`slot audit` 没发现绕过 slot 的重进程；`slot status` 显示 io/cpu/gpu/nf 各池均无 running/queued。首轮结果另存为 mutate-01a-r1.txt。
- `slot cpu -- node mutate.mjs` 退出 0；19 个变异全部被杀死（mutate-01a.txt）。Root 复跑未变异的 reviewer-git.test.mjs 退出 0（约 31s），`tsc --noEmit` 退出 0。01a 验收通过（df2d0d0）。
- 下一步：01b `diff`，同一 worktree。

## 2026-10-31 01b-1 diff 概览核对（Root）
- worker run 2b1773ef 提交 30e4e88（git.ts、reviewer-git.test.mjs）。worker 报告红灯为 `Error: diff not implemented`，之后绿灯。Root 复跑 reviewer-git.test.mjs：5 pass，耗时约 31s；`tsc --noEmit` 退出 0。
- 变异检查 mutate-01b1.mjs（9 个：去掉各个 diff 安全选项、gitlink 判定、binary 计数、“逐文件读取尚未验证”标记、raw/numstat 配对与路径一致性校验）。启动前 `slot audit` 没发现绕过 slot 的重进程；`slot status` 中没有 running/queued 任务。
- 结果（mutate-01b1.txt，两轮）：第 1 轮有 3 个变异因模式在文件中出现多次而跳过，改用唯一模式重跑。最终 noIgnoreSub、noExtDiff、noTextconv、noRenames、gitlinkMode、binaryCount、pendingNote、nameCheck 均被杀死；pairCheck（`records.length !== stats.length * 2`）存活，numstat 少一条记录时，概览会静默漏掉该文件。
- Root 补测 f3b5429：故障注入变体 numstat-missing-last。去掉该守卫后红灯为 `Missing expected rejection: numstat-missing-last`；恢复后 reviewer-git.test.mjs 5 pass。01b-1 验收通过。
- 下一步：01b-2 带 path 的 diff，续用原 worker。

## 2026-10-31 01b-2 逐文件 diff 核对（Root）
- worker run 03459d09 提交 bbe3ae0。红灯为 `diff not implemented`，之后绿灯。路径在范围内没有改动时返回空正文（N=0）；log 收到 path 时拒绝。Root 复跑 reviewer-git.test.mjs：8 pass，约 31s；tsc 退出 0。
- 变异检查 mutate-01b2.mjs（10 个）。启动前 `slot audit` 没发现绕过 slot 的重进程；`slot status` 中没有 running/queued 任务。
- 结果（mutate-01b2.txt）：8 个被杀死（NUL 检查、两侧 blob、gitlink、numstat binary、patch 算法、前缀、log 拒 path、path 校验）。存活的 2 个判为等价变异，不补测：
  - rawSingle（`records.length !== 3`）：多条 raw 记录时 `records[2] !== ""` 已拒绝；
  - pathIdentity（身份去掉 path）：patch 正文的 `diff --git a/<path>` 头已含路径，空正文 N=0 时不会出现 offset>1。
- 01b 验收通过（bbe3ae0）。下一步：01c `show`。

## 2026-10-31 01c show 核对（Root）
- worker run f7e2a6b5 提交 dc24baf。worker 报告红灯为 `show not implemented`，之后转绿。
- Root 补 6a148d8：spec 第 6 节的白名单是 `show -s` 和 `cat-file blob`，而原实现只检查子命令名。whitelist 用例加了 `show HEAD`、`cat-file -p/--batch/--textconv`，红灯为 `Missing expected rejection: show HEAD`。修改后 reviewer-git.test.mjs 10 pass；git.test.mjs、reviewer-range.test.mjs、tsc 均退出 0。
- 变异检查 mutate-01c.mjs（12 个）。启动前 `slot audit` 没发现绕过 slot 的重进程；`slot status` 中没有 running/queued 任务。
- 结果（mutate-01c.txt）：11/12 被杀死。showIdentityPath（show 的身份去掉 path）存活，判为等价变异：只有两个路径正文完全相同时 contentId 才会相同，此时各页内容一致，contentId 的保证不受影响。
- 01 查询模块验收通过（分支 feat/reviewer-git-query，HEAD 6a148d8）。下一步：02 入口与契约。

## 2026-10-31 02a 入口核对（Root）
- worker run e0f0b9c9 提交 18561fc：新增 reviewer-git.ts、reviewer-git-runtime.test.mjs（加入 scripts.test），package.json files 加入 reviewer-git.ts。worker 报告的红灯是入口文件不存在、files 中缺少该文件，之后转绿。
- Root 复跑 reviewer-git-runtime.test.mjs：2 pass。测试用宿主 DefaultResourceLoader 与 createAgentSession 加载，断言：只注册 git_review；成功调用的文本原样进入结果；失败调用 isError=true；`path: ""` 视为未提供；pi.extensions 仍是 ["./index.ts"]；入口不 import index.ts。
- 部署位置：操作员 settings 的 packages 里含 `https://github.com/bioShaun/pi-planner-only`，检出在 ~/.pi/agent/git/github.com/bioShaun/pi-planner-only。03 的 subagentOnlyExtensions 将指向该目录下的 reviewer-git.ts，前提是合并、推送并更新包之后。

## 2026-10-31 02b 契约与提示核对（Root）
- worker run e25d9796 提交 d888db3：新增 scripts/check-reviewer-config.mjs（真实 discoverAgents + resolvePiLaunchToolPlan，CLI 为 `node scripts/check-reviewer-config.mjs [cwd]`），contract.test.mjs 加隔离 fixture 和两例故障注入（项目 override 加 bash、扩展文件不存在），并改了提示文本。worker 报告红灯为检查模块缺失、提示断言失败，之后转绿。默认安装下 contract.test 缺 `@earendil-works/pi-ai`，绿灯用的是隔离安装（PI_SUBAGENTS_DIR）。
- 处理 worker 的阻塞请求：plannerPrompt 的 <1500 字符断言（issue #25 的预算）不放宽。
- Root 修正 f7c1260：
  - 恢复 worker 为省字符改写的两句无关提示（"You plan and review; …"、"role combinations are in the delegate description"）；
  - reviewer 角色行只去掉 "only"，改为 "has no shell; review uncommitted changes before git_commit."，plannerPrompt 为 1492/1483 字符；
  - delegate.ts 中写给 Root 的 git_review 指引从 reviewer 的任务文本挪到 range 准备失败（如 >32 KiB）时返回给 Root 的拒绝信息。
- 红灯：index.test 新断言不匹配；delegate.test 报 "Root guidance must not be sent to the reviewer"。绿灯：index.test、delegate.test、reviewer-range.test、tsc 均通过。
- 与 spec 第 7 节的偏差：index.ts:73 没有补 git_review 说明（受 1500 字符预算限制），条件说明放在 delegate 的 role 描述和拒绝信息里。

## 2026-10-31 实现审查第 1 轮（reviewer run d80d41ce，范围 b794fa6..f7c1260）
- 结论 CHANGES REQUESTED。报告：~/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/subagent-artifacts/d80d41ce-dd9f-4ec8-9692-c32688e6f86c_reviewer_output.md；复现脚本在 /project/tmp/reviewer-git-tool/review-f7c1260/。
- 必须修改 5 项，全部采纳：
  1. BOM 被 TextDecoder 吞掉；
  2. `(no newline at end)` 应放在 footer（spec 第 4 节“尾行”），不应拼进正文行；
  3. SHA-256 仓库接受 40 位前缀；
  4. 空正文跳过 40 KiB 页面检查；
  5. A1 缺 `.git` 快照；promisor 测试假阳性（去掉 `--no-lazy-fetch` 后仍通过）；fsmonitor 没有真实 hook 测试。
- 建议 2 项，采纳：
  - show/log 加 `--no-mailmap --no-decorate --no-color --no-notes`。spec 第 5 节已同步收紧，这是 Root 决定，理由是与“固定内容”的契约一致；
  - 补 contentId 身份断言。之前把 showIdentityPath、pathIdentity 记为“等价变异”的理由不成立：身份是显式契约，不能用正文相同来豁免。
- 已接受的偏差：index.ts:73 受 1500 字符预算限制；Root 指引放在拒绝信息中。
- 修复委派给 worker run 44b4c2d2（续用 f7e2a6b5，模型不变）。

## 2026-10-31 实现审查第 2 轮（reviewer run dd08875e，范围 f7c1260..c54911e）
- 修复由 worker run 44b4c2d2 提交 c54911e；Root 复跑 reviewer-git 16/16、runtime 2/2，git/reviewer-range/index/delegate 测试和 tsc 均通过。
- 复审 PASS，Merge verdict OK，无新问题。报告：subagent-artifacts/dd08875e-f484-4252-8d86-ded193838db0_reviewer_output.md。fsmonitor 的阳性对照只能证明 fixture 有效（git status 会触发 hook）；`core.fsmonitor=false` 保护的存在由前缀断言覆盖。
- 未验证项：`--no-mailmap/--no-decorate/--no-notes` 只在 Git 2.51 上测过，没有用 2.45 实测。

## 2026-10-31 A14 完整门禁（Root）
- 预检：`slot audit` 无绕过 slot 的重进程；`slot status` heavy.slice 63.9G/64.0G 软限、进程 2，io/cpu/gpu/nf 池无运行中作业。
- 独立检出：`git worktree add --detach /project/tmp/reviewer-git-tool/gate-157e51f 157e51f`；HEAD 157e51fd25e61f9c72826b84c6e2f0e46295e47f，tree 96b085d683501fdb465604addf543524c1f35cba；TMPDIR=/project/tmp/reviewer-git-tool/gate-tmp。
- `slot cpu -- npm run test:release`：exit 1。tsc 和 isolated-release 7/7 通过，contract.test 在默认安装下报 `Cannot find package '@earendil-works/pi-ai'`，按 AGENTS.md 改跑 isolated。日志 /project/tmp/reviewer-git-tool/gate-release.log。
- `slot cpu -- npm run test:release:isolated`：**exit 0**。tsc 通过，contract.test 通过（含 installed cost RPC 和 async/workflow artifacts），reviewer-git 16/16、runtime 2/2，delegate、host、host-runtime（1.4.0）、handoff、status-color、index 均通过，native-handoff 42/42。日志 /project/tmp/reviewer-git-tool/gate-isolated.log。
- 门禁之后检出 HEAD 和 tree 不变（157e51f / 96b085d），`git status --porcelain` 为空（node_modules 用符号链接接到主检出，已被 gitignore）。A14 通过。

## 2026-10-31 推送与 03 部署（Root）
- 用户确认“可以推送”。`git push origin main`：2d45933..123fd1a。
- `pi update https://github.com/bioShaun/pi-planner-only`：前两次网络失败（GnuTLS recv error、连接超时），第三次成功。已安装检出从 e1d0ab6 更新到 123fd1a，reviewer-git.ts 已存在。
- 备份：settings.json、reviewer.md → /project/tmp/reviewer-git-tool-backup/。
- settings.json 的 `subagents.agentOverrides.reviewer` 新增 subagentOnlyExtensions（指向已安装检出的 reviewer-git.ts）和 tools（read, grep, find, ls, watchdog_diff, contact_supervisor, git_review）。和备份比，只多了这两个字段。
- reviewer.md：
  - 第 4 行 tools 改为同一份列表；
  - 第 25–27 行改写：已提交范围用 git_review 或任务提供的完整 patch，读不完就报 INCOMPLETE，不给 PASS；没有 shell，需要运行的命令写进报告交给 supervisor/validator；保留不修改仓库的约束。
  - 第 28 行原来是“引用命令、退出码、日志”，现在 reviewer 不能运行命令，改为引用回显的 SHA、文件和行号。这是 Root 决定，理由是原句已经无法执行。
- A13 检查（真实配置）：`node scripts/check-reviewer-config.mjs` 和 `node scripts/check-reviewer-config.mjs /project/tmp` 均 exit 0。有效工具等于部署列表，扩展存在。默认安装的 pi-subagents 可以直接加载该脚本。
- A15：已派 reviewer run 2186578e，审查 b794fa6..157e51f（116538 字节，14 个文件）。审查前 HEAD 123fd1a，status 快照在 /project/tmp/reviewer-git-tool/a15/。
- A15 结果（reviewer run 2186578e，async）：
  - 启动描述 recovery-descriptor.json 里 tools 为 [read, grep, find, ls, watchdog_diff, contact_supervisor, git_review]，subagentOnlyExtensions 指向已安装的 reviewer-git.ts。child 自报工具相同，没有 bash；会话中工具调用为 git_review 18 次、read 14 次、grep 3 次、ls 1 次。
  - 前两次传短 SHA 被拒，符合 A3。之后 child 读 `.git/logs/HEAD` 取到完整 SHA，概览 1 页加 14/14 个文件共 16 页全部读完（reviewer-git.test.mjs 分 2 页，用同一个 contentId 续页）。
  - 结论引用 b794fa6dd3b4…ee7..157e51fd25e6…e2f0，Merge verdict 为 OK with notes，没有必须修改项。报告：subagent-artifacts/2186578e-309c-4810-9e6c-7e825cc82abe_reviewer_output.md。
  - 审查后 HEAD 仍为 123fd1a。status 与快照相比只多了 log.md，原因是 Root 在快照之后追加了记录，diff 是纯新增 12 行，与 reviewer 无关。
- 前台补充核对（reviewer run 4d97eeba，sync）：child 工具列表与上面相同，没有 bash；git_review 可以调用，按契约拒绝了 Root 写错的参数（log 不接受 rev）。
- 结论：async 和前台两种启动方式都挂载了 git_review，且都没有 bash。
- 未验证：Git 2.45 实机。
- 可用性备注：任务中只给短 SHA 时，reviewer 只能绕道读 .git 取完整 SHA。派 reviewer 审查已提交范围时应给完整 SHA 或分支名。

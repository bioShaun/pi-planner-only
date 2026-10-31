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

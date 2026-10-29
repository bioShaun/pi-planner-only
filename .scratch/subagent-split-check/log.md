# subagent-split-check 项目日志

## 2026-10-29T14:03:26+08:00 slot 预检（全量 Root 缓存分析前）

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 56.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 346   CPU权重 50

=== 池 io（6 槽）===
3087 finished   /project/tmp/slot/ts-out.sl3eNX 0        224.31/11.83/0.72 [mouse-e116-model-review-fixture]/home/tcuni-claw/.local/share/slot/jobs/1793242811-220915-2139.sh
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh

=== 池 cpu（16 槽）===
4048 finished   /project/tmp/slot/ts-out.9uQvnh 0        72.09/56.79/39.44 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252712-2096306-12513.sh
4053 finished   /project/tmp/slot/ts-out.7AQkA2 0        6.09/7.08/0.77 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252828-2133121-31764.sh
4056 finished   /project/tmp/slot/ts-out.R70rvT 0        0.87/3.86/0.09 [LQL008-v5compat-B73V4_ctg6]/home/tcuni-claw/.local/share/slot/jobs/1793252963-2163293-18404.sh
4058 finished   /project/tmp/slot/ts-out.lMRW2K 0        178.08/58.71/2.65 [LQL008-v5compat-Chr10]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163584-4201.sh
4059 finished   /project/tmp/slot/ts-out.a2Rs79 0        211.17/71.19/3.04 [LQL008-v5compat-Chr2]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163782-31962.sh
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh

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
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## 2026-10-29T14:04:32+08:00 全量分析

会话目录在本地 nvme（非 /data_0），用 slot cpu。命令：
```
slot cpu -- python3 -B bench/root_cache.py ~/.pi/agent/sessions --json /project/tmp/ppo-root-cache/all-native.txt
slot cpu -- python3 -B bench/root_cache.py ~/.pi/agent/sessions --mode any --json /project/tmp/ppo-root-cache/all-any.json
```

结果（初版，含 fork 子会话，作废待重跑）：native 1500 文件 / 2848 轮，耗时 2.5s；any 39141 轮。
发现：`forks/` 下 6 个 fork 子代理会话复制了父会话历史并带 native 标记，贡献 686 轮（含 subagent/5-60m 41 轮，全为 tcuni/gpt-6-astra）。`run-N/` 子运行 875 个，不带模式标记，仅影响 --mode any。开 issue 03 修正后重跑。

## 2026-10-29T14:06:31+08:00 slot 预检（issue 03 后重跑）
```
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
=== heavy.slice 资源用量 ===
  内存 58.4G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 287   CPU权重 50

```
重跑完成：native/any 输出见 /project/tmp/ppo-root-cache/all-{native,any}.{txt,json}

## 2026-10-29T14:08:21+08:00 报告

结论写入 `root-cache-report.md`。Claude 细分与长保留期估算用临时脚本 `/project/tmp/ppo-root-cache/claude_gaps.py`（slot cpu，native/any 各一次）。probe/ 已删除。

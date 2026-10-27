# Resource preflight

2026-10-26, before the release check.

```text
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。

$ slot status
=== heavy.slice 资源用量 ===
  内存 46.5G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 529   CPU权重 50

=== 池 io（6 槽）===
2899 finished   /project/tmp/slot/ts-out.IwvL0f 1        0.06/0.02/0.00 [io]/home/tcuni-claw/.local/share/slot/jobs/1792653106-1207996-3896.sh
2894 finished   /project/tmp/slot/ts-out.HjZoew 0        6714.22/8544.97/251.03 [ssr-100-DR-20261022-004]/home/tcuni-claw/.local/share/slot/jobs/1792651938-1079286-31721.sh
2903 finished   /project/tmp/slot/ts-out.FkzAxm 0        5093.26/60.19/38.76 [io]/home/tcuni-claw/.local/share/slot/jobs/1792657842-1824640-22734.sh
2926 finished   /project/tmp/slot/ts-out.phrCSl -1       242.00/0.00/0.00 [tc-sweetpotato-con-v1-vcf-download-20261022-a2]/home/tcuni-claw/.local/share/slot/jobs/1792683696-1430497-18549.sh
2925 finished   /project/tmp/slot/ts-out.0XnQcD -1       451.20/0.00/0.00 [tanzania-con-v1-reference-20261022-a1]/home/tcuni-claw/.local/share/slot/jobs/1792683494-1389634-23199.sh
2927 finished   /project/tmp/slot/ts-out.sj0kpd 1        0.02/0.00/0.00 [tc-sweetpotato-con-v1-vcf-download-20261022-a3]/home/tcuni-claw/.local/share/slot/jobs/1792684049-1503864-30600.sh
2929 finished   /project/tmp/slot/ts-out.Hhej2K 1        0.02/0.00/0.00 [tc-sweetpotato-con-v1-vcf-download-20261022-a4]/home/tcuni-claw/.local/share/slot/jobs/1792684095-1512165-23345.sh
2928 finished   /project/tmp/slot/ts-out.aW8og7 -1       200.00/0.00/0.01 [tanzania-con-v1-reference-20261022-a2]/home/tcuni-claw/.local/share/slot/jobs/1792684061-1506504-20889.sh
2934 finished   /project/tmp/slot/ts-out.HWYQoG 0        256.96/2.21/0.63 [tanzania-con-v1-sources-only-20261022]/home/tcuni-claw/.local/share/slot/jobs/1792684498-1580071-31028.sh
2935 finished   /project/tmp/slot/ts-out.xW7vM3 26       20.67/19.70/0.89 [tanzania-con-v1-reference-build-a1]/home/tcuni-claw/.local/share/slot/jobs/1792685334-1713821-2433.sh
2937 finished   /project/tmp/slot/ts-out.rCl8WA -1       87.47/0.02/0.01 [tanzania-con-v1-reference-resume-a2]/home/tcuni-claw/.local/share/slot/jobs/1792685689-1768220-8489.sh
2938 finished   /project/tmp/slot/ts-out.4ptAz0 1        211.57/642.27/11.54 [tanzania-con-v1-reference-resume-a3]/home/tcuni-claw/.local/share/slot/jobs/1792685848-1796146-13892.sh
2931 finished   /project/tmp/slot/ts-out.QRrnKm -1       41842.48/0.00/0.00 [tc-sweetpotato-con-v1-vcf-download-20261022-a5]/home/tcuni-claw/.local/share/slot/jobs/1792684123-1517134-25541.sh
2943 finished   /project/tmp/slot/ts-out.8bbS9C 1        0.05/0.00/0.02 [tc-sweetpotato-vcf-preserve-pcs-partial-20261023]/home/tcuni-claw/.local/share/slot/jobs/1792725990-3054107-17699.sh
2944 finished   /project/tmp/slot/ts-out.0Af7jE 0        18.01/16.23/1.70 [tc-sweetpotato-vcf-preserve-pcs-partial-copy-20261023]/home/tcuni-claw/.local/share/slot/jobs/1792726025-3059636-20662.sh
2945 finished   /project/tmp/slot/ts-out.EPzFwG 15       35.36/0.76/1.05 [tc-sweetpotato-vcf-locate-resume-compat-test-20261023]/home/tcuni-claw/.local/share/slot/jobs/1792726062-3065874-8.sh
2946 finished   /project/tmp/slot/ts-out.mpce6n -1       24.68/0.37/0.48 [tc-sweetpotato-vcf-locate-switch-resume-20261023]/home/tcuni-claw/.local/share/slot/jobs/1792726082-3068660-22947.sh
2947 finished   /project/tmp/slot/ts-out.3pvqWR 1        0.02/0.00/0.00 [tc-sweetpotato-vcf-locate-resume-20261023]/home/tcuni-claw/.local/share/slot/jobs/1792726116-3075165-9866.sh
2948 finished   /project/tmp/slot/ts-out.yrkZXC -1       2474.53/41.11/85.14 [tc-sweetpotato-vcf-locate-resume-20261023-r2]/home/tcuni-claw/.local/share/slot/jobs/1792726126-3076791-28425.sh
3026 finished   /project/tmp/slot/ts-out.5T1lNK 0        2129.25/50.00/80.13 [tc-sweetpotato-vcf-locate-resume-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792980113-3586198-4246.sh

=== 池 cpu（16 槽）===
3314 finished   /project/tmp/slot/ts-out.JV4sTT 0        45.92/36.68/5.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1792517248-1433342-3583.sh
3321 finished   /project/tmp/slot/ts-out.2aIwO9 1        3447.97/21368.00/183.57 [tc-ai50k-bt2-index]/home/tcuni-claw/.local/share/slot/jobs/1792574330-16838-10379.sh
3346 finished   /project/tmp/slot/ts-out.6OcsaO 0        476.55/740.33/24.24 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1792651230-1002696-26788.sh
3376 finished   /project/tmp/slot/ts-out.UZtJMw 1        0.45/0.07/0.23 [tanzania-con-v1-gtf-bed-cal-publish-a1]/home/tcuni-claw/.local/share/slot/jobs/1792725715-3008554-26930.sh
3377 finished   /project/tmp/slot/ts-out.JXqQ2A 31       0.03/0.00/0.00 [tanzania-con-v1-gtf-bed-cal-publish-a2]/home/tcuni-claw/.local/share/slot/jobs/1792725734-3011334-24235.sh
3378 finished   /project/tmp/slot/ts-out.FbHx4t 1        8.58/6.54/1.23 [tanzania-con-v1-gtf-bed-cal-publish-a3]/home/tcuni-claw/.local/share/slot/jobs/1792725779-3016510-30430.sh
3379 finished   /project/tmp/slot/ts-out.lCYr3B 1        5.24/3.87/0.92 [tanzania-con-v1-gtf-bed-cal-publish-a4]/home/tcuni-claw/.local/share/slot/jobs/1792726394-3117335-1153.sh
3380 finished   /project/tmp/slot/ts-out.luDRsP 1        14493.71/14456.66/13.21 [tanzania-con-v1-gtf-bed-cal-publish-a5]/home/tcuni-claw/.local/share/slot/jobs/1792726764-3172735-10010.sh
3546 finished   /project/tmp/slot/ts-out.GPQeM2 0        94.22/164.76/4.30 [tanzania-con-v1-gtf-bed-cal-publish-resume-a6]/home/tcuni-claw/.local/share/slot/jobs/1792980234-3604416-1939.sh
3547 finished   /project/tmp/slot/ts-out.3KTjNE 0        549.31/1544.07/29.45 [tc-ai50k-chr10-cal110-s10000-a01]/home/tcuni-claw/.local/share/slot/jobs/1792986377-204905-12758.sh
3559 finished   /project/tmp/slot/ts-out.FkMQaY 0        568.04/1678.69/15.13 [tc-ai50k-q099-audit-20261026T133721]/home/tcuni-claw/.local/share/slot/jobs/1792993100-932850-12701.sh
3564 finished   /project/tmp/slot/ts-out.LX0ZUL 0        2.37/2.89/0.92 [nipponbare-r498-tc-by-rice-6k-a3-validation]/home/tcuni-claw/.local/share/slot/jobs/1793001218-1935722-22303.sh
3568 finished   /project/tmp/slot/ts-out.uu66ro 1        7.08/8.25/1.68 [nipponbare-r498-tc-by-rice-6k-a4-full-rescue]/home/tcuni-claw/.local/share/slot/jobs/1793001607-1992151-30459.sh
3569 finished   /project/tmp/slot/ts-out.cnUZKl 1        6.35/8.25/1.60 [nipponbare-r498-tc-by-rice-6k-a5-full-rescue]/home/tcuni-claw/.local/share/slot/jobs/1793001736-2012269-25553.sh
3570 finished   /project/tmp/slot/ts-out.eKCTGQ 1        0.46/1.88/0.06 [nipponbare-r498-tc-by-rice-6k-a5-rescue-delivery]/home/tcuni-claw/.local/share/slot/jobs/1793001784-2019580-334.sh
3571 finished   /project/tmp/slot/ts-out.42Md5N 1        0.45/1.97/0.06 [nipponbare-r498-tc-by-rice-6k-a5-verify-delivery]/home/tcuni-claw/.local/share/slot/jobs/1793001827-2026046-1859.sh
3572 finished   /project/tmp/slot/ts-out.Ib0UoZ 0        0.88/2.15/0.07 [nipponbare-r498-tc-by-rice-6k-a5-verified-finalize]/home/tcuni-claw/.local/share/slot/jobs/1793001873-2032495-27290.sh
3573 finished   /project/tmp/slot/ts-out.RFHEI5 1        1.32/4.45/0.20 [nipponbare-r498-tc-by-rice-6k-a6-strict-rescue]/home/tcuni-claw/.local/share/slot/jobs/1793002388-2110622-20187.sh
3574 finished   /project/tmp/slot/ts-out.nXq1Sg 1        1.23/4.59/0.21 [nipponbare-r498-tc-by-rice-6k-a6-strict-rescue-r2]/home/tcuni-claw/.local/share/slot/jobs/1793002467-2123540-28282.sh
3575 finished   /project/tmp/slot/ts-out.oBugjg 0        2.05/4.92/0.22 [nipponbare-r498-tc-by-rice-6k-a6-strict-final-rescue]/home/tcuni-claw/.local/share/slot/jobs/1793002545-2135491-15339.sh

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
499  finished   /project/tmp/slot/ts-out.FA7rDK 1        31.87/150.79/6.35 [wolfiporia-vertical-matrix-v2-r11]/home/tcuni-claw/.local/share/slot/jobs/1792397722-2102256-31448.sh
500  finished   /project/tmp/slot/ts-out.NPnBQp 0        37.64/165.29/7.12 [wolfiporia-vertical-matrix-v2-r12]/home/tcuni-claw/.local/share/slot/jobs/1792397779-2108445-12221.sh
501  finished   /project/tmp/slot/ts-out.RvRlaB 1        34.88/45.91/0.75 [pv-VR-20261019-001-full]/home/tcuni-claw/.local/share/slot/jobs/1792397993-2126153-15605.sh
502  finished   /project/tmp/slot/ts-out.deKD39 0        55.74/98.83/2.89 [pv-VR-20261019-001-attempt-002]/home/tcuni-claw/.local/share/slot/jobs/1792398176-2138029-6919.sh
503  finished   /project/tmp/slot/ts-out.a9TJAI 0        5.06/10.21/0.49 [20261019T042727-332474b9]/home/tcuni-claw/.local/share/slot/jobs/1792399435-2216985-27737.sh
504  finished   /project/tmp/slot/ts-out.oVle1z 1        2248.24/2191.97/395.75 [wolfiporia-gca034769205-calling-a01]/home/tcuni-claw/.local/share/slot/jobs/1792402880-2412268-23933.sh
507  finished   /project/tmp/slot/ts-out.VExcpO 1        41.25/25.26/10.11 [tc-ai50k-pilot-prefilter]/home/tcuni-claw/.local/share/slot/jobs/1792638104-3483769-2866.sh
508  finished   /project/tmp/slot/ts-out.HgKTcD 0        17171.00/36560.77/582.92 [tc-ai50k-pilot-v2]/home/tcuni-claw/.local/share/slot/jobs/1792638335-3555442-2827.sh
525  finished   /project/tmp/slot/ts-out.BXvhrN 0        6203.60/24056.59/301.16 [tc-ai50k-pilot-chr10]/home/tcuni-claw/.local/share/slot/jobs/1792683679-1425603-6057.sh
542  finished   /project/tmp/slot/ts-out.bameuj 1        1.12/1.91/0.19 [tc-ai50k-pilot-chr10-center-offset10]/home/tcuni-claw/.local/share/slot/jobs/1792741550-1100325-119.sh
543  finished   /project/tmp/slot/ts-out.pOq2BE 0        1610.06/7542.30/137.05 [tc-ai50k-pilot-chr10-center-offset10-r2]/home/tcuni-claw/.local/share/slot/jobs/1792741566-1102717-14426.sh
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
```

## preflight 2026-09-24T06:35:16+08:00
```
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
=== heavy.slice 资源用量 ===
  内存 9.1G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 5   CPU权重 50

=== 池 io（6 槽）===
416  finished   /project/tmp/slot/ts-out.Fs73PY 0        1354.64/1189.49/66.55 [pea-zw6-known-vcf-finish5]/home/tcuni-claw/.local/share/slot/jobs/1789776408-840457-3693.sh
410  finished   /project/tmp/slot/ts-out.5uiRkO 0        56669.14/25045.26/6239.98 [io]/home/tcuni-claw/.local/share/slot/jobs/1789721514-3580292-6938.sh
462  finished   /project/tmp/slot/ts-out.AyBozj 1        0.04/0.16/0.00 [sp10k-positions]/home/tcuni-claw/.local/share/slot/jobs/1789961101-1714383-28948.sh
463  finished   /project/tmp/slot/ts-out.cfjBWX 0        609.21/768.91/24.66 [sp10k-positions-r2]/home/tcuni-claw/.local/share/slot/jobs/1789961193-1727611-24041.sh
464  finished   /project/tmp/slot/ts-out.0YxWsD 0        421.37/446.67/30.06 [sp10k-step2-tags]/home/tcuni-claw/.local/share/slot/jobs/1789961942-1829909-4.sh
708  finished   /project/tmp/slot/ts-out.PguJYk 0        1393.30/1633.40/131.91 [io]/home/tcuni-claw/.local/share/slot/jobs/1790083964-870936-27937.sh
709  finished   /project/tmp/slot/ts-out.1mctyE 0        9.47/10.27/0.79 [io]/home/tcuni-claw/.local/share/slot/jobs/1790086814-1182708-8245.sh
710  finished   /project/tmp/slot/ts-out.NBLKSw 0        155.93/150.80/3.42 [io]/home/tcuni-claw/.local/share/slot/jobs/1790088559-1359194-32.sh
711  finished   /project/tmp/slot/ts-out.qW20U2 0        157.05/153.61/3.05 [io]/home/tcuni-claw/.local/share/slot/jobs/1790091704-1679227-28448.sh
798  finished   /project/tmp/slot/ts-out.43Tbah 0        376.12/674.29/30.96 [fe-r1-extract-usb481]/home/tcuni-claw/.local/share/slot/jobs/1790153837-1073828-24628.sh
797  finished   /project/tmp/slot/ts-out.L6xmqN 0        512.65/781.37/22.93 [fe-r1-extract-1556]/home/tcuni-claw/.local/share/slot/jobs/1790153827-1072633-4037.sh
834  finished   /project/tmp/slot/ts-out.pXrP4d 127      0.03/0.00/0.00 [fe-r2-ext-1556]/home/tcuni-claw/.local/share/slot/jobs/1790159265-2704642-29719.sh
835  finished   /project/tmp/slot/ts-out.31zKtX 127      0.03/0.00/0.00 [fe-r2-ext-usb481]/home/tcuni-claw/.local/share/slot/jobs/1790159276-2706252-10718.sh
839  finished   /project/tmp/slot/ts-out.72cnSE 0        429.98/750.82/32.00 [fe-r2-ext-usb481]/home/tcuni-claw/.local/share/slot/jobs/1790159521-2742103-28572.sh
838  finished   /project/tmp/slot/ts-out.pFMdJT 0        635.24/936.56/22.96 [fe-r2-ext-1556]/home/tcuni-claw/.local/share/slot/jobs/1790159521-2742104-25050.sh
936  finished   /project/tmp/slot/ts-out.wUxTzt 0        7.29/7.94/0.35 [fe-r5-snpidx]/home/tcuni-claw/.local/share/slot/jobs/1790184950-3250293-16635.sh
944  finished   /project/tmp/slot/ts-out.IZnaG0 0        61.69/109.36/4.69 [io]/home/tcuni-claw/.local/share/slot/jobs/1790186323-3501325-6150.sh
943  finished   /project/tmp/slot/ts-out.rANkSi 0        78.32/119.86/3.20 [io]/home/tcuni-claw/.local/share/slot/jobs/1790186317-3500301-13742.sh
959  finished   /project/tmp/slot/ts-out.Hbk6sE 0        56.76/101.47/4.33 [fe-r6-ext481]/home/tcuni-claw/.local/share/slot/jobs/1790189721-3939595-30951.sh
958  finished   /project/tmp/slot/ts-out.BRqflO 0        72.61/112.34/2.95 [fe-r6-ext1556]/home/tcuni-claw/.local/share/slot/jobs/1790189721-3939641-5022.sh

=== 池 cpu（16 槽）===
2146 finished   /project/tmp/slot/ts-out.6CX8vL 0        31.00/93.70/1.36 [fe-r2-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790178934-2109606-6409.sh
2147 finished   /project/tmp/slot/ts-out.AjwKAT 0        33.83/102.37/1.61 [fe-r2-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790178943-2111108-25768.sh
2150 finished   /project/tmp/slot/ts-out.R0g3x1 0        1.70/4.73/0.14 [fe-r3-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790181594-2607848-22635.sh
2151 finished   /project/tmp/slot/ts-out.WeJ4th 0        1.61/4.83/0.12 [fe-r3-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790181602-2609177-278.sh
2152 finished   /project/tmp/slot/ts-out.Vy1dyr 1        0.01/0.00/0.00 [fe-r4-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790182970-2871924-16922.sh
2153 finished   /project/tmp/slot/ts-out.WmOR8q 1        0.01/0.00/0.00 [fe-r4-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790183003-2878205-23793.sh
2154 finished   /project/tmp/slot/ts-out.MVIeln 2        0.11/0.04/0.01 [fe-r4-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790183353-2943894-8090.sh
2155 finished   /project/tmp/slot/ts-out.pai77i 0        1.21/3.46/0.14 [fe-r4-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790183375-2947677-7202.sh
2156 finished   /project/tmp/slot/ts-out.VbCiNj 0        1.32/3.71/0.13 [fe-r4-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790183560-2981028-1129.sh
2158 finished   /project/tmp/slot/ts-out.dfrX9M 0        59.81/68.85/1.97 [fe-r5-a1blast]/home/tcuni-claw/.local/share/slot/jobs/1790184957-3251601-5601.sh
2130 finished   /project/tmp/slot/ts-out.4LGros 0        20773.13/1.24/1.97 [TC-YINUO-20260920-WHW004-planner-notify]/home/tcuni-claw/.local/share/slot/jobs/1790165689-3837540-21635.sh
2118 finished   /project/tmp/slot/ts-out.9RCygc 0        29401.82/0.38/0.62 [TC-YINUO-20260920-WHW004-feishu-notify]/home/tcuni-claw/.local/share/slot/jobs/1790157373-2380216-22845.sh
2159 finished   /project/tmp/slot/ts-out.LfBlNA 0        1056.27/1813.90/35.86 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1790186494-3524784-17148.sh
2160 finished   /project/tmp/slot/ts-out.ePgr4E 0        363.78/584.78/11.43 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1790187802-3694789-30963.sh
2163 finished   /project/tmp/slot/ts-out.uyNlkf 0        13.78/41.37/0.59 [fe-r5-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790188388-3769268-274.sh
2162 finished   /project/tmp/slot/ts-out.vby9lA 0        16.49/47.29/0.78 [fe-r5-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790188388-3769343-15494.sh
2164 finished   /project/tmp/slot/ts-out.qlz58J 0        865.91/1450.75/25.82 [fe-r6-ann3]/home/tcuni-claw/.local/share/slot/jobs/1790189917-3965163-28549.sh
2165 finished   /project/tmp/slot/ts-out.8GX5rE 0        488.61/680.25/53.30 [fe-r6-ann4]/home/tcuni-claw/.local/share/slot/jobs/1790190979-4103022-27368.sh
2168 finished   /project/tmp/slot/ts-out.LFHOQx 0        2.72/6.47/0.24 [fe-r6-audit-zh13]/home/tcuni-claw/.local/share/slot/jobs/1790191557-4178914-14100.sh
2169 finished   /project/tmp/slot/ts-out.EhClsN 0        2.82/6.12/0.21 [fe-r6-audit-wm82]/home/tcuni-claw/.local/share/slot/jobs/1790191557-4178838-30942.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh

=== 池 nf（2 槽）===
116  finished   /project/tmp/slot/ts-out.8jSMaa 0        15.95/21.90/3.58 [20260920T014456-ba42ed60]/home/tcuni-claw/.local/share/slot/jobs/1789868817-1210125-7990.sh
117  finished   /project/tmp/slot/ts-out.aJm8sV 0        15.48/23.13/3.67 [20260920T015208-2f52eefa]/home/tcuni-claw/.local/share/slot/jobs/1789869133-1258883-17038.sh
118  finished   /project/tmp/slot/ts-out.5rNTA6 0        8.09/15.65/1.02 [20260920T035651-c7bf8abc]/home/tcuni-claw/.local/share/slot/jobs/1789876625-2324355-27522.sh
110  finished   /project/tmp/slot/ts-out.YmwdkS 0        161410.84/407429.97/9492.63 [TC-SAAS-Sweetpotato-10K-20260919-resume7]/home/tcuni-claw/.local/share/slot/jobs/1789778012-1034593-13293.sh
120  finished   /project/tmp/slot/ts-out.K2tbxw 1        107.25/15.55/12.30 [nf]/home/tcuni-claw/.local/share/slot/jobs/1789963068-1979329-31922.sh
119  finished   /project/tmp/slot/ts-out.hxZ9Ll 1        8580.79/17994.98/510.42 [nf]/home/tcuni-claw/.local/share/slot/jobs/1789954706-939572-29782.sh
121  finished   /project/tmp/slot/ts-out.6KCbEw 1        3635.12/2913.84/75.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1789971750-2972991-171.sh
122  finished   /project/tmp/slot/ts-out.lnz0E2 0        5590.95/25461.42/832.12 [TC-QHU-Pea-20K-INDEL-resume3]/home/tcuni-claw/.local/share/slot/jobs/1789977355-3799500-17321.sh
123  finished   /project/tmp/slot/ts-out.FjFmml 1        5.22/12.26/0.79 [QK287-noknown]/home/tcuni-claw/.local/share/slot/jobs/1789984257-407077-5566.sh
124  finished   /project/tmp/slot/ts-out.lmFGIT -4       766.57/18.86/9.89 [nf]/home/tcuni-claw/.local/share/slot/jobs/1789984681-419732-5263.sh
125  finished   /project/tmp/slot/ts-out.BUxlGW 1        0.01/0.00/0.00 [QK287-nobqsr-7s]/home/tcuni-claw/.local/share/slot/jobs/1789985504-513648-13017.sh
126  finished   /project/tmp/slot/ts-out.7XB7rJ 0        1800.17/757.55/192.27 [QK287-nobqsr-7s]/home/tcuni-claw/.local/share/slot/jobs/1789985560-515941-11675.sh
127  finished   /project/tmp/slot/ts-out.JZBjee 1        197.29/12.46/52.79 [nf]/home/tcuni-claw/.local/share/slot/jobs/1790062921-2839087-4589.sh
128  finished   /project/tmp/slot/ts-out.C0KVdr 0        197.59/844.91/195.91 [nf]/home/tcuni-claw/.local/share/slot/jobs/1790066444-2967383-23248.sh
129  finished   /project/tmp/slot/ts-out.ZgYFVN 0        1662.29/2253.69/46.57 [HYJ322-six-sample-pilot]/home/tcuni-claw/.local/share/slot/jobs/1790092910-1817490-6608.sh
130  finished   /project/tmp/slot/ts-out.BJlN0H 0        96.85/296.92/11.96 [HYJ192-two-sample-smoke]/home/tcuni-claw/.local/share/slot/jobs/1790117912-538776-11889.sh
131  finished   /project/tmp/slot/ts-out.Y7z2V2 0        2255.40/7222.39/285.93 [HYJ192-full-50-samples]/home/tcuni-claw/.local/share/slot/jobs/1790118065-563763-30887.sh
132  finished   /project/tmp/slot/ts-out.SBK05n -1       453.41/0.00/0.00 [TC-YINUO-20260920-WHW004-probe]/home/tcuni-claw/.local/share/slot/jobs/1790135306-2723239-24315.sh
133  finished   /project/tmp/slot/ts-out.E4u0fv -1       10967.55/0.00/0.01 [TC-YINUO-20260920-WHW004-probe]/home/tcuni-claw/.local/share/slot/jobs/1790136603-2862719-4537.sh
141  finished   /project/tmp/slot/ts-out.JCFqdG 0        29062.02/88765.10/5252.88 [TC-YINUO-20260920-WHW004-probe]/home/tcuni-claw/.local/share/slot/jobs/1790157356-2376906-5548.sh
```

## smoke 2026-09-24 (slot cpu, exit 0)
- Root kimi-for-coding: 3 turns, $0.0164 (delegate → git_audit diff → "FIXED")
- worker tcuni-agy/gemini-3.8-flash-high:medium: completed, 44.5k tok, $0.0365, 12 turns, 40s
- calc.py fixed (a - b → a + b); python3 test_calc.py → ok; git summary listed calc.py + untracked __pycache__
- Warning: pi reports no model matching tcuni-luna/gpt-5.6-luna (the scout/oracle/reviewer overrides)

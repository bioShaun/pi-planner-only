# 隐藏验收的裁定（2026-10-07，看过 Luna 3+3 次结果后、其他模型运行前定下；只放宽规格有歧义的点，对所有运行一致适用）

S1 check_s1.py
1. CSV 读取改为 utf-8-sig：规格只写 UTF-8，带 BOM 也接受（Luna-1 写了 BOM）。
2. 冒烟 TSV 的逐样本 GT 列：规格未说未 called 样本是否屏蔽，原始 GT 与 NA/./. 都接受（参考实现写 NA，Luna 写原始 GT）。
3. preview「基因」列：Gene_ID 或 gene_name 都接受；「上/下调」接受 UP/上调/上。
4. 冒烟数据中 XM-Z1R_vs_XM-Z1S 只有全表、缺 diffgenes：规格的「缺文件跳过」与「0 DEG 也列出」冲突，该比较组只记 info（准备阶段定下）。
保留为缺陷：合成用例中 GA_vs_GD 两个文件都不存在，仍输出 0 行汇总或 TSV（A24/A25，同一缺陷计两条）。

S2 check_s2.py
1. 参考测试中 "N explorer child(ren)" 的正则放宽为 child(ren)/children/child（task 文本是单复数占位）。
2. index.test 中工具描述的逐字文案断言放宽为关键短语，避免挡住后续行为断言；逐字一致改由单独计分项 wording_exact 检查（task 明确给了新规则文案）。

自检：参考答案 f2fe050 12/12；committed-variant 46/46，worker-variant 46/46，broken 37/46。

# 裁定 2（2026-10-07，18 次运行全部完成并看过结果后；只放宽规格未写明的格式/措辞点，对所有运行一致适用）

起因：裁定 1 后 Sonnet 和 DeepSeek Flash 的 S1 失败项全部落在格式上，逐项核对都属于规格没有写明的写法，不是逻辑错误。S2 的文档检查把保留引导句、但已改成读写锁规则的写法也判为未更新。

S1 check_s1.py（改前版本保存为 check_s1.v2-pre-adjud2.py）
5. 逐样本 GT 列名：<sample> 与 <sample>_GT 都接受（Sonnet-2/3 用 _GT 后缀）。
6. 中文表头里英文两侧的空格可有可无（Sonnet-1/2 写成「其中含HIGH/MODERATE差异变异的基因数」）。
7. AF_diff 的符号：规格只说阈值用 |AF_A − AF_B|，列值带符号或取绝对值都接受（DeepSeek Flash 写带符号值）。
8. 「组间差异 SNP 数」可以按位点去重计（合成用例里有 1 个 SNP 命中两个基因，13 或 12 都接受）。
9. preview 的「比较组」写 A_vs_B 或 A vs B 都接受（规格只对 summary 写明 `A vs B`）。
10. 冒烟 TSV 的 logFC/FDR 数值精度未写明，按 0.5% 相对误差比较。
自检：committed 46/46，worker-variant 46/46，broken 39/46（A07、A09 和 5 条 B03 仍拦住 dosage 故障）。

S2 check_s2.py（改前版本保存为 check_s2.v2-pre-adjud2.py）
3. docs_updated 只认旧的独占断言：README 中「a second such child in the same directory is refused」、表格 explorer 一行仍为 yes/是、中文版「同一目录里第二个这样的子代理会被拒绝」、CONTEXT.md 原句整句未改、index.ts 旧规则句；并要求改动行提到 explorer/shared/共享。保留「A child with bash or write holds its cwd」这类引导句不再算失败。
自检：参考答案 f2fe050 12/12；基线 3/12。

两套分数都保留：eval-adj1/ 与 scores-adj1.md 为裁定 1 的结果，eval/ 与 scores.md 为裁定 2 的结果。

人工复核（不在程序检查里）
- S2-luna-2 删掉了 contract.test 中「锁与 agent 写权限一致」的交叉断言（`canChange`），只留下按角色写死的映射，属于削弱现有断言。其余 8 次都保留了这条断言或换成等价写法。
- S2-luna-1 报告称「README 里没有匹配的旧规则文本」，与事实不符：README.md 第 31 行一带仍是旧规则。
- S2-dsflash-3 主动指出 scout 仍有 write 工具，与历史 reviewer 的 P2 一致。

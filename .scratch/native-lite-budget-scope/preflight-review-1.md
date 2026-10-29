# Root 首次预检审查：要求修正

批次 `/project/tmp/pi-native-lite-20261028T111239+0800/`，attempt `compare-a2`。首臂尚未放行，无新增实验样本。

Root直接读取prepare/verify脚本、runtime-lock.json、S1-native manifest、实际S1 brief、verify日志与meta（exit0）、prepare日志与meta（重跑exit0），并独立计算七个controller/extension源码及四臂brief实际SHA256。

已确认七个controller/extension实际文件与lock哈希一致；四臂实际brief哈希与manifest一致。主repo tracked diff仍仅为既有recommendation.md两行修改。新增脚本属untracked，已显式读取审查，不能据git diff为空认定无变更。

不予放行原因：
1. runtime-lock.workspaces四臂仍来自旧批次，其brief和workspace hash与新manifest不符；prepare脚本复制旧lock后未重算该字段。
2. S1 brief的session ID归一化规则正确，但展开示例含`+0800`，实际runner会归一化为`-0800`；应同步检查S2并保持成对同字节。
3. verify脚本未检查lock.workspaces与实际快照、实际brief与briefSha256/pairedBriefSha256、全部controllerFiles实际字节及运行user settings哈希。当前exit0不能证明这些条件。
4. preflight.md入口缺失；报告称保留首次准备失败stdout/meta，但所指文件当前仅有重跑成功，须追回或如实注明被覆盖的限制。

已通过supervisor reply 9612565a-840e-4307-a7c9-30b4bcb218fc下达最小修正：保留修正前材料到独立revision证据；新检查先针对现有错误材料取得真实红灯，再修正生成/冻结并留绿灯，守卫有篡改fixture故障注入。brief静态改正无须单独造测试。不改产品、controller或guard行为，不改真实ledger，不重跑已验收20/20。离线修正沿用本worker累计USD1准备限额。所有重跑日志采用唯一文件名；完成后重新交Root审查。

# Root 控制费用检查点与离线准备放行

run：218c7347-e6bb-4471-a93e-9929dbefb145。

Root直接读取 `/project/tmp/pi-native-lite-budget-scope/control-session/218c7347-e6bb-4471-a93e-9929dbefb145/run-0/session.jsonl`，按assistant message entry id去重：18条，无缺失cost，无重复id，模型tcuni/gpt-6-luna。reported费用USD0.01593764（原JSON浮点尾数忽略到8位）；文件检查点SHA256 `a546544149c06d320eb30125d80e6bdc192ee02dda513a11cbf87fe1ed4855e9`。仅检查点，后续从同一session完整重算，不累加此快照。

纳入范围历史控制5.40165224 + 本worker检查点0.01593764 = 5.41758988；原控制预留11.41064652，尚覆盖5.99305664。加历史实验0.06735550，已知reported总额5.48494538。旧ledger reserved13.27409902距原16停止线2.72590098，保留不变。

Root决定：在既有控制预留中划定本worker累计USD1的准备费用限额（包含已知0.01593764），不是新增ledger事件。历史控制5.40165224 + 本worker累计预留1 = 6.40165224，低于控制预留11.41064652，因此无需为离线准备新增真实账本预留。该内部限额需根据session后续检查点核对，不能声称provider硬限额。接近USD0.8时汇报Root重算，不自行超出USD1准备限额。

继续已授权的新批次四臂离线材料及必要预检；创建路径、worktrees、复制冻结依赖不等于启动付费provider实验。预计重命令先slot audit/status保存日志，然后slot cpu/io。保持controller及guard原字节，不增加行为修改。第一臂启动前提交具体配置、原始检查证据、费用覆盖和冻结hash；不要求在离线准备前证明四臂必定全部完成。每臂provider请求仍受既有guard控制，失败或触发guard即停止。不得保证全四臂在16停止线内完成。

不修改真实ledger、不退款、不启动实验，直到Root审查明确首臂放行。累计用户授权上限仍USD30；旧报告中USD20总授权已经过时。维持16停止线属于当前主动保守策略，不是新的用户上限。

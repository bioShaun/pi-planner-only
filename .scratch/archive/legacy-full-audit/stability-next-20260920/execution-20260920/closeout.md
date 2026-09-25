# 执行清单验收收尾（2026-09-20）

已完成 handoff-20260920.md 授权范围：P1-B 仅报告提交能力、真实 TUI 三场景、Gemini/Luna 三组对照、最终 release 与独立 strict 验收。原 P1-A / stop / P2 先提交为 `83a0ad4351300e4537435ce637a995207e221ed0`；本轮实现提交为 `9dd61755a2748e3f432e6b5f362945963906637d`。未推送或发布。

P1-B 仅向修复 child 暴露 structured_output，并允许一次提交。修复机会与原执行绑定且不可由角色/并发参数绕过；账本保留预算、原始终态和专用失败家族；修复不新增 Truth。Root 和 delegated reviewer 均验证原执行来源、修复前后连续性和最终文件状态。只读 Explorer 的修复声明也必须有既有 Truth 支持，不能把观察到的其他写入据为己有。有效修复可完成，虚报、再次畸形或失去证据绑定均不能完成。partial grace 和原始畸形报告诊断仍 unsupported。

所有下表 shell action 均通过 `bash .scratch/stability-next-20260920/run-execution-terminal.sh <action>` 在普通终端执行；完整 argv、起止时间、exit、stdout/stderr、slot audit/status、前后哈希保留在本目录和对应 run。

| 验收 | action / 退出码 | 证据 |
|---|---|---|
| 仅报告工具 | `probe` / 0 | ../report-only-run-3zZ7ry；唯一 active tool structured_output，一次成功调用，工作区无变化 |
| TUI queued | `tui queued` / 0 | ../study-run-vsHbSx |
| TUI scheduled | `tui scheduled` / 0 | ../study-run-TupxIs |
| TUI combined | `tui combined` / 0 | ../study-run-2VtAyF |
| 三组 P3 | `study` / 0 | ../study-run-yL4RzS；27 次完整执行 |
| 最终完整 release | `release` / 0 | ../release-run-GJqscr；npm run test:release，全60项文件哈希前后及当前一致 |
| harness | `harness` / 0；后续 shell 修改经 bash -n / 0 | harness-run-20260920T103158Z.log；最终脚本由 strict 核对 |
| 广泛代码审查 | `strict code` / 0，REQUEST_CHANGES | ../strict-run-2FEEMJ；已核实其他实现，剩余只读声明问题 |
| 新鲜修正审查 | `strict code` / 0，PASS | ../strict-run-ed0kfI；仅三文件修正，其他63项源码相同 |
| 完整宿主/P3独立审查 | `strict evidence` / 124，child PASS | ../strict-run-Bg1P0s；child完整完成，父转述超时；124未改写 |
| 最终独立收尾门禁 | `strict evidence` / 0，PASS | ../strict-run-dihsWK；核验完整审查链、运行时权限、release和无漂移 |

文件快照与 study-summary 由 `node .scratch/stability-next-20260920/execution-20260920/finalize-study.mjs study-run-yL4RzS` 生成，exit0（p3-finalize.log / p3-finalize-execution.json）。独立复杂核验见 host-validation.md 与 measurement-validation.md；完整 strict 结论及权限证明在各 run 的 child-verdict.md、parent/child-evidence.jsonl、permission-evidence 和 result.json。

最终 strict 父/子各自通过 O_WRONLY 无写入探针：EROFS、覆盖只读挂载、index.ts 哈希不变；父 low，fresh astra_reviewer 为 gpt-5.6-sol/high、fork_turns=none，无子代理再委派、无残留进程。收尾 Reviewer 实际417.6秒，外层正常退出。最终 source66项、harness25项零漂移，见 final-freeze-check.json。软预算不构成强制时限；本任务后期按实测使用单次600秒 watchdog，全局默认420及角色配置未变。

TUI 三场景均为真实 hasUI/mode:tui。按事件时间核对关闭前 queued、关闭并 settled 后 scheduled，匹配 REQUEST/CANCEL/cancelled terminal；关闭后 provider/tool/REQUEST为0/0/0，Request身份不变，最终confirmed/settled，静默3秒后自然退出0，forcedCleanup=false。不外推到所有宿主模式。

P3 固定 Root `tcuni-agy/gemini-3.8-flash-high`、child `tcuni-luna/gpt-5.6-luna`，thinking low；三组 × 三任务 × 三重复，按预先固定的轮换顺序运行。

| 组 | 完成率 | 总 token | 每个完成任务 token | 延迟中位数 | 最大延迟 |
|---|---:|---:|---:|---:|---:|
| direct | 9/9 | 54,524 | 6,058.22 | 7.560秒 | 16.773秒 |
| baseline | 9/9 | 815,498 | 90,610.89 | 35.585秒 | 94.617秒 |
| optimized | 9/9 | 846,506 | 94,056.22 | 34.879秒 | 64.503秒 |

Token 包含 input/output/cacheRead/cacheWrite，monetaryCost均为null，不作费用节省结论。延迟从提交 slot 前到 host退出，包含启动、排队、模型、工具和静默时间。128条Root usage与20个唯一完成child终态均可匹配；27份最终文件内容/哈希/状态与质量检查一致。baseline源文件保持85bdd2a，模型控制只改变公开注册和私有 builtin 设置中的model/thinking。优化组未显示总token下降；这只是小任务描述，未放宽Root读取政策。

实测版本边界：报告工具探针早于来源比较修正，TUI/P3早于之后的声明可靠性、reviewer绑定、连续性和只读声明修正。各 run保留所测源码/脚本哈希；pre-truth-hardening.patch/source.json保留P3版本。P3的18份委派账本没有reportOnly执行或声明findings，因此不覆盖这些修复路径；最终代码由入口回归、最新release和代码门禁覆盖，不把旧run当成最终源码实测。

ADR-0008将十分钟保留为操作默认值，未声称统计最优。20个child最长29,839ms，这组短任务不能比较五分钟和十分钟。执行时长/Request剩余时间可见性及长任务校准单列工单07，未在本轮近似实现。

失败及修正均保留：hard0探针阻止了报告工具；最初TUI未自然退出；Kimi403、DeepSeek502/503在REQUEST前失败；身份测试变量重名；虚报路径、reviewer绑定、修复前漂移、只读虚报均有红例与修复后release。assertion-audit.json记录95条新增断言行、0条直接删除；两条原期望被加强并逐条解释。

新 strict 尝试：qgpWLM exit0但额外派生代理且REQUEST_CHANGES；HRTA2r exit124无verdict；XlcaPu child REQUEST_CHANGES、外层124；2FEEMJ exit0 REQUEST_CHANGES；ed0kfI exit0 PASS；ONdoZZ exit124无verdict；Bg1P0s child PASS、外层124；dihsWK最终exit0 PASS。旧失败退出码和原始结论全部保留。

原始77项冻结检查零漂移，其中75项进入83a0ad4；两份此前已忽略的旧explorer-model原型以相同字节归档而未加入产品，详见baseline-freeze.json和ignored-freeze。任务内tmp、npm-cache和p1b-tmp按.gitignore排除。原始ANSI日志/补丁保留字节，因此全目录whitespace扫描会命中原始证据；66源码+25脚本/契约的限定检查exit0。

最终实现提交：`9dd61755a2748e3f432e6b5f362945963906637d`。

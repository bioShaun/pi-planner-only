from pathlib import Path
from datetime import datetime, timezone, timedelta
import json

B=Path(__file__).resolve().parent
summary=json.loads((B/'business-summary.json').read_text())
om=json.loads((B/'analysis.json').read_text())
local=json.loads((B/'local-analysis.json').read_text())

def ref(dataset, prefix, line, label):
    s=next(s for s in dataset['sessions'] if Path(s['source']).name.startswith(prefix))
    return f'[{label}]({B/s["source"]}:{line})'

def stamp(snapshot):
    m=json.loads((B/snapshot/'manifest.json').read_text())
    return datetime.fromisoformat(m['snapshot_utc']).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S +0800')

lines=[
'# 两台机器的插件真实使用复核：Opus / Sonnet / Astra Root',
'',
'分析范围：2026-09-28 00:00 +0800 起，om09 截止 '+stamp('snapshot')+'，tcuni-claw 截止 '+stamp('local-snapshot')+'。',
'',
'结论：当前 Lite 插件在真实任务中已有连续委派、失败恢复、审查修正的使用证据。现有样本不支持给三个 Root 模型排能力名次，也不支持优先优化重复读取或派发启动开销。最明确的改进对象是长任务的等待方式、十分钟任务边界、角色能力与交付物的匹配，以及审查意见落实后的验收。',
'',
'## 样本与版本',
'',
'取回 om09 41 个近期会话、本机 32 个，共 73 个会话和相邻子任务产物。两份快照合计 601 个文件，约 116.5 MB；逐文件 SHA-256 校验通过，读取时未发现文件大小/mtime 改变。原始内容仅保存在本目录忽略的 snapshot/、local-snapshot/ 与压缩包内。',
'',
'主分析只保留业务项目目录中的单一 Root 模型会话：44 个会话，104 次 delegate 请求，103 个终态结果。插件仓库自身开发、环境调试以及混用其他模型的会话不进入主表。所有主样本均有 Lite 模式记录；没有委派的业务会话仍保留，避免只挑插件表现活跃的会话。',
'',
'| Root | om09 会话 / 请求 | 本机会话 / 请求 | 合计会话 | 委派请求 / 终态 | 终态分布 |',
'|---|---:|---:|---:|---:|---|',
]
for g in ['Opus','Sonnet','Astra']:
    a=summary['groups']['all/'+g];o=summary['groups']['om09/'+g];l=summary['groups']['tcuni-claw/'+g]
    statuses='；'.join(f'{k} {v}' for k,v in a['delegate_status'].items())
    lines.append(f'| {g} | {o["sessions"]} / {o["delegate_requests"]} | {l["sessions"]} / {l["delegate_requests"]} | {a["sessions"]} | {a["delegate_requests"]} / {a["delegate_results"]} | {statuses} |')
lines += [
'',
'这里的 completed 只表示子调用正常结束，不表示验收成功。缺失的一次终态是本机 Astra explorer 请求，随后 Root 记录了中止；不补算成功或超时。om09 最长 Sonnet 验收会话仍在运行，最后一条 sleep 尚无返回；其未知尾段未估算。另有一次本机 Sonnet write 没有配对结果。',
'',
'取回时 om09 插件磁盘 HEAD 为 9373f83，本机为 1275050，版本号均为 0.9.0-lite.0，pi-subagents 均为 0.73.1；两处仅 package-lock.json 显示已修改。9373f83→1275050 的运行源码无差异。但是两台机器都在 9 月 29 日从 ccfedcd 更新过，前后 Root 任务拆分提示、worker 阻塞规则不同。因此本报告覆盖近期两个提示版本，不能声称所有会话都运行同一新提示。reflog 证明磁盘更新时间，不能证明已开会话的热加载；Pi 宿主准确版本未核实。版本证据见 om09-versions.json 和 local-snapshot/manifest.json。',
'',
'## 时间口径',
'',
'以 user（含 handoff 注入）到成功的最终 assistant stop 为响应段；途中用户补充不切断正在执行的任务。排除最终答复到下一次输入的等待，错误/中止后下一条是用户输入时也排除该间隔。自动重试保留。未结束会话只计到最后一条 message；不把后续 cache_warm 记录当作执行完成。',
'',
'Root 响应窗口 = assistant.message.timestamp 到该 message 持久化的 entry.timestamp；它是可观测响应窗口，包含输出生成等，不是纯推理时间或首 token 延迟，也不保证覆盖提供方内部所有重试。Root 工具窗口 = 发出工具调用的 assistant entry 到匹配 toolResult entry。批次中的工具可能并发或延迟记录，所以这里只使用时间区间并集，不把每个工具的包络当作独立精确耗时。delegate 与其他工具交叠单列 mixed。child 工具则用 transcript 的 tool_execution_start/end 配对。',
'',
'所有占比以各会话响应段的时长之和为分母，同一会话并行窗口去重；跨会话和两台机器可能同时运行，因此总和不是日历 wall，也不是 CPU 使用量。人工最终验收、交付正确性未逐项复跑，不能从这些日志计算质量成功率。',
'',
'| Root | 响应段合计（分钟） | 正常 Root 响应窗口 | Root 工具窗口 | delegate 窗口 | 混合工具 | 错误响应 + 其他 |',
'|---|---:|---:|---:|---:|---:|---:|',
]
for g in ['Opus','Sonnet','Astra']:
    a=summary['groups']['all/'+g];p=a['parts_pct']
    lines.append(f'| {g} | {a["active_s"]/60:.1f} | {p.get("assistant_ok",0):.1f}% | {p.get("root_tool",0):.1f}% | {p.get("delegate",0):.1f}% | {p.get("mixed_tool",0):.1f}% | {p.get("assistant_error",0)+p.get("unattributed",0):.1f}% |')
lines += [
'',
'| Root | 正常响应窗口数 | 单轮中位数 / P90（秒） | child 返回→Root 下一条 assistant 中位数（秒） | 调用包络减 child duration 中位数（秒） |',
'|---|---:|---:|---:|---:|',
]
for g in ['Opus','Sonnet','Astra']:
    a=summary['groups']['all/'+g];r=a['root_response_ok_s'];ret=a['return_to_next_assistant_s'];over=a['delegate_envelope_minus_child_s']
    lines.append(f'| {g} | {r["n"]} | {r["median"]:.2f} / {r["p90"]:.2f} | {ret["median"]:.2f}（n={ret["n"]}） | {over["median"]:.3f} |')
lines += [
'',
'“返回→下一条 assistant”排除了中间出现用户输入的样本，但仍包含模型生成，不是纯调度开销。调用包络与 child duration 之差也不是单独测得的启动时间，且 duration 的内部边界由宿主定义；这里只能说可观测外层差额很小。103 次终态的差额合计约 35.8 秒，没有发现它是主要瓶颈。',
'',
'按机器拆开也不能证明 Sonnet 比 Opus 快：om09 正常响应中位数为 Opus 6.78s、Sonnet 7.22s、Astra 13.94s；本机分别为 6.06s、6.71s、9.38s。不同任务、上下文、输出长度和提供方负载均未控制，不能据此判断同任务性能。',
'',
'## 三种 Root 的真实效果',
'',
'**Opus：有可交付实现与审查链条，但 Root 仍做了大量直接工作。** 36 次终态里，29 次 worker、4 次 explorer、2 次 reviewer、1 次 validator。Root 另有 913 次非 delegate 工具调用，其中 edit/write 73 次；bash 中的修改没有计入这 73 次，因此它不是改动规模统计。业务包括 RNA-seq 报告/作图、玉米探针交付、KEGG 建库等。',
'',
'一个较完整例子是 om09 报告与变异关联改造：Root 派实现，再派 reviewer；reviewer 指出了多等位位点 AF 口径问题，Root 随后修改并检查。最终答复明确说明报告已生成，但 Nextflow 未真实跑过。这体现了“实现结果与运行验收分开说”的有效行为，不能把有 reviewer 的整段时间算成浪费。证据：'+ref(om,'2026-09-28T04-32',123,'reviewer 发现')+'、'+ref(om,'2026-09-28T04-32',130,'Root 最终说明')+'。',
'',
'Opus 的两个十分钟超时都发生在本机玉米项目。两个 child 的工具活跃区间并集分别约 533s、352s，接近或占用很大一部分 600s 预算。优先复盘是否把构建/生成/运行等待塞进同一个子任务，比假设它们主要在反复读文件更有依据。日志无法证明超时前所有工作都白做了。',
'',
'**Sonnet：已经承担长链实施，但仍依赖审查、用户纠正和真实验收。** 56 次终态里，51 次 worker、5 次 reviewer；Root 另有 760 次工具调用、48 次 edit/write。om09 的 M02–M07 会话有 23 次委派，说明实际跑过连续实现与修改循环；该会话响应段累计约 99.0 分钟（已排除错误后的人工等待），不能仅凭次数认定过度拆分。',
'',
'该会话的 5 次 reviewer 调用均有需修正意见，包含脚本暂存漏掉 utils、稳定性表重复追加行、审计字段缺失和回归测试未覆盖实际映射路径等。Root 有后续修改和检查；最终仍明示“实现已提交、真实重算未验收”。其中两份 reviewer 报告还称无法取得有效 HEAD 基线，说明审查证据有缺口，不能把 completed 当作充分审查。证据：'+ref(om,'2026-09-29T09-44',57,'脚本依赖/HEAD 限制')+'、'+ref(om,'2026-09-29T09-44',111,'稳定性实现发现')+'、'+ref(om,'2026-09-29T09-44',130,'回归测试与基线限制')+'、'+ref(om,'2026-09-29T09-44',168,'实现阶段最终说明')+'。这些是历史日志里的发现，本次没有重新审计远端现代码。',
'',
'Sonnet 在本机的一次报告改动中，worker 超时后 Root 根据已有产物继续检查并报告 38 个相关测试通过；后续另一会话直接修改、真实渲染并记录完整 CI 和提交。可见超时结果恢复能起作用，但不能仅用 child 正常结束率衡量最终效果。证据：'+ref(local,'2026-09-29T07-34',33,'超时后的有限验收说明')+'、'+ref(local,'2026-09-29T08-31',106,'后续渲染与完整检查报告')+'。本报告没有重新运行这些检查。',
'',
'**Astra：样本主要是方法审计和规格收敛，尚不足以判断其长链实施表现。** 12 次请求有 11 次终态：6 次 explorer、2 次 validator、3 次 worker。Root 直接工具仅 93 次，edit/write 6 次；不能把它与 Opus/Sonnet 的实现和长流程运行任务直接比较。',
'',
'om09 的 GSEA 审计先做了数值复核，用户随后明确追问“除开样品本身，从流程/方法看”，Root 再组织了上游方法检查，记录了 offset 对照的可执行证据，并形成 7 项规格。这是具体的诊断价值，同时也说明最关键的问题是后续追问才进入重点，不能把整段描述成一次就完成的审计。证据：'+ref(om,'2026-09-29T05-23',60,'用户追问')+'、'+ref(om,'2026-09-29T05-23',80,'validator 对照结果')+'、'+ref(om,'2026-09-29T05-23',93,'规格产物')+'。本次只核对日志证据链，不重新验证统计学结论。',
'',
'Astra 也有明确调度失误：把“创建审计脚本并输出 JSON/TSV”的任务交给只读 oracle/validator；76 秒后工具是 completed，但正文说没有执行复算或写产物。随后改派 worker，worker 十分钟超时，Root 再用已有文件和报告收尾。证据：'+ref(om,'2026-09-29T05-23',19,'任务要求')+'、'+ref(om,'2026-09-29T05-23',20,'角色冲突')+'、'+ref(om,'2026-09-29T05-23',27,'复用超时产物的纠正任务')+'。',
'',
'也不能认为 Astra 制定的规格天然无需复核：它先在 30 项决策中保留了“仅命中 term 参与 BH”的方案，随后审计建议又修订这项决定。这里不判断统计方案孰优，只记录决策确实经过了修订。证据：'+ref(om,'2026-09-29T09-42',40,'先前决策')+'、'+ref(om,'2026-09-29T11-47',17,'后续修订建议')+'。',
'',
'## 比模型名次更值得处理的四件事',
'',
'1. **让长任务等待与 Root 的可交互执行分开。** 含显式 sleep 的 Root 命令包络，按会话内并集统计：Opus 约 60.9 分钟，Sonnet 约 183.5 分钟，Astra 无命中。这是包含 sleep 的整个命令窗口，并非纯 sleep 精确秒数，也不是全都可以消除的浪费：后台流程本来需要计算。可以改进的是避免长时间阻塞、避免重复轮询、及时报告完成。',
'',
'   om09 Sonnet 同一条 assistant 分别发出过 3、2、6、5 条完全相同的等待命令；其中 6 条 `sleep 598` 在约十分钟后几乎同时返回。它们只占一段约 598 秒的 wall，不能算成六倍，但确实产生了冗余命令和重复结果。后面还有 1500 秒等待和截取时未返回的 1700 秒等待。证据：'+ref(om,'2026-09-29T12-13',195,'六条相同请求')+'、'+ref(om,'2026-09-29T12-13',198,'同批返回')+'、'+ref(om,'2026-09-29T12-13',214,'1500 秒等待')+'。本报告没有停止任何远端运行。',
'',
'2. **把四个十分钟超时按原因拆开。** Opus 玉米两次以工具运行耗时为主；Astra 审计一次工具区间约 327s；本机 Sonnet 报告改动一次仅约 33s 工具区间，却有 46 个 child assistant turns。后者更像任务范围/轮数/模型响应需要复盘，不能统一归因于 IO 或统一增大 timeout。超时是部分成果需要恢复，不等于整个 600s 可被省掉。明细见 business-summary.json 的 timed_out。',
'',
'3. **改进角色路由和验收含义。** 交付物需要写脚本/报告时，不派只读 validator；审查需要差异基线时，先确认它实际可见。completed 只作生命周期状态，Root 仍需处理 BLOCKED、CHANGES REQUESTED 和验证缺口。先改提示/任务构造中的这两个具体条件，比增加固定审查轮次更有针对性。',
'',
'4. **把上游故障从 Root 能力评价里剥离。** om09 Sonnet Root 有 13 条 503 无可用账号、14 条 502 上游暂不可用记录；本机 Sonnet 还有 1 条流断开。om09 两次 child failed 都是 upstream_stream_read_error。它们是提供方/连接层的可见错误，日志不能把原因归到模型能力。错误消息个数不等于服务中断次数，也不能用错误响应窗口穷尽重试损失。',
'',
'## 对下一步试验的建议',
'',
'先不改默认 Root，也不以这份观察数据宣布 Sonnet 比 Opus 便宜/快或 Astra 更正确。按任务分工，Sonnet 已有连续实施证据，Astra 已有方法审计与规格修订证据，Opus 已有交付和审查恢复证据；这些是使用实例，不是因果优劣结论。',
'',
'如果只选一项小改动验证，优先让 Root 在委派前核对“角色是否能生成所需产物、600s 内能否完成主动工作”，把长运行交给可恢复的作业后再单独验收。等待命令重复也值得在下一轮观察中计数，但本次未证明需要新增运行时拦截器。比较必须同任务、同 child 模型及提供方、同验证标准，并记录人工追加范围、重试、超时恢复和最终验收。不要只比较 wall 或 completed 比例。',
'',
'## 可复核产物与限制',
'',
'- `business-summary.json`：主样本按机器、模型的汇总和四个超时的证据位置。',
'- `sessions.csv`、`delegations.csv`：逐会话与逐委派明细，含原始文件与行号。',
'- `analysis.json`、`local-analysis.json`：完整派生明细，含任务正文，仅本地保存。',
'- `snapshot/manifest.json`、`local-snapshot/manifest.json`：来源、大小、mtime、SHA-256 和采集时间。',
'- `analyze.py`、`combine.py`、`build_report.py`：离线复现脚本；不调用模型或重跑业务任务。',
'',
'复现：`python3 analyze.py`；`python3 analyze.py --snapshot local-snapshot --output local-analysis.json`；`python3 combine.py`；`python3 build_report.py`。从本目录执行；脚本仅写本目录。',
'',
'这是观察性复核，未对全部业务改动做独立验收，未检查每一条重复读取是否必要，也未测首 token 时间。模型取自日志实际 provider/model 字段：Opus/Sonnet 为 tcuni-claude，Astra 为 tcuni；child 都标为 gpt-6-luna，但 om09 路由 tcuni-luna、本机路由 tcuni，不能视为相同服务性能。样本任务、历史状态、角色分配、插件提示版本和机器负载不同，尤其 Sonnet 含一条尚未结束的长验收会话，Astra 样本小且偏审计。',
]
(B/'findings.md').write_text('\n'.join(lines)+'\n')
print(B/'findings.md')

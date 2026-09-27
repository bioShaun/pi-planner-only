# T1 长TMPDIR触发AF_UNIX socket路径超限

Status: done
Type: bug
Execution: 2×2离线复验、任务解释器socket预检、短路径映射及独立验收已完成；后续按用户收缩范围完成T2c两臂，原T1失败不追认。

T1 native 的统一目标30项通过，masked suite新增18项失败。这18个节点在worker的未改源码完整套件对照中也失败；共同错误为pandarallel/multiprocessing的 `AF_UNIX path too long` 后继EOFError。本次每条运行TMPDIR名称长83字符，后续socket路径还会增长。证据见 [停止报告](../execution/report.md) 与 [对照归档](../execution/environment-evidence/reconciliation.json)。

## 下一步离线范围

1. 保持原运行、eval、STOP、费用和原克隆只读；从归档构造未改与已改源码的隔离副本，使用同一冻结测试、Python和评测入口。
2. 选择更短、唯一且仍位于 `/project/tmp` 的实际TMPDIR，保持TMP/TEMP一致与Landlock保护；不得改用 `/tmp`、关闭资源保护或改测试断言。
3. 分别复验两种源码的目标/完整masked套件，记录全部退出码、收集数与失败节点。区分路径因素消失后的既有基线与真正新增实现失败；不能只比较失败总数。
4. 若确认运行入口路径过长，设计短物理目录与完整runId的显式映射，保留终态产物/用量归属，并加入能触发socket路径边界的离线故障检查。修改前另冻结入口和环境条件，不覆盖当前实验定义。
5. 完成离线验证和独立核对后，再决定剩余清单如何重订；不补跑本次模型、不追认原质量PASS，不自动续跑剩余3条。

预计超过一分钟的测试均须先记录并检查slot audit/status，再经slot cpu执行。临时目录父路径先确认存在。本票仅给出后续离线修复范围，不包含新的付费模型授权。

## 完成记录（2026-09-27）

[修复验收](../../lite-short-temp-20260927/acceptance.json)确认：两种源码的18个新增失败仅在长路径出现，短路径均消失；本次产物短路径下目标30通过、masked1111通过且仅余12项既有失败。入口按任务配置Python实际绑定AF_UNIX socket，在Pi调用前拒绝不适合的路径；原/tmp保护保持。36项bench回归、完整release及独立审查通过。

此后用户将剩余范围收缩为T2c两臂，均已完成并通过，[最终报告](../../lite-t2c-focused-20260927/execution/report.md)列出费用及限制。T1 lite未运行，原T1 native不补跑，原eval/STOP及全部费用保留。上方清单作为原修复要求留档，不再作为未完成队列。

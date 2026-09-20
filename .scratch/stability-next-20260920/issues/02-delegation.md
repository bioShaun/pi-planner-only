# 02 P1 普通委派与有界收尾

Status: ready-for-human
Blocked by: none for the user-approved P1-B scope

减少 Root 在普通新 Task/重入时重复决定的执行参数；保持 TaskSpec 不可变与创建/重入分离。基于现有实测和 operator 配置设置有限 envelope 默认值。预算前的 partial 收尾与一次格式修复均不得扩充 Request 额度、绕过 Writer hold 或把原始文本当有效报告。先核实 transport 支持，再实现；缺少真实支持必须显式记录。

验收：真实插件入口测试普通省略参数、显式 envelope、跨 Task 额度、到期取消、partial/格式修复次数和旧身份保护。正常终端 release 与 strict gate 独立记录。

Completion: implemented and host-validated — P1-A 已先提交；P1-B 按用户修订实现仅允许结构化报告提交的专用能力，最终 strict gate 记录见本轮 closeout。

当前证据：真实插件入口 p1-delegation.test.mjs 覆盖注册确认、普通请求不带预算、精确 hard:1/block:*、预算失败原始终态、一次修复、角色与并发绕过、来源绑定及成功修复后的完成。普通终端 release-run-ysqfcU exit 0；真实 report-only-run-3zZ7ry 观测到唯一工具 structured_output、一次成功调用、工作区无变化。独立宿主证据核验见 execution-20260920/host-validation.md。

明确 unsupported：预算前 partial grace、原始格式错误报告诊断传输。0.69.0 无对应公共契约，不做文本降级。原零工具预算真实探针同时拦住报告提交，因此用户批准 tools:[] 的专用 agent，仅由 launcher 追加 structured_output。第一次失败证据 report-only-run-xMGYAr 保留。grant、来源 A_run/C_report、累计证据和不新增 Truth paths 均已接线；ADR-0009 记录依据与退出条件。

末轮补充：大数 operator 墙钟配置按 Node 最大定时器延迟分段唤醒，完整额度不缩短；真实入口回归见 logs/review-r3-checks.json。

2026-09-20最终验收：完整release GJqscr、代码修正ed0kfI及收尾dihsWK通过；各自范围与原始证据见 ../execution-20260920/closeout.md。

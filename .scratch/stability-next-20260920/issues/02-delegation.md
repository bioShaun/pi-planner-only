# 02 P1 普通委派与有界收尾

Status: ready-for-agent
Blocked by: upstream capability + normal-terminal acceptance

减少 Root 在普通新 Task/重入时重复决定的执行参数；保持 TaskSpec 不可变与创建/重入分离。基于现有实测和 operator 配置设置有限 envelope 默认值。预算前的 partial 收尾与一次格式修复均不得扩充 Request 额度、绕过 Writer hold 或把原始文本当有效报告。先核实 transport 支持，再实现；缺少真实支持必须显式记录。

验收：真实插件入口测试普通省略参数、显式 envelope、跨 Task 额度、到期取消、partial/格式修复次数和旧身份保护。正常终端 release 与 strict gate 独立记录。

Completion: partial — P1-A 已实现；P1-B 待上游契约与专用本地修复路径。

当前证据：真实插件入口 p1-delegation.test.mjs；logs/p1-p2-available-registry-r2.* exit 0，typecheck-registry-final.* exit 0。默认预算与实际到界 CANCEL、显式参数、不可变 spec、host workspace、reviewer 路径均有覆盖。普通终端 release 尚未执行。

未完成：预算前 partial grace；原始格式错误报告诊断传输；一次修复的 grant→只读执行→报告及累计证据绑定。参见 transport-capabilities.md。仅有计数/提示不等于已实现受权限约束的 report-only。

末轮补充：大数 operator 墙钟配置按 Node 最大定时器延迟分段唤醒，完整额度不缩短；真实入口回归见 logs/review-r3-checks.json。

# 03: Closeout 上游桥接未交付，默认安装不可达

**Status:** ready-for-agent（需上游/宿主配合；本仓可先做文档与探测断言）
**Type:** task / integration
**Blocked by:** pi-subagents capability registrar / child-launch gating（见 `ad2eee7` / `1b5e9ef` 提交说明）
**来源：** 2026-09-22 closeout 半程合入；2026-09-22 planner 巡检

## 问题描述

`ad2eee7` 落地 closeout recovery service（broker / journal / sandbox / snapshot），`1b5e9ef` 接到 `resume_report_only` 与 soft token warning。提交明确写了：**pi-subagents 侧桥接仍保持本地/未提交**，因此默认安装路径下 closeout **仍不可达**，实现有丢失风险已降低，但产品能力对用户仍是半交付。

若 README / CHANGELOG / Root 提示暗示「resume_report_only closeout 已可用」，会超前于默认安装事实。

## 期望行为

1. 明确默认安装下的可达性（文档 + 可选启动探测）：无桥接时披露 unavailable，不静默失败成别的错误码。
2. 上游 PR：capability registrar / child-launch gating 合入后，本仓给出宿主验收清单（隔离会话、假/真 launcher、权限探针）。
3. 验收：在声明的 pi-subagents 版本范围内，`resume_report_only` 能走完 closeout 或明确 SKIP/不可用原因；不得把「本仓单测绿」写成「已对默认安装可用」。

## 非目标

- 不在本仓复制 pi-subagents launch tool plan。
- 不把未桥接环境的失败弱化成 PASS。

## Comments

- 2026-09-23 planner 开票：近两天巡检将此项列为当前最高产品缺口之一。

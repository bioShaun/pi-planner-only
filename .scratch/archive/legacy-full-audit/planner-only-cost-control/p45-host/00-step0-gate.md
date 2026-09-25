# 步骤 0 前置门禁（工单 45 宿主终验，2026-09-14 新一轮运行）

## 0.1 /planner-only status 逐字输出
**未取得**：slash 命令只能由操作员在 TUI 触发，本次验证的 agent 无法自执行。
请操作员补跑 `/planner-only status` 并核对：
- Plugin build source 应为 ~/.pi/agent/git/github.com/bioShaun/pi-planner-only（不是 /public/pi/pi-planner-only）
- loaded= 应等于下方重算指纹
- 注意 status 行的 disk HEAD 是会话 cwd 的 HEAD（index.ts getDiskHead(cwd)），不是插件构建身份。

## 0.2 settings.json packages pin（逐字，cat ~/.pi/agent/settings.json 的 packages 段）
```json
"packages": [
    "npm:pi-subagents",
    "https://github.com/bioShaun/pi-grok-theme",
    "npm:pi-web-access",
    "git:github.com/bioShaun/pi-planner-only@fix/ticket-45-validation-judgment"
  ]
```
→ pin 指向 pi 管理的 git clone（分支 fix/ticket-45-validation-judgment），不是本地仓库路径。✓

## 0.3 重算加载指纹（算法与 index.ts computeLoadedFingerprint 一致，对 clone 目录 23 个文件做 '<name>\0'+bytes 的 sha256）
338d419fdc3a43d994a11b7b4e963423e9ceeddff75b8d5fa3e28439d5fdf854
（直接 import index.ts 因 clone 内无 typebox 依赖失败，exit=1；按指定 fallback 字节序重算成功，exit=0）
附加 grep 取证结果（本步骤 1 输出粘贴处）：
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-13T14-35-53-488Z_01a09b32-3310-77bd-bdae-f2db9a68743d-_public_pi_pi-planner-only-tool_skrZiLxig9IwLoAYoC4l0IdX.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-12T15-51-14-517Z_01a09650-d355-77b6-ba8b-b1c77aad440c-_public_pi_pi-planner-only-call_Fr5DoSw0EyRsQl6F1qItq67E_fc_08a9c3de653b161f016aa60d27a84887d0a2fd367e8947ff04.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-14T02-05-28-162Z_01a09da9-86e2-763f-a358-91314f57b009-_public_pi_pi-planner-only-tool_IyGdbsBJWBDc3MDir982dQZ7.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-12T15-51-14-517Z_01a09650-d355-77b6-ba8b-b1c77aad440c-_public_pi_pi-planner-only-call_3qmUJtTJMLaRwmJZ9Ot7cMgP_fc_08a9c3de653b161f016aa5f8ea162487d0a2056a4b4a437814.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-13T14-35-53-488Z_01a09b32-3310-77bd-bdae-f2db9a68743d-_public_pi_pi-planner-only-execution-tool_zewhKQBe73kTmSodCJKpUAFr.json
/home/tcuni/.pi/agent/planner-only/run-state/unknown-session-_public_pi_pi-planner-only-call_647313.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-12T15-51-14-517Z_01a09650-d355-77b6-ba8b-b1c77aad440c-_public_pi_pi-planner-only-call_FQ0pJjUPn2l7KzTkVZf8tHDk_fc_08a9c3de653b161f016aa60aee595487d090421012bc31c8b1.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-12T15-51-14-517Z_01a09650-d355-77b6-ba8b-b1c77aad440c-_public_pi_pi-planner-only-call_O1pZ9jP1eM8VV1Y1tqCTgxMR_fc_08a9c3de653b161f016aa5fabd90a887d0b1b0223542f1c6ea.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-13T14-35-53-488Z_01a09b32-3310-77bd-bdae-f2db9a68743d-_public_pi_pi-planner-only-tool_W5luo4Fddv1gT1AxPIneM7Vl.json
/home/tcuni/.pi/agent/planner-only/run-state/2026-09-13T09-06-43-164Z_01a09a04-d55c-744b-8127-e05be8304940-_public_pi_pi-planner-only-call_3001196.json
---
---
0

## 0.4 clone 身份 shell 核验（逐字）
$ git -C ~/.pi/agent/git/github.com/bioShaun/pi-planner-only rev-parse HEAD
bfc70e904928264311dd7e49ad4e876128c01a32   [exit=0]
$ git -C ~/.pi/agent/git/github.com/bioShaun/pi-planner-only rev-parse 'HEAD^{tree}'
eaa121f6487a25ab7a06b6e1c2c522ddc9d774c9   [exit=0]
$ git -C ~/.pi/agent/git/github.com/bioShaun/pi-planner-only status --porcelain
(空)   [exit=0]
→ HEAD ✓ tree ✓ 工作树干净 ✓

## 0.5 会话仓库前置快照（开始前）
HEAD = bfc70e904928264311dd7e49ad4e876128c01a32
git status --porcelain:
?? .scratch/c13-repo/
?? .scratch/nx-followups/host-validation/
（均为预先存在的未跟踪目录）

## 0.6 行为证据（加载构建即新版的旁证）
检查 A–C 的准入拒绝文案为工单 45 新版「修复包」格式（含 TaskSpec repair summary + Outstanding），与 clone 源码 task.ts:878-887 / orchestrate.ts:2710-2727 一致；旧版只回单句「需补充验证定义」。

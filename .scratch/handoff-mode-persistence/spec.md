# Handoff 模式持久化与 `/planner-only handoff-mode` 子命令

Status: ready-for-agent
Created: 2026-09-29

## Problem Statement

用户设置 `handoff auto` 后重启会话，handoff 模式回落到默认 `off`。根因：`handoffMode` 只从环境变量 `PI_PLANNER_ONLY_HANDOFF` 读取（`config.ts` `loadConfig`），没有任何持久化路径。对比 mode：`/planner-only on|off|native|lite` 写 `~/.pi/agent/planner-only.mode`，新会话可继承；handoff 模式没有对应机制。环境变量只在设置它的那个 shell 生效，新进程没有该 env 即回落 `off`。

附带陷阱：`/planner-only handoff auto` 当前被解析为"以 auto 为 goal 发起一次交接"（`plannerCommand` 中 `handoff <任意文本>` 都进 `commandHandoff`），不是设置命令，用户可能误以为已设置成功。

## Solution

仿照 `MODE_PREFERENCE` 增加 handoff 模式持久化，并提供显式子命令设置。重启后的会话继承上次设置的 handoff 模式；显式环境变量仍可临时覆盖持久化值。

## User Stories

1. As an operator, I want `/planner-only handoff-mode auto` to persist, so that a restarted session keeps allowing Root self-initiated handoffs.
2. As an operator, I want an explicit `PI_PLANNER_ONLY_HANDOFF` env var to override the persisted value for that process, so that one-off experiments do not rewrite my saved preference.
3. As an operator, I want `/planner-only handoff-mode` (no argument) to show the current effective mode and its source (env / persisted / default), so that I can tell why handoff behaves as it does.
4. As an operator, I want `/planner-only status` output to include the effective handoff mode, so that one command shows the full picture.
5. As an operator who previously used `/planner-only handoff <goal>`, I want that form to keep working as a handoff request, so that existing muscle memory is not broken.
6. As a maintainer, I want the env-parsing contract of `config.ts` unchanged, so that the release suites keep passing without weakened assertions.

## Implementation Decisions

- New constant `HANDOFF_PREFERENCE = join(AGENT_DIR, "planner-only.handoff")` in `index.ts`, next to `MODE_PREFERENCE`; values `off` / `confirm` / `auto`, one per line, same read/write style as `preference()` / `setEnabled()`.
- New resolver `handoffMode(env = process.env): HandoffMode` in `index.ts`, exported for tests: if `PI_PLANNER_ONLY_HANDOFF` is set nonempty, its parsed value wins (unrecognized values still fall back to `off`, matching `loadConfig`); otherwise the persisted preference; otherwise `off`.
- Replace all four `loadConfig().handoffMode` call sites in `index.ts` (currently `handoffRefusal`, `sendContextWarning`, `handoffPrompt`, `dispatchHandoff`) with the resolver. `config.ts` itself stays env-only and unchanged.
- New subcommand in `plannerCommand`, checked before the `handoff [goal]` branch: `handoff-mode` (show) and `handoff-mode off|confirm|auto` (persist; invalid argument shows usage and changes nothing). `handoff <goal>` parsing is unchanged.
- Update the `/planner-only` command description string to include `handoff-mode [off|confirm|auto]`.
- `notifyStatus` gains the effective handoff mode and its source.
- README.md and README.zh-CN.md document the subcommand and the resolution order (env > persisted > default off).
- A missing or unreadable preference file behaves as "no preference" (default off); a corrupt value behaves as "no preference", never crashes the session.

## Testing Decisions

- Extend `index.test.mjs` at the existing seams (the test file already isolates `PI_CODING_AGENT_DIR` per run and imports `MODE_PREFERENCE`).
- Required cases:
  1. `handoff-mode auto` writes `planner-only.handoff` containing `auto`; a fresh resolver call with no env returns `auto`.
  2. Env `PI_PLANNER_ONLY_HANDOFF=confirm` overrides a persisted `auto`; env `off` also overrides (explicit env always wins, including `off`).
  3. No env + no file ⇒ `off`; corrupt file content ⇒ `off`, no throw.
  4. `handoff-mode` with an invalid value writes nothing and reports usage.
  5. `handoff <goal>` still routes to `commandHandoff` (goal parsing unchanged); `handoff-mode auto` must NOT schedule a handoff.
  6. Effective mode shows up in the status notification.
- Add a fault-injection check for the resolver: unreadable/corrupt preference file must not throw and must fall back to default.
- Do not delete or weaken existing assertions.
- Validation: `TMPDIR=/project/tmp npm run test:release` (typecheck + contract/git/delegate/host/index suites). Before running, record `slot audit` and `slot status` output; if runtime or resource use meets the heavy-task threshold, run through `slot cpu`. All intermediates stay out of `/tmp`.

## Comments

- 2026-09-29: 已实施。`index.ts` 新增 `HANDOFF_PREFERENCE` 与 `handoffMode()` 解析器（env > 持久化 > 默认 off），`/planner-only handoff-mode [off|confirm|auto]` 子命令，status 显示生效值与来源；`handoff <goal>` 原行为不变；README 双语已更新。`slot cpu -- env TMPDIR=/project/tmp npm run test:release` 全绿。另外把 `handoffRefusal` 的提示文案指向新子命令（测试只匹配前半句，不受影响）。

## Out of Scope

- The root-model preservation fix (tracked separately in `.scratch/handoff-preserve-root-model/`).
- Changing `config.ts`'s env-parsing contract or the default (`off`).
- Deprecating or repurposing `PI_PLANNER_ONLY_HANDOFF`.
- Any change to handoff dispatch, confirm/auto semantics, thresholds, or the brief content.

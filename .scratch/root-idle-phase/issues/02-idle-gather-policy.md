# 02: Idle gather Policy, keep blocked/failed verdict hatch

**What to build:** Policy splits gather Idle vs live using `activeForCwd(cwd)`, not global `active()`. Idle gather allows child-delegating `subagent`, `question`, `questionnaire`, and `planner_verdict`; inspect, Git-read, shell (including today's safe-shell Git-read), wait/supervisor tools, and mutation are refused. Live gather keeps today's allowlist including the full `ORCHESTRATION_TOOLS` set. Blocked/failed Tasks are gather-Idle but can still `planner_verdict` pass; do not implement P0 (b). PLANNER_PROMPT is rewritten within 1800 bytes using the spec's authorized cuts. README ×2, CONTEXT.md, CHANGELOG Unreleased, and `tool_call` fixtures are updated in parity. Idle refusals use ticket 01's example JSON.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] PolicyInput has `liveTask` from `activeForCwd(cwd)`. Idle: `read`/`grep`/`find`/`ls`/`git_audit`/unsafe and safe-shell bash/`write`/`edit`/wait/supervisor/unknown tools block; `subagent` (child-delegating), `question`, `questionnaire`, `planner_verdict` do not. Live: today's allowlist plus full `ORCHESTRATION_TOOLS`. Other cwd's live Task does not flip this cwd to live.
- [ ] Blocked/failed: gather Idle (inspect off) and `planner_verdict` still allowed. L-4 (blocked → pass → completed) still passes with Policy on the `tool_call` path, not only via direct `execute`. Status text "Blocked lifecycle: still accepts Root planner_verdict" is unchanged. Do not rewrite `rootVerdictRefusal` to treat blocked as terminal.
- [ ] PLANNER_PROMPT ≤ 1800 UTF-8 bytes; Idle first-tool Delegation + skills-in-constraints fragments added; authorized cuts applied; remaining story-37 fragments still match. No new Root slash command.
- [ ] CONTEXT.md defines Idle as gather Policy when `activeForCwd` is empty. README and README.zh-CN add Idle gather without retracting blocked/failed direct pass. CHANGELOG Unreleased records Idle gather (and sentinel fix if not already in 01).
- [ ] index `tool_call` fixtures that currently allow safe bash / `contact_supervisor` / `git_audit` / `planner_verdict` use an explicit live or Idle fixture. Ledger restore of a non-final Task in a cwd leaves gather live there (accepted; no extra session filter).
- [ ] Refused gather tools include ticket 01's validating JSON. No auto-start child from a refused tool. Guard-off and children still bypass Policy.

## Comments

Parent: `.scratch/root-idle-phase/spec.md` (stories 1–19, 32–41, 45, 47–51). P0 arbitration chose (a), not (b).

You are running under the planner-only extension. Do exactly this, then stop.

1. Call the `subagent` tool exactly once with `agent` set to `worker` and `task` set to
   the following text verbatim (the fenced JSON block included):

Do this:

```json
{"taskId":"T-20260909-901","objective":"Report the first line of README.md","cwd":"/home/tcuni-claw/pi/pi-planner-only-contract-run","role":"worker","scope":{"allowedPaths":["README.md"]},"constraints":["read only; change no file"],"acceptanceCriteria":["the first line of README.md is quoted back"],"validation":{"required":false,"commands":[]},"expectedEvidence":{"changedFiles":false,"tests":false},"stopConditions":["stop after quoting the line"],"budget":{"costUsd":0.05}}
```

2. Whatever the tool returns — a result, a refusal, or an error — report it verbatim in your
   final message, prefixed with `DELEGATION OUTCOME:`. Do not retry, do not delegate again,
   do not do the work yourself.
3. Then stop. Do not run any slash command: this harness gives you no tool with which to
   dispatch one, and attempting it only burns turns.

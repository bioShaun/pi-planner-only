# Installed launcher capability evidence

Inspected installation: `pi-subagents@0.68.0` under `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`.

- `src/api/delegation.ts:26-43`: the delegation request contract has no child run identity field.
- `src/slash/delegation-request.ts:13-29,66-68`: unknown request fields are rejected.
- `src/runs/foreground/subagent-executor.ts:6915`: the launcher allocates `runId` internally.
- `src/runs/foreground/subagent-executor.ts:3836,3926-3948`: the child prompt path does not inject that identity.
- `src/runs/shared/child-launch.ts:167-175`: the child environment does not carry the runId.
- No `pi-subagents:delegation-capability-probe:v1` listener exists in the installed package.

Conclusion: this installed launcher cannot prove or deliver `childRunIdentity`. Production safely refuses before Task admission. A supported upstream implementation must deliver the same runId reported by the terminal response before the child's first turn and advertise that capability through a documented mechanism. No minimum supporting version is currently established.

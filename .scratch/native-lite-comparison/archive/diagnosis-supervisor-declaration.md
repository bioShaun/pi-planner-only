# Supervisor declaration diagnostic

Date: 2026-10-27. The cause is the local `~/.pi/agent/extensions/slim-tools.ts` filter, not the installed pi-subagents package. Its previous `HIDE` set contained both `bg_wait` and `subagent_supervisor`; its `session_start` and `before_agent_start` handlers removed those names from active tools. The comment described the older planner-only synchronous delegate setup.

The live [observation](../.scratch/supervisor-declaration/live-tools.jsonl) shows `subagent_supervisor` registered, active and selected at the probe's `before_agent_start` position, then absent from active tools at `context` and from `providerTools` at `before_provider_request`. Handler ordering limits the probe to its own position. The old extension's direct behavioral regression reproduces the removal at both events, independently connecting that filter to the observed loss.

The local extension now hides only `bg_wait`; Native delegation needs the supervisor reply tool. The existing process still needs a deliberate `/reload` to load the change. No reload was performed. No upstream repair is needed for this cause.

## Evidence

- The original local file is backed up as [slim-tools.before.ts](../.scratch/supervisor-declaration/slim-tools.before.ts). Before the edit, both original and backup had SHA-256 `12f89dc85ad8fb3db400b8b6aaccd6bc6645d81412030d7c470615974dac04f0`.
- [slim-red.log](../.scratch/supervisor-declaration/slim-red.log) records the exact command and exit 1: both event tests loaded the actual extension and failed the behavioral assertion that an activated supervisor remains active. [slim-green.log](../.scratch/supervisor-declaration/slim-green.log) records the same command after the fix, exit 0, including preservation of other active tools and continued hiding of `bg_wait`.
- [slim-integration-green.log](../.scratch/supervisor-declaration/slim-integration-green.log) records the exact bounded command and exit 0. The real Pi offline harness loads the installed pi-subagents bundle, local slim extension and read-only probe, with and without the installed Native planner and with two starting selections. In all four cases the bundled channel accepts a synthetic request, activates the registered reply tool and Pi declares it to the mock model stream. No real child or network model request is made.

The mock stream assertion replays tool additions/removals from system messages, not serialized provider HTTP output. The channel is a separate real bundled channel instance with a synthetic request and stubbed parent wake; it is not a replay of the active session. The live provider observation above remains the evidence for the original session's provider boundary. The probe is restricted to the target session and thus does not record the isolated harness sessions.

The earlier [check.log](../.scratch/supervisor-declaration/check.log) omitted slim-tools and therefore could not reproduce the live failure. [probe-red.log](../.scratch/supervisor-declaration/probe-red.log) and [probe-green.log](../.scratch/supervisor-declaration/probe-green.log) contain independent probe fault-injection and loader checks. The initial import failure was not behavioral red evidence.

## Rollback

To restore the old local behavior, copy the saved `slim-tools.before.ts` over `~/.pi/agent/extensions/slim-tools.ts`, then deliberately reload the relevant Pi session. This restores the problematic supervisor filter. The diagnostic probe symlink was removed after confirming its exact target; logs and probe source remain. No other global settings or installed packages were changed.

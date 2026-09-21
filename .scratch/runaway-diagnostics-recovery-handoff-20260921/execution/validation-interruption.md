# Interrupted validation and cleanup

Current r3 release/host validation is BLOCKED, not PASS. Prior r1 release and host evidence is historical only.

- strict-LsaerA: external launcher timed out at 600 seconds, exit124, no verdict or permission-probe proof. Original request preserved alongside logs.
- release-IyBMBL: r2 release had no stdout for several minutes during heavy.slice memory pressure. Root stopped its own scope slot-cpu-3353762-9423.scope. Root had edited run-validation.sh while Bash was still running it; Bash resumed at a changed file offset, reported a malformed script path in executor output and submitted another release job. This is a validation harness error, not a product failure. Root terminated its exact release wrapper (session exit143) and stopped the new own scope slot-cpu-3424341-16078.scope. External systemctl show verified both inactive/dead with empty ControlGroup. No other user's job was stopped. Do not edit a script while it is running.
- cli-probe-zmVPxa: exit125 with no usable output; not evidence of a successful Codex invocation.
- resource-pressure*.json: heavy.slice near69GiB, memory.high64GiB, memory.max76GiB, memory pressure full avg60 around73%. Resource contention is a plausible contributor, not a proven sole cause of every timeout. No pool/cgroup limit changes.
- run-validation.sh now bounds release execution to300s and focused tests to180s (inside slot). No new heavy run was attempted under unchanged pressure.

## Resolution 2026-09-21 07:25Z-07:51Z

Pressure cleared (heavy.slice 12-19GiB). Same r3 snapshot (62/62 manifest match): release-odQcJL exit0; host-xS2LKF exit125 = node did not drain after a clean PASS (timeout expiry is 125 on this machine), harness correction 2 added an explicit PASS exit plus active-resource dump, host-7iH0yO exit0; strict-A7XBX7 launcher exit0, reviewer PASS (final), parent/child probes errno30. cli-probe's 125 was the probe leaving stdin open (codex waits on stdin); with </dev/null codex answers in 17s. No pool/cgroup changes; no other user's job touched. Nothing was edited while a wrapper was running.

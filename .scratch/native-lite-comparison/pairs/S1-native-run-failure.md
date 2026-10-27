# S1 Native Startup Failure

Arm outcome: **not started; configuration/launcher failure before Pi spawn.** This is retained as the first arm failure. Per protocol v2 execution control, later arms are stopped; no retry or CLI switch was performed.

- Intended arm CWD and baseline: `/project/tmp/pi-native-lite-pairs/S1/native`, `f818cc91c98d6129a152fb28161e00d2f601e494`.
- Actual command-shell CWD: `/home/tcuni-claw/pi/pi-planner-only`. The wrapper command omitted `cd /project/tmp/pi-native-lite-pairs/S1/native` before invoking `slot`, so the RPC driver correctly refused the unexpected CWD before starting Pi.
- Slot preflight: `slot audit` and `slot status` at `2026-10-27T21:42:33+08:00`, each exit 0; no bypass/conflict matches. Logs and raw outputs remain in `/project/tmp/pi-native-lite-pairs/results/S1-native/slot-audit*.txt` and `slot-status*.txt`.
- Attempt: `2026-10-27T21:48:08+08:00` to `2026-10-27T21:48:08+08:00`, exact command and environment (no `cd` was issued):

  ```bash
  timeout --signal=TERM --kill-after=15s 1200s slot cpu -- \
    timeout --signal=TERM --kill-after=15s 1200s \
    env -u PI_SUBAGENT_CHILD -u PI_OFFLINE -u PI_PROVIDER -u PI_SESSION_ID \
        -u PI_MODEL -u PI_REASONING_LEVEL -u PI_SUBAGENT_PARENT_SESSION \
        -u PI_SUBAGENT_RUNNER_PID -u PI_ASYNC_NATIVE_RUNNER -u PI_CODING_AGENT \
        -u PI_PACKAGE_DIR -u PI_SESSION_FILE -u PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT \
        -u PI_MANAGED_INSTALL_ROOT \
        PI_SUBAGENTS_TEMP_ROOT=/project/tmp/pi-native-lite-pairs/tmp \
        TMPDIR=/project/tmp/pi-native-lite-pairs/tmp \
        TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp \
        node /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/pairs/run-rpc-arm.mjs \
        > /project/tmp/pi-native-lite-pairs/results/S1-native/controller.stdout \
        2> /project/tmp/pi-native-lite-pairs/results/S1-native/controller.stderr
  ```

  Slot command exit 1.
- Portable stderr: `Error: unexpected arm cwd: /home/tcuni-claw/pi/pi-planner-only` at `run-rpc-arm.mjs:9`. Full stderr is preserved at `/project/tmp/pi-native-lite-pairs/results/S1-native/controller.stderr`; exact intended inner command is in `launch-command.txt`.
- No Pi process/session was spawned: `results/S1-native/session.jsonl` and `session.stderr` do not exist. Post-attempt process check found no `run-rpc-arm` or Pi RPC process. No provider/network request occurred and the session guard never ran.
- The shared budget ledger is unchanged at `$1.00`, one preparation event; no request reservation was made. Tracked arm worktree status remains clean; only the already-present `.pi/settings.json` and `input/brief.md` are untracked.

The correction would be to `cd` into the arm worktree before submitting the slot command. It was not applied in this run because protocol v2 requires stopping after a configuration startup failure and forbids automatic retry. S1 Lite and both S2 arms were not started.

## Approved Single Retry: RPC Driver Failure

Root later reviewed the CWD-only failure and authorized the protocol's one corrected retry. This retry did explicitly run with CWD `/project/tmp/pi-native-lite-pairs/S1/native`; fresh `slot audit`/`slot status` were both exit 0 at `2026-10-27T21:59:23+08:00`. The shell command used the approved 1200-second nested timeouts and `slot cpu`, cleared inherited Pi identity/offline variables, and kept outputs under this arm's results directory.

The controller spawned the Pi RPC Root, but RPC stdin received **no initial `get_state` command**. `control.jsonl` contains only `launch` and `pi-process-exit`; it has no `rpc-state-request`, state, prompt acceptance, or Root message. `session.jsonl` contains only startup UI events and the project-session warning. Root observed its 240-second no-progress alert and sent SIGTERM to the Pi process; the slot command ended `143` at `2026-10-27T22:04:39+08:00`. This is an RPC-controller startup/lifecycle defect, not a Native task result. No task brief was submitted and no provider request was sent.

The exact corrected retry command is `/project/tmp/pi-native-lite-pairs/results/S1-native/launch-command-retry1.txt`. The full retry output is preserved separately from the initial failure: `controller-retry1.stdout`, `controller-retry1.stderr`, `control.jsonl`, `session.jsonl`, `session.stderr`, and `slot-run-retry1.exit`. The shared ledger remains `$1.00` with its single preparation event. No retry is authorized after this defect; later arms remain stopped.

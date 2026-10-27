# S1 Native Manifest

Status before launch: ready. Pair order begins S1 Native, then S1 Lite, S2 Lite, S2 Native. No arm results existed at preflight. CWD `/project/tmp/pi-native-lite-pairs/S1/native`; baseline `f818cc91c98d6129a152fb28161e00d2f601e494`; `git status --porcelain=v1 -uno` empty. Untracked arm-local `.pi/settings.json` and `input/brief.md` are unchanged. No source writes permitted.

- Brief SHA-256: `2071686d4f1f4d7b7d8614baf84e762ba9732ce59850361c68d90529388f7f64`.
- Local role settings SHA-256: `343dd87d14a081f2d33bd3072d913962561782e4a260fc4ca74b603800a2bcd1`.
- Candidate `index.ts`: `0a8b277e12d92ead7151fe9850dcaebfea2c10207f1134667cbe22a23f5887a1`.
- `package-lock.json`: `105da12bbe51f12dfe2862e0cbf8641c0cd2bf6f7f1f1e266309ef5a828a6fd4`; `skills-lock.json`: `83589059c6c7ba7a6ce32e47fe3d37e16769c191a3d34cc9cf78a5a532dffcb4`.
- Pi host: 1.4.0; pi-subagents: 0.83.0, explicitly loaded from `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js`.
- Frozen guard/core SHA-256: `421539411c9a853c2341b83ed69c3aa71bcf4c213599a95798abae77447fac0d` / `632b82ccf67c6033032619ba629f0827c1edb7d8fbf006c975f9f6752f1f8268`.
- S1 Native mode, Terra/high Root, Luna/medium child roles, strict=false (Native does not claim Lite strict), handoff=off, context warning=150000. Shared ledger: `/project/tmp/pi-native-lite-pairs/budget-ledger.json`, prelaunch reserve `$1.00`.
- Results/session/log directory: `/project/tmp/pi-native-lite-pairs/results/S1-native/`; no old files there.
- Slot preflight: `slot audit` and `slot status`, CWD `/home/tcuni-claw/pi/pi-planner-only`, both exit 0 at `2026-10-27T21:42:33+08:00`. Raw outputs are local at `results/S1-native/slot-audit.txt` and `slot-status.txt`; audit reported no bypass/conflict match.
- Arm cap: 1200 seconds from controller start; slot queue wait is included by the outer timeout.

Launch command, CWD `/project/tmp/pi-native-lite-pairs/S1/native`; actual wall-clock start/end and exit are recorded by the runner and appended after the arm terminates:

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
  node /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/pairs/run-rpc-arm.mjs
```

The driver reads only this arm's `input/brief.md`, starts one fresh Pi RPC Root, and uses explicit `-e` paths for pi-subagents, this worktree's candidate plugin, and the required budget guard. It remains open across asynchronous notifications and closes only after Root final text plus child cost reconciliation reports zero unresolved usage and the expected child count. It has a 20-minute deadline. No API keys or full environment are written to the manifest.

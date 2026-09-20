PASS

Both authorized normal-host commands passed on their single initial attempts with the exact selected models and thinking setting. Full machine-readable command records are in `command-results.json`; top-level stdout, stderr, and exit files are alongside it.

The provider-route smoke evidence is `../study-run-D1Lacq`. The command exited 0, quality was true, the answer ended `ANSWER=10`, the observed Root model was `kimi-coding/kimi-for-coding`, and the one correlated completed child terminal used `tcuni-luna/gpt-5.6-luna:low` with usage. Root and child usage were complete and no failed attempt was observed.

The real Pi TUI evidence is `../study-run-g9NOIF`. `optimized-stop-pty.json` reports PASS, real UI presence, Request closure by `active-time-limit`, matching CANCEL and cancelled terminal identity (`requestId`, `ownerRunId`, and `nodeId`), `agent_settled`, zero post-closure model hooks/tool calls/REQUEST calls, a 3000 ms quiet window before Ctrl-D, natural exit 0, and no forced cleanup. The cancelled terminal includes usage and the requested Root/child routes.

Each harness stage recorded slot audit and status before its slot-cpu launch; both audits exited 0 and reported no bypassing heavy process. Private runtime directories are 0700 and copied model/auth files are 0600. No owned process remained and the cancelled task did not create `done.txt`.

The before and after source scope contains 66 files including ADR-0008; its manifest SHA-256 stayed `243dcc7491f8fab3ce15b78ede3a295f56d420200d0374bef0d0fe0c4ec147ae` and aggregate scope SHA-256 stayed `3fa9532e2695665f8f681a252876c49965f40564e5a4d22783895277d942ef2b`. The 11-file harness manifest SHA-256 stayed `a378fe9d5e7d8e5af6f5067957f07783fe58c8a12c529c1748d4a355b7fe85df` and aggregate scope SHA-256 stayed `73539250943bc588d449cc459bf1f7745f570ca15a91430352025d4678a12b84`. No source or harness file was edited.

Generated mutations are limited to the two `study-run-*` evidence directories, their private `/project/tmp/planner-study-*` runtimes, and these continuation records. This evidence does not cover P1-B, the nine-case comparison, full P3 calibration, a release rerun, pricing, or the strict review gate.

Write ownership is released to Root.

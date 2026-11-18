# Native-first repository audit

Baseline: 4f381942e086cfe8d4322a6d684dfb7d108b122f (initially clean).

1. Compare Native mode dispatch, tool visibility, accounting, warnings and handoff with current code, host contract, tests and operator docs. Prioritize findings affecting the operator's primary mode.
2. Independently inspect Lite delegation/Git, and bench/release tooling. Root checks current docs, packaging, file inventory and scope of historical/fixture material. Inventory archives and fixtures as evidence, not live behavior; do not delete operator state or rewrite history. Record coverage limits.
3. Verify each candidate against the contract; fix unambiguous issues in isolated worktrees with red/green regression tests for behavior, get independent diff review before accepting. List unresolved product tradeoffs with file evidence. No live model campaigns, pushes, deployments, changing mode defaults or deletion of history.
4. Verify final tree in a detached checkout using the project release gate (isolated fixture fallback when indicated); also run affected benchmark tests if applicable. Report exact results and limits.

Plan review additions: include Off and current/next-session transitions, audit the live isolated-release fixture and lockfile, and record every credible unresolved defect (not just design choices), evidence and what would settle it. Use an existing external TMPDIR under /project/tmp; log slot audit/status before heavy work.

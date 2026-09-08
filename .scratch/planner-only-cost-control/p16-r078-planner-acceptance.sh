#!/bin/bash
cd /home/tcuni-claw/pi/pi-planner-only
S=.scratch/planner-only-cost-control
echo "=== 1. typecheck ==="; npm run typecheck; echo "exit=$?"
echo "=== 2. npm test ==="; npm test 2>&1; echo "exit=$?"
echo "=== 3. e2e ==="; PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e; echo "exit=$?"
echo "=== 4. git diff --check ==="; git diff --check; echo "exit=$?"
echo "=== 实测 A: r077-reload-loses-the-ledger.mjs ==="; npx tsx $S/p16-probe/r077-reload-loses-the-ledger.mjs 2>&1; echo "exit=$?"
echo "=== 实测 B: r077-corrupt-ledger.mjs ==="; npx tsx $S/p16-probe/r077-corrupt-ledger.mjs 2>&1; echo "exit=$?"
echo "=== 实测 C: r077-planner-corrupt-laundering.mjs ==="; npx tsx $S/p16-probe/r077-planner-corrupt-laundering.mjs 2>&1; echo "exit=$?"

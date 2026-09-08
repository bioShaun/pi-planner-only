#!/bin/bash
cd /home/tcuni-claw/pi/pi-planner-only
run() { echo "########## $* ##########"; slot cpu -- "$@"; echo "EXIT=$?"; }
run npm run typecheck
run npm test
run env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
echo "########## git diff --check ##########"; git diff --check; echo "EXIT=$?"
echo "########## probe A ##########"; slot cpu -- node .scratch/planner-only-cost-control/p16-probe/r077-reload-loses-the-ledger.mjs; echo "EXIT=$?"
echo "########## probe B ##########"; slot cpu -- node .scratch/planner-only-cost-control/p16-probe/r077-corrupt-ledger.mjs; echo "EXIT=$?"
echo "########## ALL DONE ##########"

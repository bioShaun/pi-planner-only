#!/bin/bash
# usage: run.sh <label>   (mutation already applied)
cd /home/tcuni-claw/pi/pi-planner-only
out=$(timeout 300 node --experimental-strip-types orchestrate.test.mjs 2>&1; echo "ORCH_EXIT=$?")
arch=$(timeout 300 node --experimental-strip-types architecture.test.mjs 2>&1; echo "ARCH_EXIT=$?")
echo "### $1"
printf '%s\n' "$out" | grep -E "AssertionError|ORCH_EXIT|orchestration: PASS" | head -3
printf '%s\n' "$arch" | grep -E "AssertionError|ARCH_EXIT|architecture: PASS" | head -3

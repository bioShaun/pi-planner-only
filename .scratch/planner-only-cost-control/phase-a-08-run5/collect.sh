#!/usr/bin/env bash
# Snapshot r5 run artifacts into <RUN>/artifacts (read-only copies, mtime preserved).
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r5
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run5
A="$RUN/artifacts"
mkdir -p "$A/metas"
cp -p "$WT/.agent-dir/planner-only/usage.jsonl" "$A/usage.jsonl"
SESS=$(ls -1 "$WT/.scratch/phase-a-08-session"/*.jsonl | head -1)
cp -p "$SESS" "$A/root-session.jsonl"
echo "root-session source: $SESS" > "$A/SOURCES.txt"
cp -rp "$WT/.scratch/phase-a-08-session/subagent-artifacts" "$A/subagent-artifacts"
cp -p "$A"/subagent-artifacts/*_meta.json "$A/metas/" 2>/dev/null || true
mkdir -p "$A/session-tree"
for d in "$WT/.scratch/phase-a-08-session"/*/; do
  b=$(basename "$d")
  [ "$b" = "subagent-artifacts" ] && continue
  for r in "$d"*/; do
    [ -f "$r/session.jsonl" ] || continue
    mkdir -p "$A/session-tree/$b/$(basename "$r")"
    cp -p "$r/session.jsonl" "$A/session-tree/$b/$(basename "$r")/session.jsonl"
  done
done
find "$A" -type f | sort

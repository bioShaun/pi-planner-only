#!/usr/bin/env bash
# usage: build_rundir.sh <run-id>  -> /project/tmp/root-model-compare/r1/runs/<run-id>/repo
set -euo pipefail
MAIN=/home/tcuni-claw/pi/pi-planner-only
BASE=850933b
ID=${1:?usage: build_rundir.sh <run-id>}
DIR=/project/tmp/root-model-compare/r1/runs/$ID/repo
[[ -e /project/tmp/root-model-compare/r1/runs/$ID ]] && { echo "refusing: run dir exists: $ID" >&2; exit 2; }
mkdir -p "$DIR"
git -C "$MAIN" archive "$BASE" | tar -x -C "$DIR"
cd "$DIR"
git init -q
[[ -d /project/tmp/root-model-compare/deps/node_modules ]] || { echo "deps missing; run pin_plugin.sh" >&2; exit 2; }
ln -s /project/tmp/root-model-compare/deps/node_modules node_modules
echo node_modules >> .git/info/exclude
git add -A
git -c user.name=replay -c user.email=replay@local commit -q -m baseline --author="replay <replay@local>"
[[ $(git log --all --oneline | wc -l) == 1 ]] || { echo "self-check failed: commit count" >&2; exit 4; }
! git cat-file -e f2fe050 2>/dev/null || { echo "self-check failed: f2fe050 present" >&2; exit 4; }
[[ $(git ls-files | grep -c node_modules || true) == 0 ]] || { echo "self-check failed: node_modules tracked" >&2; exit 4; }
echo "repo=$DIR"
echo "baseline=$(git rev-parse HEAD)"

#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TASK_ID=${1:?usage: bench/prepare-clone.sh <task-id> <dest>}
DEST=${2:?usage: bench/prepare-clone.sh <task-id> <dest>}
TASK_FILE=$ROOT/bench/tasks/$TASK_ID.json
[[ -f $TASK_FILE ]] || { echo "missing task: $TASK_ID" >&2; exit 2; }
readarray -t CONFIG < <(python3 - "$TASK_FILE" <<'PY'
import json, sys
task = json.load(open(sys.argv[1]))
for value in (task['repo'], task['target'], task['parent'], *task['tests']):
    print(value)
PY
)
REPO=${CONFIG[0]} TARGET=${CONFIG[1]} PARENT=${CONFIG[2]}
TESTS=("${CONFIG[@]:3}")

rm -rf "$DEST"
git init -q "$DEST"
git -C "$DEST" fetch -q --no-tags "file://$REPO" "$PARENT"
git -C "$DEST" checkout -q --detach FETCH_HEAD
git -C "$DEST" config user.email bench@example.com
git -C "$DEST" config user.name bench
for path in "${TESTS[@]}"; do
  mkdir -p "$DEST/$(dirname "$path")"
  git -C "$REPO" show "$TARGET:$path" >"$DEST/$path"
done
git -C "$DEST" add -A
git -C "$DEST" commit -qm 'bench: target tests'
printf 'BASE=%s\n' "$(git -C "$DEST" rev-parse HEAD)"

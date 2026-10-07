#!/usr/bin/env bash
# One-off: export plugin commit b44aa00 (the daily-installed version) for Root runs.
set -euo pipefail
MAIN=/home/tcuni-claw/pi/pi-planner-only
SHA=b44aa00
DEST=/project/tmp/root-model-compare/plugin-$SHA
INST=$HOME/.pi/agent/git/github.com/bioShaun/pi-planner-only
head=$(git -C "$INST" rev-parse --short HEAD 2>/dev/null || echo unknown)
[[ $head == "$SHA" ]] || echo "WARNING: installed plugin HEAD is $head, not $SHA" >&2
if [[ -f $DEST/index.ts ]]; then echo "already exists: $DEST"; else
  mkdir -p "$DEST"
  git -C "$MAIN" archive "$SHA" | tar -x -C "$DEST"
fi
# Isolated dependency copy: run dirs and the plugin copy link here, never to MAIN/node_modules.
DEPS=/project/tmp/root-model-compare/deps
if [[ -d $DEPS/node_modules ]]; then echo "deps exist: $DEPS/node_modules"; else
  mkdir -p "$DEPS"; cp -a "$MAIN/node_modules" "$DEPS/node_modules.partial" && mv "$DEPS/node_modules.partial" "$DEPS/node_modules"
fi
[[ -L $DEST/node_modules ]] && rm "$DEST/node_modules"
[[ -e $DEST/node_modules ]] || ln -s "$DEPS/node_modules" "$DEST/node_modules"
echo "plugin=$DEST/index.ts installedHead=$head"

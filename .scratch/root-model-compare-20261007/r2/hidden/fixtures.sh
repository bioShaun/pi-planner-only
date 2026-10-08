#!/usr/bin/env bash
# Builds baseline (1275050) and answer (ac4af05) fixture repos under /project/tmp/root-model-compare/r2/fixtures.
set -euo pipefail
MAIN=/home/tcuni-claw/pi/pi-planner-only
ROOT=/project/tmp/root-model-compare/r2/fixtures
[[ -d /project/tmp/root-model-compare/deps/node_modules ]] || { echo "deps missing" >&2; exit 2; }
build() {
	local name=$1 sha=$2 dir=$ROOT/$1
	if [[ ! -e $dir/.git ]]; then
		mkdir -p "$dir"
		git -C "$MAIN" archive "$sha" | tar -x -C "$dir"
		(
			cd "$dir"
			git init -q
			ln -s /project/tmp/root-model-compare/deps/node_modules node_modules
			echo node_modules >> .git/info/exclude
			git add -A
			git -c user.name=replay -c user.email=replay@local commit -q -m "$name $sha" --author="replay <replay@local>"
		)
	fi
	echo "$name $dir HEAD=$(git -C "$dir" rev-parse HEAD)"
}
build baseline 1275050
build answer ac4af05

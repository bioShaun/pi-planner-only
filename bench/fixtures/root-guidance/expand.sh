#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=${1:-/project/tmp/ppo-bench/fixture-repos/root-guidance}
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
git clone -q "$ROOT/root-guidance.bundle" "$DEST"

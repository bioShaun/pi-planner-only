#!/usr/bin/env bash
# Public benchmark entry: install the process restriction before any Pi preflight.
exec python3 -B "$(dirname "${BASH_SOURCE[0]}")/temp_guard.py" "$@"

#!/usr/bin/env zsh

artifact_dir="$PWD/.scratch/subprocess-capture-diagnosis-20260918"
runtime_tmp="$artifact_dir/runtime-tmp"
node_cache="$artifact_dir/node-compile-cache"
mkdir -p "$runtime_tmp" "$node_cache"
test -d "$runtime_tmp"
test -d "$node_cache"

command_text="env TMPDIR=$runtime_tmp TMP=$runtime_tmp TEMP=$runtime_tmp NODE_COMPILE_CACHE=$node_cache timeout 30s node .scratch/subprocess-capture-diagnosis-20260918/harness.mjs"
print -r -- "$command_text" > "$artifact_dir/invocation-command.txt"
started_at="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"

env \
  TMPDIR="$runtime_tmp" \
  TMP="$runtime_tmp" \
  TEMP="$runtime_tmp" \
  NODE_COMPILE_CACHE="$node_cache" \
  timeout 30s \
  node .scratch/subprocess-capture-diagnosis-20260918/harness.mjs \
  > "$artifact_dir/harness.stdout" \
  2> "$artifact_dir/harness.stderr"
exit_code=$?

finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"
{
  print -r -- "started_at=$started_at"
  print -r -- "finished_at=$finished_at"
  print -r -- "exit_code=$exit_code"
  print -r -- "stdout=$artifact_dir/harness.stdout"
  print -r -- "stderr=$artifact_dir/harness.stderr"
  print -r -- "results=$artifact_dir/results.json"
} > "$artifact_dir/execution-metadata.txt"

exit "$exit_code"

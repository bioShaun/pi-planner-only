#!/usr/bin/env bash
# 用法: setup_run.sh <S1|S2> <label> <n>   建运行目录 $B/<S>-<label>-<n> 与任务文件 $B/tasks/<run>.md
set -euo pipefail
B=/project/tmp/worker-tiers-simple
S=$1; L=$2; N=$3
RUN=$S-$L-$N; D=$B/$RUN
[ -e "$D" ] && { echo "exists: $D" >&2; exit 1; }
case $S in
  S1) cp -a $B/baseline/s1 "$D" ;;
  S2) cp -a $B/baseline/s2 "$D"; rm -f "$D/node_modules"; ln -s /home/tcuni-claw/pi/pi-planner-only/node_modules "$D/node_modules"; mkdir -p $B/tmp/$RUN ;;
  *) echo "bad task" >&2; exit 1 ;;
esac
git -C "$D" init -q && git -C "$D" add -A && git -C "$D" -c user.name=replay -c user.email=replay@local commit -qm baseline
T=$B/tasks/$RUN.md
if [ $S = S1 ]; then
  sed -e "s#Repository /home/scripts/nf-rnaseq-v2#Repository $D#" \
      -e "s#/home/project/rnaseq/TC-BSR-20260821-ZHZ015/test_integrated#$B/fixtures/s1/test_integrated#g" \
      -e "s#run into /tmp/degvar_test#run into ./work/degvar_test#" $B/templates/S1-original.md > "$T"
  printf '\n\nIsolation: read and write only inside %s. The smoke data under %s/fixtures/s1 is read-only and may be read. Do not read anything else under %s. Do not write temp files under /tmp.\n' "$D" "$B" "$B" >> "$T"
else
  sed -e "s#/home/tcuni-claw/pi/pi-planner-only#$D#g" \
      -e "s#mkdir -p /project/tmp/ppo-test && TMPDIR=/project/tmp/ppo-test#mkdir -p $B/tmp/$RUN \&\& TMPDIR=$B/tmp/$RUN#" $B/templates/S2-original.md > "$T"
  printf '\n\nIsolation: read and write only inside %s (and the TMPDIR above). Reading the installed pi-subagents under ~/.pi/agent/npm/node_modules/pi-subagents is allowed (the tests use it). Apart from the node_modules symlink, do not read /home/tcuni-claw/pi/pi-planner-only or anything else under %s.\n' "$D" "$B" >> "$T"
fi
echo "$D"; echo "$T"

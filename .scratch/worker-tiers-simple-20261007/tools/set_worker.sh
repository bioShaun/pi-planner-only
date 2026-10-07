#!/usr/bin/env bash
# 用法: set_worker.sh <provider/model>   只改 subagents.agentOverrides.worker.model，并记入 runs.md
set -euo pipefail
S=$HOME/.pi/agent/settings.json
[ -e $S.orig-simple4 ] || cp -p $S $S.orig-simple4
python3 - "$1" <<'E'
import json,sys,os
p=os.path.expanduser('~/.pi/agent/settings.json')
d=json.load(open(p)); d['subagents']['agentOverrides']['worker']['model']=sys.argv[1]
s=json.dumps(d,ensure_ascii=False,indent=2)+'\n'; open(p,'w').write(s)
print(json.dumps(d['subagents']['agentOverrides']['worker'],ensure_ascii=False))
E
echo "- $(date -Iseconds) worker -> $1 (thinking medium)" >> /project/tmp/worker-tiers-simple/runs.md

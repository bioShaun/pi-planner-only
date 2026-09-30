from pathlib import Path
import datetime
import json
import subprocess

p = Path.home() / '.pi/agent/git/github.com/bioShaun/pi-planner-only'
out = {'observed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
for key, args in [('commit', ['rev-parse', 'HEAD']), ('status', ['status', '--porcelain']),
                  ('reflog', ['reflog', '-12', '--date=iso'])]:
    r = subprocess.run(['git'] + args, cwd=str(p), stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, universal_newlines=True)
    out[key] = {'stdout': r.stdout, 'stderr': r.stderr, 'exit_code': r.returncode}
print(json.dumps(out, indent=2))

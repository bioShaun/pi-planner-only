import collections
import datetime
import json
import sys
from pathlib import Path

logs = Path(__file__).resolve().parent
n = int(sys.argv[1])
arm = json.loads((logs / 'freeze/order.json').read_text())['order'][n - 1]
p = Path('/project/tmp/ppo-bench/results/target-root-t3-opus-calibration-20260926/runs') / f'T3-{arm}-1.jsonl'
counts = collections.Counter()
pending = {}
terminals = collections.Counter()
for line in p.open():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get('type') == 'message_end' and (e.get('message') or {}).get('role') == 'assistant':
        counts['root_turns'] += 1
        counts['root_errors'] += int(e['message'].get('stopReason') == 'error')
    if e.get('type') == 'tool_execution_start':
        pending[e.get('toolCallId')] = e.get('toolName')
    if e.get('type') == 'tool_execution_end':
        pending.pop(e.get('toolCallId'), None)
        if e.get('toolName') in ('delegate', 'subagent'):
            terminals[e['toolName']] += 1
print(json.dumps({'time': datetime.datetime.now().astimezone().isoformat(), 'arm': arm, **counts, 'pending': list(pending.values()), 'delegate_terminals': dict(terminals), 'bytes': p.stat().st_size, 'terminal_exit': p.with_suffix('.exit').exists(), 'stderr_bytes': p.with_suffix('.stderr').stat().st_size}))

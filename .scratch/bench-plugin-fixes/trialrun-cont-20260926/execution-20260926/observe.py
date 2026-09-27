import collections
import datetime
import json
import sys
from pathlib import Path

logs = Path(__file__).resolve().parent
ordinal = int(sys.argv[1])
item = next(x for x in json.loads((logs.parent / 'freeze-v3/continuation.json').read_text())['order'] if x['ordinal'] == ordinal)
p = Path('/project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926/runs') / f"T3-{item['arm']}-{item['rep']}.jsonl"
counts = collections.Counter()
pending = {}
states = collections.Counter()
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
        if e.get('toolName') == 'delegate':
            states[str(((e.get('result') or {}).get('details') or {}).get('status'))] += 1
print(json.dumps({'at': datetime.datetime.now().astimezone().isoformat(), 'ordinal': ordinal, **counts, 'delegate_returns': dict(states), 'pending': list(pending.values()), 'bytes': p.stat().st_size, 'terminal_exit': p.with_suffix('.exit').exists(), 'stderr_bytes': p.with_suffix('.stderr').stat().st_size}))

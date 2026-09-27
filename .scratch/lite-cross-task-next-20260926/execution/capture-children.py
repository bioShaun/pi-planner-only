"""Preserve terminal child evidence and cross-check recorded token usage."""
import hashlib
import json
import math
import re
import shutil
import sys
from pathlib import Path

logs = Path(__file__).resolve().parent
n = int(sys.argv[1])
row = json.loads((logs.parent / 'plan.json').read_text())['order'][n - 1]
task, arm = row['task'], row['arm']
rid = f'{task}-{arm}-1'
assert (logs / f'attempt-{n}.exit').exists(), 'Root must be terminal'
tmp = Path('/project/tmp/ppo-bench/opus-cross-task-t1-t2b-20260926') / rid
runs = Path('/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926/runs')
sys.path.insert(0, str(Path.cwd() / 'bench'))
from summarize import parse_run, model_key, PRICES, price, FIELDS

dest = logs / 'child-evidence'
assert logs.is_dir()
dest.mkdir(exist_ok=True)
dest = dest / rid
dest.mkdir(exist_ok=True)
children = []
commands = []
root_events = [json.loads(l) for l in (runs / f'{rid}.jsonl').open()]
for e in root_events:
    if e.get('type') == 'tool_execution_start':
        commands.append({'owner': 'root', 'tool': e.get('toolName'), 'args': e.get('args')})
for mp in sorted(tmp.glob('pi-subagents-uid-*/artifacts/*_meta.json')):
    meta = json.loads(mp.read_text())
    tp = Path(meta['transcriptPath'])
    assert tp.is_relative_to(tmp) and tp.is_file()
    for artifact in mp.parent.glob(mp.name.removesuffix('_meta.json') + '*'):
        if artifact.is_file():
            shutil.copyfile(artifact, dest / artifact.name)
    usage = {k: 0 for k in FIELDS}
    models, nested, errors, diffs = set(), [], [], []
    pending = set()
    for line in tp.open():
        e = json.loads(line)
        msg = e.get('message') or {}
        if e.get('recordType') == 'message' and msg.get('role') == 'assistant':
            models.add(msg.get('provider', '') + '/' + msg.get('model', ''))
            for k in FIELDS:
                usage[k] += msg['usage'][k]
            if msg.get('stopReason') == 'error': errors.append(msg.get('errorMessage'))
        if e.get('recordType') == 'tool_start':
            pending.add(e['toolCallId'])
            args = e.get('argsPayload', '')
            commands.append({'owner': meta['runId'], 'tool': e.get('toolName'), 'args': args})
            if e.get('toolName') in ('delegate', 'subagent'): nested.append(e)
        if e.get('recordType') == 'tool_end': pending.discard(e['toolCallId'])
        if msg.get('role') == 'toolResult':
            for c in msg.get('content', []):
                if 'diff --git' in c.get('text', ''): diffs.append(e)
    key = model_key(meta.get('model'))
    cost = price(usage, PRICES['models'][key]) if key else None
    checks = {'exit0': meta.get('exitCode') == 0,
              'tokens_match': usage == {k: meta['usage'][k] for k in FIELDS},
              'model_matches': models == {key},
              'reported_cost_matches': cost is not None and math.isclose(cost, meta['usage']['cost'], abs_tol=1e-8),
              'no_nested': not nested, 'no_api_errors': not errors, 'no_pending': not pending}
    (dest / (meta['runId'] + '-diffs.json')).write_text(json.dumps(diffs, ensure_ascii=False, indent=2) + '\n')
    children.append({'id': meta['runId'], 'agent': meta['agent'], 'model': meta['model'],
                     'usage': usage, 'cost': cost, 'checks': checks,
                     'transcript': str(dest / tp.name), 'sha256': hashlib.sha256(tp.read_bytes()).hexdigest()})
record, unknown = parse_run(runs, rid, 'actual')
expected = record['children'] if record['mode'] == 'native' else record['delegates']
checks = {'child_count': len(children) == expected,
          'child_cost': record['child_cost'] is not None and math.isclose(sum(c['cost'] or 0 for c in children), record['child_cost'], abs_tol=1e-8),
          'all_children': all(all(c['checks'].values()) for c in children), 'all_priced': not unknown}
tmp_refs = [c for c in commands if re.search(r'(?<![\w/])/tmp(?:/|\b)', json.dumps(c['args'], ensure_ascii=False))]
(logs / f'attempt-{n}-commands.json').write_text(json.dumps(commands, ensure_ascii=False, indent=2) + '\n')
out = {'id': rid, 'checks': checks, 'children': children, 'tmp_references_requiring_review': tmp_refs,
       'command_count': len(commands), 'limitations': 'Command references require manual interpretation; Landlock evidence covers local descendants, not arbitrary external services.'}
(logs / f'attempt-{n}-children.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(out, ensure_ascii=False, indent=2))

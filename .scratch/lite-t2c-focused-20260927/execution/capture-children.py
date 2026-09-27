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
row = json.loads((logs / 'plan.json').read_text())['order'][n - 1]
task, arm = row['task'], row['arm']
rid = f'{task}-{arm}-1'
assert (logs / f'attempt-{n}.exit').exists(), 'Root must be terminal'
tmp = Path(json.loads((logs/'paths.json').read_text())[rid]['tmpdir'])
runs = Path('/project/tmp/ppo-bench/results/opus-t2c-pair-20260927/runs')
meta=json.loads((runs/f'{rid}.meta.json').read_text())
assert meta['tempResource']['tmpdir']==str(tmp), 'run temp mapping mismatch'
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
bundle = runs / f'{rid}.native-evidence'
native_manifest = json.loads((bundle/'manifest.json').read_text()) if (bundle/'manifest.json').is_file() else None
if native_manifest:
    shutil.copyfile(bundle/'manifest.json',dest/'native-manifest.json')
native_meta = [bundle/child['files']['meta']['name'] for child in native_manifest['children']] if native_manifest else []
meta_paths = native_meta if arm.startswith('native-') else sorted(tmp.glob('pi-subagents-uid-*/artifacts/*_meta.json'))
for mp in meta_paths:
    meta = json.loads(mp.read_text())
    tp = bundle / mp.name.replace('_meta.json','_transcript.jsonl') if arm.startswith('native-') else Path(meta['transcriptPath'])
    assert tp.is_file() and (tp.is_relative_to(bundle) if arm.startswith('native-') else tp.is_relative_to(tmp))
    if native_manifest:
        child = next(c for c in native_manifest['children'] if c['files']['meta']['name']==mp.name)
        assert child['files']['meta']['sha256'] == hashlib.sha256(mp.read_bytes()).hexdigest()
        assert child['files']['transcript']['sha256'] == hashlib.sha256(tp.read_bytes()).hexdigest()
    for artifact in mp.parent.glob(mp.name.removesuffix('_meta.json') + '*'):
        if artifact.is_file():
            shutil.copyfile(artifact, dest / artifact.name)
    if arm.startswith('native-'):
        for artifact in tmp.glob('pi-subagents-uid-*/artifacts/'+mp.name.removesuffix('_meta.json')+'*'):
            if artifact.is_file() and not (dest/artifact.name).exists(): shutil.copyfile(artifact,dest/artifact.name)
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
    child_index = int(mp.name.removesuffix('_meta.json').rsplit('_',1)[-1])
    identity = f"{meta['runId']}-{child_index}"
    (dest / (identity + '-diffs.json')).write_text(json.dumps(diffs, ensure_ascii=False, indent=2) + '\n')
    children.append({'id': meta['runId'], 'index':child_index, 'agent': meta['agent'], 'model': meta['model'],
                     'usage': usage, 'cost': cost, 'checks': checks,
                     'transcript': str(dest / tp.name), 'sha256': hashlib.sha256(tp.read_bytes()).hexdigest()})
record, unknown = parse_run(runs, rid, 'actual', bundle=bundle if native_manifest else None)
expected = record['children'] if record['mode'] == 'native' else record['delegates']
checks = {'native_bundle': not arm.startswith('native-') or native_manifest is not None,
          'child_count': len(children) == expected,
          'child_cost': record['child_cost'] is not None and math.isclose(sum(c['cost'] or 0 for c in children), record['child_cost'], abs_tol=1e-8),
          'all_children': all(all(c['checks'].values()) for c in children), 'all_priced': not unknown}
tmp_refs = [c for c in commands if re.search(r'(?<![\w/])/tmp(?:/|\b)', json.dumps(c['args'], ensure_ascii=False))]
(logs / f'attempt-{n}-commands.json').write_text(json.dumps(commands, ensure_ascii=False, indent=2) + '\n')
out = {'id': rid, 'checks': checks, 'children': children, 'tmp_references_requiring_review': tmp_refs,
       'missing_lite_artifacts': arm.startswith('lite-') and expected > 0 and not meta_paths,
       'command_count': len(commands), 'limitations': 'Command references require manual interpretation; Landlock evidence covers local descendants, not arbitrary external services.'}
(logs / f'attempt-{n}-children.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(out, ensure_ascii=False, indent=2))

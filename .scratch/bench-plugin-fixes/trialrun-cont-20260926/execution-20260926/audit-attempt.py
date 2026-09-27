"""Read terminal evidence; Root separately decides whether to start another run."""
import collections
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ordinal = int(sys.argv[1])
logs = Path(__file__).resolve().parent
campaign = Path('/project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926')
old = Path('/project/tmp/ppo-bench/results/native-pilot-t3/runs')
order = json.loads((logs.parent / 'freeze-v3/continuation.json').read_text())['order']
item = next(x for x in order if x['ordinal'] == ordinal)
rid = f"T3-{item['arm']}-{item['rep']}"
prefix = campaign / 'runs' / rid
assert (logs / f'attempt-{ordinal}.exit').exists(), 'Run has not terminated'
ev = json.loads(prefix.with_suffix('.eval.json').read_text())
meta = json.loads(prefix.with_suffix('.meta.json').read_text())
checks = {}
checks['command_exit'] = (logs / f'attempt-{ordinal}.exit').read_text().strip() == '0'
checks['pi_exit'] = prefix.with_suffix('.exit').read_text().strip() == '0'
checks['quality'] = ev['pass'] is True and ev['target_test_exit'] == 0 and not ev['target_failed'] and not ev['new_failures']
checks['non_target_tests_unchanged'] = not ev['non_target_tests_changed']
baseline = {s.strip() for s in Path('bench/baselines/T3.failures.txt').read_text().splitlines() if s.strip() and not s.startswith('#')}
suite_failures = {m.group(1) for s in prefix.with_suffix('.eval-suite.log').read_text().splitlines() if (m := re.match(r'^(?:FAILED|ERROR) (\S+)', s))}
checks['masked_suite_matches'] = suite_failures == baseline and ev['suite_exit'] in (0, 1)
checks['no_new_stop'] = not (campaign / 'STOP').exists()
checks['attempt_count'] = len(list(old.glob('*.jsonl'))) + len(list((campaign / 'runs').glob('*.jsonl'))) == ordinal
checks['frozen_source'] = all(hashlib.sha256(Path(name).read_bytes()).hexdigest() == h for name, h in json.loads((logs.parent / 'freeze-v3/source.sha256.json').read_text()).items())
old_hashes = {str(p.relative_to(old)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(old.rglob('*')) if p.is_file()}
checks['original_runs_unchanged'] = old_hashes == json.loads((logs.parent.parent / 'ticket11-closeout-20260926/runs-before.sha256.json').read_text())
totals = {}
record = None
for weight in ('opus', 'actual'):
    dest = logs / f'after-{ordinal}-{weight}.json'
    cmd = ['python3', '-B', 'bench/summarize.py', str(old), str(campaign / 'runs'), '--weight', weight, '--json', str(dest)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    (logs / f'after-{ordinal}-{weight}.log').write_text(result.stdout + result.stderr + f'\nEXIT={result.returncode}\n')
    summary = json.loads(dest.read_text())
    checks[f'{weight}_complete'] = result.returncode == 0 and not summary['invalid'] and not summary['incomplete'] and summary['attempt_spend_total'] is not None
    totals[weight] = summary['attempt_spend_total']
    if weight == 'opus':
        record = next((r for r in summary['runs'] if r['id'] == rid), None)
pending = {}
diff_calls = {}
diff_results = []
delegate_states = collections.Counter()
errors = 0
gold_refs = 0
for line in prefix.with_suffix('.jsonl').open():
    e = json.loads(line)
    gold_refs += int('gold-T3-cont-20260926' in line)
    if e.get('type') == 'message_end' and (e.get('message') or {}).get('role') == 'assistant':
        errors += int(e['message'].get('stopReason') == 'error')
    if e.get('type') == 'tool_execution_start':
        pending[e.get('toolCallId')] = e.get('toolName')
        args = e.get('args') or e.get('arguments') or {}
        if e.get('toolName') == 'bash' and re.search(r'\bgit\b[^\n;|&]*\bdiff\b', str(args)):
            diff_calls[e.get('toolCallId')] = args
    if e.get('type') == 'tool_execution_end':
        pending.pop(e.get('toolCallId'), None)
        if e.get('toolCallId') in diff_calls:
            diff_results.append({'args': diff_calls[e['toolCallId']], 'result': e.get('result')})
        if e.get('toolName') == 'delegate':
            d = (e.get('result') or {}).get('details') or {}
            delegate_states[str(d.get('status'))] += 1
checks['all_root_tool_calls_terminal'] = not pending
checks['no_root_api_error'] = errors == 0
checks['no_gold_clone_reference'] = gold_refs == 0
(logs / f'attempt-{ordinal}-diff-evidence.json').write_text(json.dumps(diff_results, indent=2) + '\n')
report = {'id': rid, 'ordinal': ordinal, 'checks': checks, 'checks_passed': all(checks.values()), 'totals': totals, 'record': record, 'evaluation': ev, 'delegate_states': dict(delegate_states), 'git_diff_results': len(diff_results), 'stderr_bytes': prefix.with_suffix('.stderr').stat().st_size, 'pending_tools': pending, 'meta_mode': meta['arm']['mode']}
(logs / f'attempt-{ordinal}-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

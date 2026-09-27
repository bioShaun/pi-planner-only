"""Read finished calibration evidence; continuation remains a Root decision."""
import collections
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

n = int(sys.argv[1])
logs = Path(__file__).resolve().parent
base = logs.parent
campaign = Path('/project/tmp/ppo-bench/results/opus-t2c-pair-20260927')
runs = campaign / 'runs'
row = json.loads((logs / 'plan.json').read_text())['order'][n - 1]
task, arm = row['task'], row['arm']
rid = f'{task}-{arm}-1'
p = runs / rid
assert (logs / f'attempt-{n}.exit').exists(), 'Runner not terminal'
ev = json.loads(p.with_suffix('.eval.json').read_text()) if p.with_suffix('.eval.json').exists() else {}
meta = json.loads(p.with_suffix('.meta.json').read_text()) if p.with_suffix('.meta.json').exists() else {}
checks = {}
checks['runner_exit0'] = (logs / f'attempt-{n}.exit').read_text().strip() == '0'
checks['pi_exit0'] = p.with_suffix('.exit').exists() and p.with_suffix('.exit').read_text().strip() == '0'
checks['quality'] = ev.get('pass') is True and ev.get('target_test_exit') == 0 and not ev.get('target_failed') and not ev.get('new_failures')
task_config = json.loads((Path('bench/tasks') / f'{task}.json').read_text())
baseline = {s.strip() for s in (Path('bench/tasks') / task_config['baseline']).read_text().splitlines() if s.strip() and not s.startswith('#')}
suite = p.with_suffix('.eval-suite.log')
failures = {m.group(1) for s in suite.read_text().splitlines() if (m := re.match(r'^(?:FAILED|ERROR) (\S+)', s))} if suite.exists() else set()
checks['baseline_no_new'] = suite.exists() and failures <= baseline and ev.get('suite_exit') in (0, 1) and (task != 'T2c' or ev.get('suite_exit') == 0)
target_log = p.with_suffix('.eval-target.log')
def pytest_counts(path):
    if not path.exists(): return None
    matches = list(re.finditer(r'(?m)^=+ (.+?) in [\d.]+s(?: \([^\n]*\))? =+\s*$', path.read_text(errors='replace')))
    if not matches: return None
    body = matches[-1].group(1)
    return {kind:int(num) for num,kind in re.findall(r'(\d+) (passed|failed|error|errors|skipped|xfailed|xpassed|deselected)', body)}
target_counts, suite_counts = pytest_counts(target_log), pytest_counts(suite)
checks['target_actual_tests'] = target_counts is not None and target_counts.get('passed',0) == (30 if task == 'T1' else 54) and not any(target_counts.get(k,0) for k in ('failed','error','errors','skipped','deselected')) and ev.get('target_test_exit')==0
checks['suite_actual_tests'] = suite_counts is not None and suite_counts.get('passed',0)+suite_counts.get('failed',0) >= (1123 if task == 'T1' else 2652) and ev.get('suite_exit') in (0,1)
checks['no_stop'] = not (campaign / 'STOP').exists()
checks['attempt_count'] = len(list(runs.glob('*.jsonl'))) == n
checks['source_unchanged'] = all(hashlib.sha256(Path(x).read_bytes()).hexdigest() == h for x, h in json.loads((logs.parent / 'freeze/source.sha256.json').read_text()).items())
checks['previous_pilot_unchanged'] = all(hashlib.sha256(Path(x).read_bytes()).hexdigest() == h for x, h in json.loads((logs / 'history.sha256.json').read_text()).items())
expected_child = json.loads((logs.parent / 'freeze/child-config.json').read_text())['agentOverrides']
checks['runtime_metadata'] = meta.get('piVersion') == '0.87.1' and meta.get('piSubagentsVersion') == '0.71.0' and meta.get('childOverrides') == expected_child and meta.get('arm', {}).get('rootModel') == 'tcuni-claude/claude-opus-5-5'
resource = meta.get('tempResource', {})
checks['temp_resource'] = resource.get('backend') == 'landlock' and resource.get('abi', 0) >= 3 and resource.get('tmpdir') == json.loads((logs/'paths.json').read_text())[rid]['tmpdir']
checks['plugin_ref'] = meta.get('arm', {}).get('pluginRef') == 'ad51067da379edf5735cb9b03d70f17bda331675' and (meta.get('arm', {}).get('mode') != 'lite' or meta.get('pluginSha') == 'ad51067da379edf5735cb9b03d70f17bda331675')
totals = {}
segment_totals = {}
execution_plan=json.loads((logs/'plan.json').read_text())
record = None
for weight in ('actual', 'opus'):
    dest = logs / f'after-{n}-{weight}.json'
    r = subprocess.run(['python3', '-B', 'bench/summarize.py', str(runs), '--weight', weight, '--json', str(dest)], capture_output=True, text=True)
    (logs / f'after-{n}-{weight}.log').write_text(r.stdout + r.stderr + f'\nEXIT={r.returncode}\n')
    data = json.loads(dest.read_text())
    checks[f'{weight}_complete'] = r.returncode == 0 and not data['invalid'] and not data['incomplete'] and data['attempt_spend_total'] is not None
    segment_totals[weight]=data['attempt_spend_total']
    totals[weight] = (data['attempt_spend_total'] + execution_plan['prior_'+weight+'_total']) if data['attempt_spend_total'] is not None else None
    if weight == 'actual':
        record = next((x for x in data['runs'] if x['id'] == rid), None)
pending = {}
turns = 0
first = None
dispatch_turns = {}
root_errors = 0
roles = collections.Counter()
calls = collections.Counter()
diff_calls = {}
diffs = []
edit_results = []
terminal_states = collections.Counter()
if p.with_suffix('.jsonl').exists():
    for line in p.with_suffix('.jsonl').open():
        e = json.loads(line)
        if e.get('type') == 'message_end' and (e.get('message') or {}).get('role') == 'assistant':
            turns += 1
            root_errors += int(e['message'].get('stopReason') == 'error')
        if e.get('type') == 'tool_execution_start':
            name = e.get('toolName'); args = e.get('args') or {}
            pending[e.get('toolCallId')] = name
            calls[name] += 1
            if name in ('delegate', 'subagent'):
                dispatch_turns[e.get('toolCallId')] = turns
            if name == 'delegate': roles[str(args.get('role'))] += 1
            if name == 'bash' and re.search(r'\bgit\b[^\n;|&]*\bdiff\b', str(args)):
                diff_calls[e.get('toolCallId')] = args
        if e.get('type') == 'tool_execution_end':
            pending.pop(e.get('toolCallId'), None)
            details = (e.get('result') or {}).get('details') or {}
            launched = (e.get('toolName') == 'delegate' and bool(details.get('usage'))
                        or e.get('toolName') == 'subagent' and details.get('mode') in ('single', 'parallel', 'chain', 'workflow') and bool(details.get('results')))
            if launched:
                start_turn = dispatch_turns.get(e.get('toolCallId'))
                if start_turn is not None:
                    first = start_turn if first is None else min(first, start_turn)
            if e.get('toolCallId') in diff_calls:
                diffs.append({'args': diff_calls[e['toolCallId']], 'result': e.get('result')})
            if e.get('toolName') in ('edit', 'write'):
                edit_results.append(e)
            if e.get('toolName') == 'delegate':
                terminal_states[str(((e.get('result') or {}).get('details') or {}).get('status'))] += 1
checks['no_pending_tool'] = not pending
checks['no_root_api_error'] = root_errors == 0
(logs / f'attempt-{n}-changes.json').write_text(json.dumps({'diff_results': diffs, 'edit_results': edit_results}, indent=2) + '\n')
report = {'id': rid, 'ordinal': n, 'checks': checks, 'checks_passed': all(checks.values()), 'evaluation': ev, 'target_test_counts':target_counts, 'suite_test_counts':suite_counts, 'removed_baseline_failures': sorted(baseline - failures), 'non_target_tests_require_review': ev.get('non_target_tests_changed', []), 'totals': totals, 'segment_totals':segment_totals, 'prior_attempts':1, 'prior_actual_total':execution_plan['prior_actual_total'], 'record': record, 'first_delegate_start_turn': first, 'root_tool_calls': dict(calls), 'delegate_roles': dict(roles), 'delegate_states': dict(terminal_states), 'pending': pending, 'stderr_bytes': p.with_suffix('.stderr').stat().st_size if p.with_suffix('.stderr').exists() else None, 'git_diff_results': len(diffs)}
(logs / f'attempt-{n}-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

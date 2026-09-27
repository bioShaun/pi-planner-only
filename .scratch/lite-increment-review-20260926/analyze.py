"""Read existing pilot transcripts; no model calls or writes to raw evidence."""
import collections
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
PILOT = Path('.scratch/bench-plugin-fixes/trialrun-cont-20260926')
roots = [Path('/project/tmp/ppo-bench/results/native-pilot-t3/runs'),
         Path('/project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926/runs')]
records = {r['id']: r for r in json.loads((PILOT / 'final-opus.json').read_text())['runs']}
prices = json.loads(Path('bench/prices.json').read_text())['weights']['opus']
fields = [('input', 'in'), ('output', 'out'), ('cacheRead', 'cacheRead'), ('cacheWrite', 'cacheWrite')]
def cost(usage):
    return sum(usage.get(k, 0) * prices[p] for k, p in fields) / 1e6

out = []
for root in roots:
    for path in sorted(root.glob('*.jsonl')):
        rid = path.stem
        turns = []
        current = 0
        first_delegate = None
        starts = collections.Counter()
        returns = collections.Counter()
        text_chars = collections.Counter()
        role_counts = collections.Counter()
        tools_by_id = {}
        edit_failure_count = 0
        benchmark_edit_turn = None
        for line in path.open():
            event = json.loads(line)
            message = event.get('message') or {}
            if event.get('type') == 'message_end' and message.get('role') == 'assistant':
                turns.append({'turn': len(turns) + 1, 'cost': cost(message.get('usage') or {})})
                current = len(turns)
            if event.get('type') == 'tool_execution_start':
                name = event.get('toolName')
                args = event.get('args') or {}
                tools_by_id[event.get('toolCallId')] = (name, args)
                starts[name] += 1
                # Native management calls have no agent/tasks/chain launch payload.
                launches = name == 'delegate' or (name == 'subagent' and any(k in args for k in ('agent', 'tasks', 'chain', 'workflow')))
                if launches and first_delegate is None:
                    first_delegate = current
                if name == 'delegate': role_counts[str(args.get('role'))] += 1
                if name == 'edit' and 'tests/benchmarks/test_benchmark_region.py' in str(args) and benchmark_edit_turn is None:
                    benchmark_edit_turn = current
            if event.get('type') == 'tool_execution_end':
                name = event.get('toolName')
                result = event.get('result') or {}
                returns[name] += 1
                text_chars[name] += sum(len(p.get('text', '')) for p in result.get('content') or [] if isinstance(p, dict) and p.get('type') == 'text')
                if name == 'edit' and event.get('isError') is True:
                    edit_failure_count += 1
        first_cost = sum(t['cost'] for t in turns if first_delegate is not None and t['turn'] <= first_delegate)
        suffix_cost = sum(t['cost'] for t in turns if benchmark_edit_turn is not None and t['turn'] >= benchmark_edit_turn)
        rec = records[rid]
        assert abs(sum(t['cost'] for t in turns) - rec['root_cost']) < 1e-8, rid
        out.append({'id': rid, 'mode': rec['mode'], 'root_turns': len(turns),
                    'root_cost': rec['root_cost'], 'child_cost': rec['child_cost'],
                    'first_delegate_tool_start_turn': first_delegate,
                    'root_cost_through_first_dispatch_inclusive': first_cost if first_delegate is not None else None,
                    'root_direct_edit_write_calls': starts['edit'] + starts['write'],
                    'root_edit_errors': edit_failure_count, 'root_tool_starts': dict(starts),
                    'delegate_roles': dict(role_counts), 'terminal_result_text_chars': dict(text_chars),
                    'benchmark_edit_start_turn': benchmark_edit_turn,
                    'root_cost_from_benchmark_edit_through_end': suffix_cost if benchmark_edit_turn else None})
(OUT / 'behavior.json').write_text(json.dumps(out, indent=2) + '\n')
for r in out:
    print(json.dumps(r, ensure_ascii=False))

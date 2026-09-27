#!/usr/bin/env python3
"""Mechanism metrics over bench runs: per-run Root tool mix, delegate outcomes, refusals, truncation, cost split."""
import json, glob, os, re, sys, collections, statistics

ROOT = '/project/tmp/ppo-bench/results'
rows = []
for jl in sorted(glob.glob(f'{ROOT}/*/runs/*.jsonl')):
    camp = jl.split('/')[-3]
    rid = os.path.basename(jl)[:-6]
    evf = jl[:-6] + '.eval.json'
    if not os.path.exists(evf):
        continue
    ev = json.load(open(evf))
    if ev.get('valid') is False:
        continue
    r = dict(camp=camp, id=rid, task=ev.get('task'), arm=ev.get('arm'), passed=ev.get('pass'),
             new_fail=len(ev.get('new_failures') or []), turns=0, tools=collections.Counter(),
             roles=collections.Counter(), status=collections.Counter(), refused=0, truncated=0,
             par_turns=0, child_cost=0.0, root_in=0, root_cr=0, root_out=0, max_ctx=0,
             reports_chars=0, commits=0, suite_runs_by_root=0)
    pending = collections.Counter()
    for line in open(jl):
        try:
            o = json.loads(line)
        except Exception:
            continue
        t = o.get('type')
        if t == 'message_end' and (o.get('message') or {}).get('role') == 'assistant':
            m = o['message']; r['turns'] += 1
            u = m.get('usage') or {}
            r['root_in'] += u.get('input', 0); r['root_cr'] += u.get('cacheRead', 0); r['root_out'] += u.get('output', 0)
            r['max_ctx'] = max(r['max_ctx'], u.get('input', 0) + u.get('cacheRead', 0))
            calls = [c for c in (m.get('content') or []) if isinstance(c, dict) and c.get('type') == 'toolCall']
            if sum(1 for c in calls if c.get('name') == 'delegate') > 1:
                r['par_turns'] += 1
            for c in calls:
                r['tools'][c.get('name')] += 1
                if c.get('name') == 'bash' and 'pytest' in json.dumps(c.get('arguments', {})):
                    r['suite_runs_by_root'] += 1
        elif t == 'tool_execution_end' and o.get('toolName') == 'delegate':
            res = o.get('result') or {}
            txt = ''.join(x.get('text', '') for x in res.get('content', []) if isinstance(x, dict))
            d = res.get('details') or {}
            if 'still running' in txt:
                r['refused'] += 1; r['status']['refused'] += 1; continue
            r['roles'][d.get('role', '?')] += 1
            r['status'][d.get('status', 'error' if o.get('isError') else '?')] += 1
            r['child_cost'] += ((d.get('usage') or {}).get('cost') or 0)
            if 'chars omitted' in txt:
                r['truncated'] += 1
            r['reports_chars'] += len(txt)
        elif t == 'tool_execution_end' and o.get('toolName') == 'git_commit':
            r['commits'] += 1
    rows.append(r)

def agg(name, key, sel=lambda r: True):
    xs = [key(r) for r in rows if sel(r)]
    return f"{name}: n={len(xs)} sum={sum(xs):.0f} median={statistics.median(xs):.2f} max={max(xs):.0f}" if xs else name + ': none'

print('valid runs', len(rows))
for camp in sorted({r['camp'] for r in rows}):
    rs = [r for r in rows if r['camp'] == camp]
    tools = collections.Counter(); roles = collections.Counter(); st = collections.Counter()
    for r in rs: tools.update(r['tools']); roles.update(r['roles']); st.update(r['status'])
    print(f"\n== {camp} runs={len(rs)} pass={sum(1 for r in rs if r['passed'])}")
    print('  root tool calls:', dict(tools.most_common()))
    print('  child roles:', dict(roles), ' status:', dict(st))
    print('  refused/run med', statistics.median([r['refused'] for r in rs]), 'total', sum(r['refused'] for r in rs),
          '| truncated reports total', sum(r['truncated'] for r in rs), 'of', sum(sum(r['roles'].values()) for r in rs),
          '| parallel-delegate turns', sum(r['par_turns'] for r in rs))
    print('  root turns med', statistics.median([r['turns'] for r in rs]),
          '| max ctx med', statistics.median([r['max_ctx'] for r in rs]),
          '| cacheRead/turn med', round(statistics.median([r['root_cr'] / max(r['turns'], 1) for r in rs])),
          '| child_cost med $%.3f' % statistics.median([r['child_cost'] for r in rs]),
          '| commits med', statistics.median([r['commits'] for r in rs]),
          '| root pytest calls total', sum(r['suite_runs_by_root'] for r in rs))

print('\n== T1 failures')
for r in rows:
    if r['task'] == 'T1' and not r['passed']:
        print(' ', r['camp'], r['id'], 'new_fail', r['new_fail'], 'roles', dict(r['roles']), 'refused', r['refused'])
json.dump([{**r, 'tools': dict(r['tools']), 'roles': dict(r['roles']), 'status': dict(r['status'])} for r in rows],
          open(os.path.join(os.path.dirname(__file__), 'metrics.json'), 'w'), indent=1)

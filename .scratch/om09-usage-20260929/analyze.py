"""Offline observational analysis. Times are log envelopes, not causal model benchmarks."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
import json
import re
import statistics
import argparse
import hashlib

BASE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', default='snapshot')
parser.add_argument('--output', default='analysis.json')
options = parser.parse_args()
ROOT = BASE / options.snapshot / 'sessions'
FOCUS = {'claude-opus-5-5': 'Opus', 'claude-sonnet-5-5': 'Sonnet', 'gpt-6-astra': 'Astra'}

def timestamp(x):
    if isinstance(x, (float, int)):
        return x / 1000
    return datetime.fromisoformat(x.replace('Z', '+00:00')).timestamp()

def read(path):
    out = []
    for n, line in enumerate(path.open(), 1):
        if line.strip():
            e = json.loads(line)
            e['_line'] = n
            out.append(e)
    return out

def content(m):
    c = m.get('content', [])
    return c if isinstance(c, list) else [{'type': 'text', 'text': str(c)}]

def text(m):
    return '\n'.join(c.get('text', '') for c in content(m) if isinstance(c, dict))

def merge(intervals):
    out = []
    for a, b in sorted(intervals):
        if b <= a:
            continue
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out

def length(intervals):
    return sum(b - a for a, b in merge(intervals))

def clipped(intervals, active):
    return merge([(max(a, x), min(b, y)) for a, b in intervals for x, y in active
                  if max(a, x) < min(b, y)])

def stats(values):
    values = sorted(values)
    return {'n': len(values), 'sum': sum(values),
            'median': statistics.median(values) if values else None,
            'p90': values[max(0, (9 * len(values) + 9) // 10 - 1)] if values else None}

metas = []
for p in ROOT.glob('*/subagent-artifacts/*_meta.json'):
    x = json.loads(p.read_text())
    x['_path'] = str(p.relative_to(BASE))
    x['_dir'] = p.parent.parent.name
    metas.append(x)

sessions, delegations, tools_child, long_root = [], [], [], []
errors_all, episodes_all, model_turns, gaps_all = [], [], [], []
used_meta = set()
for p in sorted(ROOT.glob('*/*.jsonl')):
    rows = read(p)
    messages = [(e, e['message']) for e in rows if e.get('type') == 'message']
    models = sorted(set(m.get('model', '') for _, m in messages if m.get('role') == 'assistant'))
    group = FOCUS.get(models[0], 'other') if len(models) == 1 else 'mixed'
    sid = p.stem.split('_')[-1]
    ref = str(p.relative_to(BASE))
    active, episodes, opened, user_lines = [], [], None, []
    # A response episode starts with user/handoff input and ends at a successful
    # assistant stop without tools. Errors do not end episodes: host may retry.
    for message_index, (e, m) in enumerate(messages):
        t = timestamp(e['timestamp'])
        if m.get('role') == 'user':
            if opened is None:
                opened = t
                user_lines = []
            user_lines.append(e['_line'])
        if (m.get('role') == 'assistant' and m.get('stopReason') == 'stop'
                and not any(c.get('type') == 'toolCall' for c in content(m)) and opened is not None):
            active.append((opened, t))
            episodes.append({'start': opened, 'end': t, 'complete': True,
                             'user_lines': user_lines, 'end_line': e['_line'], 'termination': 'stop'})
            opened = None
        elif (m.get('role') == 'assistant' and m.get('stopReason') in ['error', 'aborted']
              and opened is not None and message_index + 1 < len(messages)
              and messages[message_index + 1][1].get('role') == 'user'):
            active.append((opened, t))
            episodes.append({'start': opened, 'end': t, 'complete': False,
                             'user_lines': user_lines, 'end_line': e['_line'], 'termination': 'interrupted'})
            opened = None
    if opened is not None and messages:
        t = timestamp(messages[-1][0]['timestamp'])
        active.append((opened, t))
        episodes.append({'start': opened, 'end': t, 'complete': False,
                         'user_lines': user_lines, 'end_line': messages[-1][0]['_line'], 'termination': 'censored'})
    active = merge(active)
    for ep in episodes:
        ep.update(session=sid, group=group, source=ref)
        episodes_all.append(ep)
    results = {m.get('toolCallId'): (e, m) for e, m in messages if m.get('role') == 'toolResult'}
    windows = defaultdict(list)
    tools = Counter()
    root_errors = Counter()
    turns = []
    handoffs = 0
    unmatched = []
    for e, m in messages:
        if m.get('role') != 'assistant':
            continue
        end = timestamp(e['timestamp'])
        start = timestamp(m['timestamp']) if m.get('timestamp') else end
        if end >= start:
            windows['assistant'].append((start, end))
        bad = m.get('stopReason') in ['error', 'aborted']
        if bad:
            root_errors[m.get('errorMessage', m.get('stopReason'))] += 1
            windows['error'].append((start, end))
            errors_all.append({'session': sid, 'group': group, 'source': ref, 'line': e['_line'],
                               'seconds': end-start, 'error': m.get('errorMessage')})
        turn = {'session': sid, 'group': group, 'source': ref, 'line': e['_line'],
                'seconds': end-start, 'error': bad, 'start': start, 'end': end}
        turns.append(turn)
        model_turns.append(turn)
        for c in content(m):
            if c.get('type') != 'toolCall':
                continue
            name = c['name']
            tools[name] += 1
            if name == 'handoff':
                handoffs += 1
            pair = results.get(c['id'])
            if not pair:
                unmatched.append({'id': c['id'], 'name': name, 'line': e['_line']})
                continue
            revent, rm = pair
            rend = timestamp(revent['timestamp'])
            key = 'delegate' if name == 'delegate' else 'root_tool'
            windows[key].append((end, rend))
            if name != 'delegate':
                long_root.append({'session': sid, 'group': group, 'source': ref, 'line': e['_line'],
                                  'end_line': revent['_line'], 'tool': name, 'seconds': rend-end,
                                  'start': end, 'end': rend,
                                  'args_sha256': hashlib.sha256(json.dumps(c.get('arguments',{}),sort_keys=True).encode()).hexdigest(),
                                  'args': str(c.get('arguments', {}))[:1000]})
                continue
            details = rm.get('details', {}) or {}
            usage = details.get('usage', {}) or {}
            candidates = [x for x in metas if x['_dir'] == p.parent.name
                          and x.get('agent') == details.get('agent')
                          and x.get('durationMs') == usage.get('durationMs')
                          and x.get('runId') not in used_meta
                          and abs(timestamp(x.get('timestamp', 0))-rend) < 10]
            record = {'session': sid, 'group': group, 'source': ref,
                      'call_line': e['_line'], 'result_line': revent['_line'],
                      'start': end, 'end': rend, 'envelope_s': rend-end,
                      'role': details.get('role'), 'status': details.get('status'),
                      'child_model': details.get('model'), 'duration_s': usage.get('durationMs', 0)/1000,
                      'task': c.get('arguments', {}).get('task', ''),
                      'report': text(rm), 'meta_matches': len(candidates)}
            if len(candidates) == 1:
                meta = candidates[0]
                used_meta.add(meta['runId'])
                record['run_id'] = meta['runId']
                record['meta'] = meta['_path']
                tp = BASE / meta['_path'].replace('_meta.json', '_transcript.jsonl')
                if tp.exists():
                    cr = read(tp)
                    starts = {}
                    child_intervals = []
                    for ce in cr:
                        ident = ce.get('toolCallId')
                        if ce.get('recordType') == 'tool_start':
                            starts[ident] = ce
                        elif ce.get('recordType') == 'tool_end' and ident in starts:
                            cs = starts.pop(ident)
                            a, b = timestamp(cs['timestamp']), timestamp(ce['timestamp'])
                            child_intervals.append((a,b))
                            tools_child.append({'run_id': meta['runId'], 'group': group,
                                                'source': str(tp.relative_to(BASE)), 'line': cs['_line'],
                                                'tool': cs.get('toolName'), 'seconds': b-a,
                                                'error': ce.get('isError', False),
                                                'preview': cs.get('argsPreview', '')[:400]})
                    record['child_tool_union_s'] = length(child_intervals)
                    record['child_unclosed_tools'] = len(starts)
                    record['child_records'] = len(cr)
            # Delay to the next assistant tool call, plus intervening root actions,
            # is available in detail; never identify all of it as dispatch overhead.
            next_assistant = next(((ne,nm) for ne,nm in messages
                                   if ne['_line'] > revent['_line'] and nm.get('role') == 'assistant'), None)
            if next_assistant:
                ne,nm = next_assistant
                intervening_users = any(revent['_line'] < ue['_line'] < ne['_line'] and um.get('role')=='user'
                                        for ue,um in messages)
                if not intervening_users:
                    record['return_to_next_assistant_s'] = timestamp(ne['timestamp']) - rend
            delegations.append(record)

    windows = {k: clipped(v, active) for k,v in windows.items()}
    # Partition by interval union, so parallel calls never double-count wall.
    cuts = sorted(set(t for ab in active for t in ab) |
                  set(t for v in windows.values() for ab in v for t in ab))
    totals = Counter()
    for a,b in zip(cuts,cuts[1:]):
        mid=(a+b)/2
        if not any(x <= mid < y for x,y in active):
            continue
        flags = {k for k,v in windows.items() if any(x <= mid < y for x,y in v)}
        if 'delegate' in flags and 'root_tool' in flags:
            kind='mixed_tool'
        elif 'delegate' in flags:
            kind='delegate'
        elif 'root_tool' in flags:
            kind='root_tool'
        elif 'assistant' in flags:
            kind='assistant_error' if 'error' in flags else 'assistant_ok'
        else:
            kind='unattributed'
            gaps_all.append({'session':sid,'group':group,'source':ref,'start':a,'end':b,'seconds':b-a})
        totals[kind]+=b-a
    assert abs(sum(totals.values())-length(active))<0.01
    ds=[d for d in delegations if d['session']==sid]
    # Multiple timestamps may represent one assistant/tool batch, so turns != API requests.
    sessions.append({'session':sid,'source':ref,'project':p.parent.name,'group':group,'models':models,
                     'scope': ('business' if any(k in p.parent.name for k in ['--data_0-', '--public-scripts-', '--home-project-', '--home-scripts-']) else 'plugin_or_setup'),
                     'modes':[e.get('data',{}) for e in rows if e.get('customType')=='planner-only-mode'],
                     'entries':len(rows),'active_s':length(active),'parts':dict(totals),
                     'episodes':len(episodes),'complete_episodes':sum(ep['complete'] for ep in episodes),
                     'unfinished_episodes':sum(ep['termination']=='censored' for ep in episodes),
                     'interrupted_episodes':sum(ep['termination']=='interrupted' for ep in episodes),
                     'assistant_messages':len(turns),'root_errors':dict(root_errors),'tools':dict(tools),
                     'delegations':len(ds),'delegate_status':dict(Counter(d['status'] for d in ds)),
                     'delegate_roles':dict(Counter(d['role'] for d in ds)),
                     'root_response_ok':stats([t['seconds'] for t in turns if not t['error']]),
                     'return_to_assistant':stats([d['return_to_next_assistant_s'] for d in ds if 'return_to_next_assistant_s' in d]),
                     'unmatched_tools':unmatched,'handoffs':handoffs})

groups = {}
for name in ['Opus','Sonnet','Astra']:
    ss=[s for s in sessions if s['group']==name]
    dd=[d for d in delegations if d['group']==name]
    parts=Counter();toolcounts=Counter();err=Counter()
    for s in ss:
        parts.update(s['parts']);toolcounts.update(s['tools']);err.update(s['root_errors'])
    groups[name]={'sessions':len(ss),'delegate_sessions':sum(s['delegations']>0 for s in ss),
                  'active_s':sum(s['active_s'] for s in ss),'parts':dict(parts),
                  'episodes':sum(s['episodes'] for s in ss),
                  'unfinished_episodes':sum(s['unfinished_episodes'] for s in ss),
                  'assistant_messages':sum(s['assistant_messages'] for s in ss),
                  'root_errors':dict(err),'tools':dict(toolcounts),'delegations':len(dd),
                  'delegate_status':dict(Counter(d['status'] for d in dd)),
                  'delegate_roles':dict(Counter(d['role'] for d in dd)),
                  'child_models':dict(Counter(d['child_model'] for d in dd)),
                  'child_duration_s':sum(d['duration_s'] for d in dd),
                  'child_tool_union_s':sum(d.get('child_tool_union_s',0) for d in dd),
                  'root_response_ok':stats([t['seconds'] for t in model_turns if t['group']==name and not t['error']]),
                  'root_response_error':stats([t['seconds'] for t in model_turns if t['group']==name and t['error']]),
                  'return_to_assistant':stats([d['return_to_next_assistant_s'] for d in dd if 'return_to_next_assistant_s' in d])}

output={'groups':groups,'sessions':sessions,'delegations':delegations,'root_turns':model_turns,
        'root_tools':long_root,'child_tools':tools_child,'errors':errors_all,'gaps':gaps_all,'episodes':episodes_all,
        'quality':{'files':len(sessions),'meta_files':len(metas),'matched_meta':len(used_meta),
                   'unmatched_delegations':sum(d['meta_matches']!=1 for d in delegations),
                   'unmatched_root_tools':sum(len(s['unmatched_tools']) for s in sessions)}}
(BASE/options.output).write_text(json.dumps(output,ensure_ascii=False,indent=2))
print(json.dumps({'groups':groups,'quality':output['quality']},ensure_ascii=False,indent=2))

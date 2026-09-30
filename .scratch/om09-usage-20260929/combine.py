from pathlib import Path
from collections import Counter
import csv
import json
import statistics

B = Path(__file__).resolve().parent
datasets = [('om09', json.loads((B/'analysis.json').read_text())),
            ('tcuni-claw', json.loads((B/'local-analysis.json').read_text()))]

def stats(xs):
    xs=sorted(xs)
    return {'n':len(xs),'median':statistics.median(xs) if xs else None,
            'p90':xs[max(0,(len(xs)*9+9)//10-1)] if xs else None,'sum':sum(xs)}

sessions=[];delegations=[];turns=[];roottools=[];errors=[];childtools=[]
for host,x in datasets:
    selected=[s for s in x['sessions'] if s['scope']=='business' and s['group'] in ['Opus','Sonnet','Astra']]
    ids={s['session'] for s in selected}
    sessions.extend(dict(s,host=host) for s in selected)
    for key,dest in [('delegations',delegations),('root_turns',turns),('root_tools',roottools),('errors',errors)]:
        dest.extend(dict(r,host=host) for r in x[key] if r['session'] in ids)
    runs={d['run_id'] for d in x['delegations'] if d['session'] in ids and 'run_id' in d}
    childtools.extend(dict(t,host=host) for t in x['child_tools'] if t['run_id'] in runs)

groups={}
for host in ['all','om09','tcuni-claw']:
    for group in ['Opus','Sonnet','Astra']:
        ss=[s for s in sessions if s['group']==group and (host=='all' or s['host']==host)]
        dd=[d for d in delegations if d['group']==group and (host=='all' or d['host']==host)]
        tt=[t for t in turns if t['group']==group and (host=='all' or t['host']==host)]
        parts=Counter();tools=Counter();err=Counter()
        for s in ss:parts.update(s['parts']);tools.update(s['tools']);err.update(s['root_errors'])
        active=sum(parts.values())
        groups[host+'/'+group]={'sessions':len(ss),'delegate_sessions':sum(s['delegations']>0 for s in ss),
            'episodes':sum(s['episodes'] for s in ss),'unfinished_episodes':sum(s['unfinished_episodes'] for s in ss),
            'active_s':active,'parts_s':dict(parts),'parts_pct':{k:100*v/active for k,v in parts.items()},
            'delegate_requests':tools['delegate'],'delegate_results':len(dd),
            'delegate_status':dict(Counter(d['status'] for d in dd)),
            'delegate_roles':dict(Counter(d['role'] for d in dd)),
            'root_tool_calls_excluding_delegate':sum(tools.values())-tools['delegate'],
            'root_edit_write_calls':tools['edit']+tools['write'],
            'root_tool_counts':dict(tools),'root_error_messages':dict(err),
            'root_response_ok_s':stats([t['seconds'] for t in tt if not t['error']]),
            'return_to_next_assistant_s':stats([d['return_to_next_assistant_s'] for d in dd if 'return_to_next_assistant_s' in d]),
            'delegate_envelope_minus_child_s':stats([d['envelope_s']-d['duration_s'] for d in dd]),
            'child_reported_duration_s':sum(d['duration_s'] for d in dd),
            'child_tool_union_s':sum(d.get('child_tool_union_s',0) for d in dd),
            'child_unclosed_tools':sum(d.get('child_unclosed_tools',0) for d in dd)}

# Metadata and line references only; raw messages stay in ignored snapshots.
out={'groups':groups,'totals':{'business_sessions':len(sessions),'delegate_results':len(delegations),
     'delegate_requests':sum(s['tools'].get('delegate',0) for s in sessions)},
     'timed_out':[ {k:d.get(k) for k in ['host','group','source','call_line','result_line','run_id','duration_s','child_tool_union_s','child_unclosed_tools']} for d in delegations if d['status']=='timed_out']}
(B/'business-summary.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
with (B/'sessions.csv').open('w') as f:
    keys=['host','group','session','source','active_s','episodes','unfinished_episodes','assistant_messages','delegations']
    writer=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');writer.writeheader();writer.writerows(sessions)
with (B/'delegations.csv').open('w') as f:
    keys=['host','group','session','source','call_line','result_line','role','status','child_model','run_id','duration_s','envelope_s','child_tool_union_s','return_to_next_assistant_s']
    writer=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');writer.writeheader();writer.writerows(delegations)
print(json.dumps(out,ensure_ascii=False,indent=2))

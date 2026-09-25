#!/usr/bin/env python3
import argparse, json, os, random, re, statistics, sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from runcheck import check as check_run
FIELDS=("input","output","cacheRead","cacheWrite")
SUFFIXES={"low","medium","high","minimal","none"}
PRICES=json.loads((BASE/"prices.json").read_text())

def price(t,p): return sum(t[k]*p[short] for k,short in zip(FIELDS,("in","out","cacheRead","cacheWrite")))/1e6
def model_key(m):
    if m in PRICES["models"]: return m
    if m and ":" in m:
        b,s=m.rsplit(":",1)
        if s in SUFFIXES and b in PRICES["models"]: return b
    return None

def parse_run(directory,rid,weight):
    m=re.match(r'^(T\d+[a-z]?)-(.+)-(\d+)$',rid)
    task,arm,rep=(m.group(1),m.group(2),int(m.group(3))) if m else (None,None,None)
    evp=directory/(rid+'.eval.json')
    if not evp.exists(): return None,[]
    ev=json.loads(evp.read_text()); meta={}
    mp=directory/(rid+'.meta.json')
    if mp.exists():
        try: meta=json.loads(mp.read_text())
        except ValueError: pass
    arm=(ev.get('arm') or (ev.get('arm') if isinstance(ev.get('arm'),str) else None) or (meta.get('arm') or {}).get('name') or arm)
    if isinstance(arm,dict): arm=arm.get('name') or (m.group(2) if m else None)
    rec=dict(id=rid,task=ev.get('task') or task,arm=arm,rep=ev.get('rep',rep),exit=None,passed=ev.get('pass'),wall=None,root_turns=0,delegates=0,root={k:0 for k in FIELDS},child_cost=0,root_cost=0,total_cost=0,refused=0,detached=0,truncated=0,root_reads=0,root_bash=0,root_cache_read=0,extra_tools=0,turns_per_delegate=None)
    for ext,key,cast in [('exit','exit',int),('wall','wall',int)]:
        p=directory/(rid+'.'+ext)
        if p.exists():
            try: rec[key]=cast(p.read_text().strip())
            except ValueError: rec[key]=p.read_text().strip()
    unknown=[]; models=[]
    jp=directory/(rid+'.jsonl')
    if jp.exists():
        for line in jp.open():
            try:e=json.loads(line)
            except (ValueError,TypeError):continue
            if e.get('type')=='message_end' and (e.get('message') or {}).get('role')=='assistant':
                msg=e['message']; rec['root_turns']+=1; u=msg.get('usage') or {}
                for k in FIELDS: rec['root'][k]+=int(u.get(k) or 0)
                rec['root_cache_read']+=int(u.get('cacheRead') or 0)
                for call in msg.get('content') or []:
                    if isinstance(call,dict) and call.get('type')=='toolCall':
                        name=call.get('name')
                        if name=='read': rec['root_reads']+=1
                        elif name=='bash': rec['root_bash']+=1
                        if name in ('subagent_supervisor','bg_wait'): rec['extra_tools']+=1
            elif e.get('type')=='tool_execution_end' and e.get('toolName')=='delegate':
                result=e.get('result') or {}
                txt=''.join(x.get('text','') for x in result.get('content',[]) if isinstance(x,dict))
                if 'still running' in txt: rec['refused']+=1
                if 'Detached for intercom' in txt: rec['detached']+=1
                if 'chars omitted' in txt: rec['truncated']+=1
                d=result.get('details') or {}
                # A refused delegate launched no child: no model, no usage, no cost.
                if d.get('status')=='refused' and not d.get('usage'): continue
                rec['delegates']+=1; u=d.get('usage') or {}; key=model_key(d.get('model'))
                if key: rec['child_cost']+=price({k:int(u.get(k) or 0) for k in FIELDS},PRICES['models'][key])
                else: unknown.append(d.get('model'))
                models.append(d.get('model'))
    rec['turns_per_delegate']=rec['root_turns']/rec['delegates'] if rec['delegates'] else None
    root_model=(meta.get('arm') or {}).get('rootModel') or (meta.get('arm') or {}).get('root_model')
    table=PRICES['weights'].get(weight) if weight!='actual' else PRICES['models'].get(model_key(root_model))
    rec['root_cost']=price(rec['root'],table) if table else None
    rec['total_cost']=rec['root_cost']+rec['child_cost'] if rec['root_cost'] is not None else None
    return rec,unknown

def med(xs): return statistics.median(xs) if xs else None
def mean(xs): return statistics.mean(xs) if xs else None
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('runs',nargs='+'); ap.add_argument('--weight',choices=['opus','astra','sol','actual'],default='opus'); ap.add_argument('--baseline'); ap.add_argument('--metric',choices=['cost','root_cache_read','root_reads','refused','detached','truncated','root_turns'],default='cost'); ap.add_argument('--json',dest='json_out'); a=ap.parse_args()
    records=[]; incomplete=[]; unknown=[]; invalid=[]; plugin_shas={}
    for folder in a.runs:
        directory=Path(folder)
        for p in sorted(directory.glob('*.jsonl')):
            validity=check_run(p)
            if not validity['valid']:
                print(f"{p.stem}: INVALID {'; '.join(validity['reasons'])}")
                invalid.append({'id':p.stem,'reasons':validity['reasons']}); continue
            r,u=parse_run(directory,p.stem,a.weight)
            if r is None: print(f'{p.stem}: INCOMPLETE'); incomplete.append(p.stem); continue
            records.append(r); unknown.extend((p.stem,m) for m in u)
            mp=directory/(p.stem+'.meta.json')
            if mp.exists():
                try: plugin_sha=json.loads(mp.read_text()).get('pluginSha')
                except (OSError,ValueError): plugin_sha=None
                if plugin_sha: plugin_shas.setdefault(r['arm'],[]).append(plugin_sha)
    mixed_plugin={}
    for arm,shas in plugin_shas.items():
        counts={sha:shas.count(sha) for sha in sorted(set(shas))}
        if len(counts)>1:
            mixed_plugin[arm]=counts
            detail=', '.join(f'{sha[:7]} ({count})' for sha,count in counts.items())
            print(f'MIXED pluginSha {arm}: {detail}')
    for rid,m in unknown: print(f'{rid}: UNPRICED child model: {m}')
    for r in records:
        print(f"{r['task']} {r['arm']} {r['rep']}: exit={r['exit']} pass={r['passed']} wall={r['wall']} root_turns={r['root_turns']} delegates={r['delegates']} tokens(in/out/cacheRead/cacheWrite)="+"/".join(str(r['root'][k]) for k in FIELDS)+f" root_cost=${r['root_cost']:.4f}" if r['root_cost'] is not None else f"{r['task']} {r['arm']} {r['rep']}: root_cost=UNPRICED")
        if r['root_cost'] is not None: print(f"  child_cost=${r['child_cost']:.4f} total_cost=${r['total_cost']:.4f}")
    arms=sorted({r['arm'] for r in records if r['arm']}); aggs={}; task_aggs={}
    for arm in arms:
        rs=[r for r in records if r['arm']==arm]; passed=[r for r in rs if r['passed'] is True]
        costs=[r['total_cost'] for r in passed if r['total_cost'] is not None]
        aggs[arm]={'runs':len(rs),'pass':sum(r['passed'] is True for r in rs),'pass_rate':sum(r['passed'] is True for r in rs)/len(rs) if rs else None,'median_cost':med(costs),'mean_cost':mean(costs),'median_root_turns':med([r['root_turns'] for r in rs]),'median_wall':med([r['wall'] for r in rs if isinstance(r['wall'],int)]),'root_tokens':{k:sum(r['root'][k] for r in rs) for k in FIELDS}}
        aggs[arm]['mechanism']={'refused':sum(r['refused'] for r in rs),'detached':sum(r['detached'] for r in rs),'truncated':sum(r['truncated'] for r in rs),'root_reads_med':med([r['root_reads'] for r in rs]),'root_bash_med':med([r['root_bash'] for r in rs]),'cache_read_med':med([r['root_cache_read'] for r in rs]),'turns_per_delegate_med':med([r['turns_per_delegate'] for r in rs if r['turns_per_delegate'] is not None]),'extra_tools':sum(r['extra_tools'] for r in rs)}
    tasks=sorted({r['task'] for r in records})
    for t in tasks:
        for arm in arms:
            rs=[r for r in records if r['task']==t and r['arm']==arm]; costs=[r['total_cost'] for r in rs if r['passed'] is True and r['total_cost'] is not None]
            if rs: task_aggs[(t,arm)]={'n':len(rs),'pass':sum(r['passed'] is True for r in rs),'median_cost':med(costs),'min_cost':min(costs) if costs else None,'max_cost':max(costs) if costs else None}
    print('AGGREGATES')
    for arm,x in aggs.items(): print(f"{arm}: runs={x['runs']} pass={x['pass']}/{x['runs']} median=${x['median_cost']:.4f} mean=${x['mean_cost']:.4f}" if x['median_cost'] is not None else f'{arm}: runs={x["runs"]} pass={x["pass"]}/{x["runs"]} cost=NA')
    for (t,arm),x in task_aggs.items(): print(f"{t} {arm}: n={x['n']} pass={x['pass']} median_cost={x['median_cost']}")
    for arm,x in aggs.items():
        m=x['mechanism']; print(f"MECH {arm}: refused={m['refused']} detached={m['detached']} truncated={m['truncated']} root_reads_med={m['root_reads_med']} root_bash_med={m['root_bash_med']} cache_read_med={m['cache_read_med']} turns_per_delegate_med={m['turns_per_delegate_med']} extra_tools={m['extra_tools']}")
    comparisons={}
    if a.baseline:
        base=a.baseline; metric_key={'cost':'total_cost'}.get(a.metric,a.metric)
        comparisons={'baseline':base,'arms':{}}
        for arm in arms:
            if arm==base:continue
            pairs=[]; allpairs=[]
            for t in tasks:
                aa=[r[metric_key] for r in records if r['task']==t and r['arm']==arm and r.get(metric_key) is not None]; bb=[r[metric_key] for r in records if r['task']==t and r['arm']==base and r.get(metric_key) is not None]
                pa=[r[metric_key] for r in records if r['task']==t and r['arm']==arm and r['passed'] is True and r.get(metric_key) is not None]; pb=[r[metric_key] for r in records if r['task']==t and r['arm']==base and r['passed'] is True and r.get(metric_key) is not None]
                if pa and pb: pairs.append((t,pa,pb))
                if aa and bb: allpairs.append((t,aa,bb))
            def ratio(ps,bootstrap=False):
                den=sum(mean(y) for _,_,y in ps); num=sum(mean(x) for _,x,_ in ps)
                point=num/den if den else None
                if not bootstrap or not ps:return point,None
                rng=random.Random(0); vals=[]
                for _ in range(2000):
                    n=d=0
                    for _,x,y in ps:
                        n+=mean([rng.choice(x) for i in x]); d+=mean([rng.choice(y) for i in y])
                    if d: vals.append(n/d)
                if not vals: return point,None
                vals.sort(); return point,[vals[int(.05*(len(vals)-1))],vals[int(.95*(len(vals)-1))]]
            point,ci=ratio(pairs,True); allpoint,_=ratio(allpairs)
            tr={t:med(x)/med(y) for t,x,y in pairs if med(y)}
            if a.metric=='cost': print(f'{arm}/{base} passing task ratios={tr} overall={point} CI90={ci}; all-runs={allpoint}')
            else: print(f'{arm}/{base} {a.metric} passing task ratios={tr} overall={point} CI90={ci}; all-runs={allpoint}')
            comparisons['arms'][arm]={'passing_task_ratios':tr,'passing_overall_ratio':point,'passing_ci90':ci,'all_runs_task_ratios':{t:med(x)/med(y) for t,x,y in allpairs if med(y)},'all_runs_overall_ratio':allpoint}
    if a.json_out:
        data={'runs':records,'incomplete':incomplete,'invalid':invalid,'aggregates':aggs,'task_aggregates':{f'{t}|{arm}':v for (t,arm),v in task_aggs.items()},'comparisons':comparisons,'mixed_plugin':mixed_plugin}
        Path(a.json_out).write_text(json.dumps(data,indent=2)+'\n')
    return 1 if unknown else 0
if __name__=='__main__': sys.exit(main())

#!/usr/bin/env python3
"""Bounded, read-only attribution of wall time outside child active intervals."""
import importlib.util, json, os, statistics, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('repeat_work', HERE / 'repeat_work.py')
rw = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(rw)
RUNS = [
 '/project/tmp/ppo-bench/results/o2-t2/runs/T2-lite-tds-strict-o2-1.jsonl',
 '/project/tmp/ppo-bench/results/o2-t2/runs/T2-lite-tds-strict-o2-2.jsonl',
 *[f'/project/tmp/ppo-bench/results/{c}/runs/T2-lite-tds-strict-treat-1.jsonl' for c in ('rdt-r2t','rdt-r3t','rdt-r5s')],
]
PHASES = ['before first delegate','after explorer','after worker','after validator','after reviewer','final wrap-up']

def ms_time(s):
    if isinstance(s, (int, float)): return float(s) / 1000
    try: return rw.parse_time(s)
    except Exception: return 0

def analyze(path, idx):
    events=[]; calls={}; results=[]; messages=[]; tools=set(); session=0
    with open(path, errors='replace') as f:
      for line in f:
        try:e=json.loads(line)
        except ValueError:continue
        if e.get('type')=='session': session=ms_time(e.get('timestamp'))
        m=e.get('message') or {}; typ=e.get('type')
        ts=ms_time(m.get('timestamp') or e.get('timestamp'))
        if typ=='message_end' and m.get('role')=='assistant':
          for c in m.get('content',[]) if isinstance(m.get('content'),list) else []:
            if c.get('type') in ('toolCall','tool_call'):
              tools.add(c.get('name','?')); calls[c.get('id')]=(c.get('name','?'),ts,c.get('arguments') or {},m)
              events.append({'t':ts,'kind':'call','name':c.get('name','?'),'args':c.get('arguments') or {},'msg':m})
          messages.append((ts,m))
        if typ=='message_end' and m.get('role')=='toolResult':
          cid=m.get('toolCallId'); call=calls.get(cid)
          if call:
            name,start,args,_=call
            events.append({'t':ts,'kind':'result','name':name,'start':start,'args':args,'msg':m})
            if name=='delegate': results.append((m,e.get('timestamp'),args,start,ts))
    wall=float(Path(path.removesuffix('.jsonl')+'.wall').read_text().strip())
    rows=rw.root_rows(path); meta_path=path.removesuffix('.jsonl')+'.meta.json'
    meta=json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    camp=path.split('/results/')[1].split('/')[0]; rid=camp+'-'+Path(path).stem
    # Preserve actual transcript match logic; intervals use first/last message ts.
    spans=[]; matches=[]
    for r in rows:
      hit=rw.match_transcript(r,idx,rid,meta); span=None; tp=''
      if hit:
        _,tp,_m=hit; stamps=[]
        for line in open(tp,errors='replace'):
          try:x=json.loads(line)
          except ValueError:continue
          msg=x.get('message') or {}; stamp=x.get('ts') or msg.get('timestamp')
          if stamp and msg.get('role') in ('assistant','user'): stamps.append(int(stamp)/1000)
        if stamps: span=(min(stamps),max(stamps))
      r['span']=span; r['transcript']=tp; matches.append(r)
      if span: spans.append((span[0],span[1],r['role'],r['i']))
    start=session or (min((e['t'] for e in events if e['t']),default=0)); end=start+wall
    spans=[(max(start,a),min(end,b),role,i) for a,b,role,i in spans if b>start and a<end]
    # Timeline boundaries: classify each adjacent interval, retaining tool/call and child semantics.
    bounds={start,end}
    for a,b,_,_ in spans: bounds.update((a,b))
    for ev in events:
      if ev['t']: bounds.add(max(start,min(end,ev['t'])))
      if ev.get('kind')=='result' and ev.get('start'): bounds.add(max(start,min(end,ev['start'])))
    bounds=sorted(bounds); seg=[]
    for a,b in zip(bounds,bounds[1:]):
      if b<=a:continue
      mid=(a+b)/2; active=[s for s in spans if s[0]<=mid<s[1]]
      if active: cat='child-active '+','.join(f'{r}#{i}' for _,_,r,i in active)
      else:
        running=[e for e in events if e['kind']=='call' and e['name']!='delegate' and e['t']<=mid and not any(z['kind']=='result' and z['name']==e['name'] and z['start']==e['t'] and z['t']<=mid for z in events)]
        delegates=[e for e in events if e['kind']=='call' and e['name']=='delegate' and e['t']<=mid and not any(z['kind']=='result' and z['name']=='delegate' and z['start']==e['t'] and z['t']<=mid for z in events)]
        if running:cat='Root-own-tool '+running[-1]['name']
        elif delegates:
          d=delegates[-1]; match=next((r for r in matches if r['i'] and r['role']==(d['args'].get('role') or '')),None)
          cat='delegate-submit-to-child-start' if match and match['span'] and mid<match['span'][0] else 'child-end-to-Root-next-action'
        else:
          prev=[e for e in events if e['t']<=mid]; nxt=[e for e in events if e['t']>mid]
          cat='Root-assistant-turn' if prev and prev[-1]['kind']=='result' and prev[-1]['name']!='delegate' and nxt and nxt[0]['kind']=='call' else '无法区分'
      seg.append((a-start,b-a,cat))
    # Ensure numeric wall partition despite event timestamp rounding / incomplete coverage.
    total=sum(d for _,d,_ in seg); residual=wall-total
    if abs(residual)>.01: seg.append((max(0,total),residual,'无法区分 (unexplained residual)'))
    # child interval union and overlap
    union=[]; overlap=0
    for a,b,_,_ in sorted(spans):
      if union and a<union[-1][1]: overlap+=max(0,min(b,union[-1][1])-a); union[-1]=(union[-1][0],max(b,union[-1][1]))
      else:union.append((a,b))
    union_s=sum(b-a for a,b in union)
    # Root action gaps between successive timestamped events; phase by prior role.
    delegates=[x for x in results]; gaps=[]
    role_phase={'explorer':'after explorer','worker':'after worker','validator':'after validator','reviewer':'after reviewer'}
    phase='before first delegate'; last_action=start
    for m,ts,ars,ds,de in delegates:
      role=(m.get('details') or {}).get('role','?'); gaps.append((max(0,ds-last_action),phase,'previous action',f'delegate {role}',0))
      phase=role_phase.get(role,phase); last_action=de
    for t,m in messages:
      if t<=last_action:continue
      phase='final wrap-up' if not any(de>t for _,_,_,_,de in delegates) else phase
      usage=m.get('usage') or {}; toks=usage.get('output') or usage.get('output_tokens') or usage.get('completion_tokens') or 0
      gaps.append((max(0,t-last_action),phase,'delegate/result','assistant message',toks)); last_action=t
    if end>last_action:gaps.append((end-last_action,'final wrap-up','last action','run end',0))
    return dict(path=path,wall=wall,start=start,end=end,events=events,tools=tools,rows=rows,spans=spans,union=union_s,overlap=overlap,seg=seg,gaps=gaps,delegates=delegates)

def main():
 idx=rw.load_index(); results=[analyze(p,idx) for p in (sys.argv[1:] or RUNS)]
 print('Timestamp inventory: Root session timestamp; event timestamp; message_end for assistant/toolResult. No message start/end pair, toolCall start is assistant message_end and toolResult end is toolResult message_end. Root tools:', ', '.join(sorted(set().union(*(r['tools'] for r in results)))))
 for r in results:
  print(f"\n== {Path(r['path']).name} wall={r['wall']:.2f}s union_child={r['union']:.2f}s remainder={r['wall']-r['union']:.2f}s overlap={'yes' if r['overlap']>.01 else 'no'} ({r['overlap']:.2f}s)")
  print('start_s duration_s category')
  for a,d,c in r['seg']: print(f'{a:.2f}\t{d:.2f}\t{c}')
  print(f"segments_sum={sum(d for _,d,_ in r['seg']):.2f}s wall={r['wall']:.2f}s")
  print('phase turns total_s median_gap_s max_gap_s')
  for ph in PHASES:
   gs=[g[0] for g in r['gaps'] if g[1]==ph]
   print(f'{ph}\t{len(gs)}\t{sum(gs):.2f}\t{statistics.median(gs) if gs else 0:.2f}\t{max(gs,default=0):.2f}')
  print('top gaps seconds phase before -> after output_tokens')
  for d,p,b,a,t in sorted(r['gaps'],reverse=True)[:5]:print(f'{d:.2f}\t{p}\t{b} -> {a}\t{t}')
  cats={}
  for _,d,c in r['seg']:
   if not c.startswith('child-active'):cats[c.split(' ')[0]]=cats.get(c.split(' ')[0],0)+d
  print('remainder category seconds:',cats)
 print('\nAggregate descriptive only; per-arm means (n=2/n=3)')
 for label,group in [('all',results),('o2',[r for r in results if '/o2-' in r['path']]),('treat',[r for r in results if 'treat' in r['path']])]:
  if not group:continue
  print(label,'n=',len(group),'wall_mean=',sum(x['wall'] for x in group)/len(group),'child_union_mean=',sum(x['union'] for x in group)/len(group),'remainder_mean=',sum(x['wall']-x['union'] for x in group)/len(group),'overlap_runs=',sum(x['overlap']>.01 for x in group))

if __name__=='__main__':main()

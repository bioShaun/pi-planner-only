import json,glob,os,collections,sys
rows=[]
for f in sorted(glob.glob('snapshot/sessions/*/*.jsonl')):
    models=collections.Counter(); modes=[]; calls={}; res=[]; errs=[]; tools=collections.Counter(); custom=collections.Counter()
    n=0
    for line in open(f):
        n+=1
        try:e=json.loads(line)
        except: errs.append(('badjson',n)); continue
        t=e.get('type')
        if t=='custom': custom[e.get('customType')]+=1
        if t=='custom' and 'mode' in json.dumps(e.get('data',''))[:200] and 'planner' in str(e.get('customType')): modes.append(json.dumps(e.get('data'))[:80])
        m=e.get('message') or {}
        if t=='message' and m.get('role')=='assistant':
            models[m.get('model')]+=1
            if m.get('stopReason') in('error','aborted'): errs.append((m.get('stopReason'),n,(m.get('errorMessage') or '')[:120]))
            for c in m.get('content') or []:
                if c.get('type')=='toolCall':
                    tools[c['name']]+=1
                    if c['name']=='delegate': calls[c['id']]=(n,c.get('arguments',{}).get('role'))
        if t=='message' and m.get('role')=='toolResult' and m.get('toolCallId') in calls:
            d=m.get('details') or {}
            txt=''.join(x.get('text','') for x in m.get('content') or [] if x.get('type')=='text')
            res.append((calls[m['toolCallId']][1], d.get('status') or d.get('outcome') or ('ERR' if m.get('isError') else '?'), n, txt[:160].replace('\n',' ')))
    print('==',f.split('sessions/')[1], 'lines',n)
    print('  models',dict(models),'custom',dict(custom))
    print('  modes',modes[:3])
    print('  tools',dict(tools.most_common(12)))
    for r in res: print('  DELEGATE',r)
    unmatched=set(calls)-set()
    for e in errs: print('  ERR',e)

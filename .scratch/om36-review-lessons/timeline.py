"""Timeline of the om36 #32 session: user turns, delegate/git/bash calls and results."""
import json, sys, glob

path = glob.glob('snapshot/*.jsonl')[0]
calls = {}
for n, line in enumerate(open(path), 1):
    e = json.loads(line)
    t = e.get('type'); ts = (e.get('timestamp') or '')[11:19]
    if t != 'message':
        if t in ('model_change', 'compaction', 'custom') and 'planner' in json.dumps(e)[:300]:
            print(f'{n:5} {ts} [{t}] {json.dumps(e.get("data", e))[:160]}')
        continue
    m = e['message']; role = m.get('role')
    if role == 'user':
        txt = ''.join(c.get('text', '') for c in m.get('content') or [] if isinstance(c, dict))
        if isinstance(m.get('content'), str): txt = m['content']
        print(f'{n:5} {ts} USER: {txt[:400]!r}')
    elif role == 'assistant':
        for c in m.get('content') or []:
            if c.get('type') == 'text' and len(c['text']) > 0 and '--text' in sys.argv:
                print(f'{n:5} {ts}   A: {c["text"][:300]!r}')
            if c.get('type') == 'toolCall':
                a = c.get('arguments', {})
                name = c['name']
                if name in ('delegate', 'git_commit', 'subagent'):
                    desc = f"role={a.get('role')} base={a.get('base')} cwd={a.get('cwd')} task={(a.get('task') or json.dumps(a))[:600]!r}"
                elif name == 'bash':
                    desc = repr(a.get('command', '')[:200])
                else:
                    desc = json.dumps(a)[:150]
                calls[c['id']] = name
                if name != 'bash' or '--bash' in sys.argv or 'git' in a.get('command', '')[:40] or 'gh ' in a.get('command', ''):
                    print(f'{n:5} {ts}   CALL {name}: {desc}')
    elif role == 'toolResult':
        name = calls.get(m.get('toolCallId'))
        if name in ('delegate', 'git_commit', 'subagent'):
            d = m.get('details') or {}
            txt = ''.join(x.get('text', '') for x in m.get('content') or [] if x.get('type') == 'text')
            print(f'{n:5} {ts}   RES {name} status={d.get("status")} err={m.get("isError")} {txt[:500]!r}')

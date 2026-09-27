#!/usr/bin/env python3
"""Compact Root timeline for one run: turn, tool calls, delegate outcomes and key markers."""
import json, sys, re

KEYS = ['replace_primaries', 'omitted', 'pre-existing', 'preexisting', 'unrelated', 'baseline', 'failed', 'passed']
for jl in sys.argv[1:]:
    print('#####', jl.split('/')[-1])
    turn = 0; starts = {}
    last_text = ''
    for line in open(jl):
        o = json.loads(line)
        t = o.get('type')
        if t == 'message_end' and (o.get('message') or {}).get('role') == 'assistant':
            turn += 1
            content = o['message'].get('content') or []
            text = ' '.join(c.get('text', '') for c in content if c.get('type') == 'text').strip()
            if text: last_text = text
            calls = [c for c in content if c.get('type') == 'toolCall']
            for c in calls:
                a = c.get('arguments') or {}
                if c.get('name') == 'delegate':
                    task = re.sub(r'\s+', ' ', a.get('task', ''))
                    print(f"T{turn} delegate[{a.get('role')}] {task[:260]}")
                elif c.get('name') == 'bash':
                    print(f"T{turn} bash {re.sub(chr(10),' ',a.get('command',''))[:160]}")
                elif c.get('name') in ('read',):
                    print(f"T{turn} read {a.get('path')}")
                else:
                    print(f"T{turn} {c.get('name')} {json.dumps(a)[:120]}")
        elif t == 'tool_execution_end' and o.get('toolName') == 'delegate':
            txt = ''.join(x.get('text', '') for x in (o.get('result') or {}).get('content', []) if isinstance(x, dict))
            flags = [k for k in KEYS if k in txt.lower()]
            m = re.search(r'(\d+) failed', txt)
            snippet = ''
            i = txt.find('replace_primaries')
            if i >= 0: snippet = re.sub(r'\s+', ' ', txt[max(0, i - 150):i + 200])
            print(f"   -> {re.sub(chr(10),' ',txt[:110])} | len={len(txt)} flags={flags} {m.group(0) if m else ''}")
            if snippet: print(f"      RP: {snippet}")
    print('FINAL:', re.sub(r'\s+', ' ', last_text)[:700])
    print()

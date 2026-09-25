#!/usr/bin/env python3
import json
import re
import sys
from collections import Counter
from pathlib import Path

API_ERROR = re.compile(r'API error \((5\d\d|429|403)\)')


def check(path):
    errors = Counter()
    roots = 0
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if event.get('type') == 'message_end' and (event.get('message') or {}).get('role') == 'assistant':
                    roots += 1
                    msg = event['message']
                    if msg.get('stopReason') == 'error':
                        text = str(msg.get('errorMessage') or 'unknown error').replace('\n', ' ')[:150]
                        errors[('root stopReason=error', text)] += 1
                if event.get('type') == 'tool_execution_end' and event.get('toolName') == 'delegate':
                    result = event.get('result') or {}
                    content = result.get('content') or []
                    text = ' '.join(str(x.get('text', '')) for x in content if isinstance(x, dict))
                    m = API_ERROR.search(text)
                    if m:
                        errors[('delegate provider error', f'API error ({m.group(1)})')] += 1
                    details = result.get('details') or {}
                    if details.get('status') == 'failed' and re.search(r'\s0 tok\s', text):
                        errors[('delegate failed with 0 tokens', 'child consumed 0 tokens')] += 1
    except OSError as e:
        return {'valid': False, 'reasons': [f'file unreadable: {e}']}
    if roots == 0:
        errors[('missing Root assistant message_end', 'no Root assistant message_end')] += 1
    reasons = []
    for (kind, detail), count in errors.items():
        reasons.append(f'{kind} x{count}: {detail}')
    return {'valid': not reasons, 'reasons': reasons}


def main():
    if len(sys.argv) != 2:
        print('usage: runcheck.py <run.jsonl>', file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print('missing file', file=sys.stderr)
        return 2
    result = check(path)
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from native_results import children as native_children, valid_arm_metadata, model_key

API_ERROR = re.compile(r'API error \((5\d\d|429|403)\)')


def check(path, bundle=None):
    errors = Counter()
    roots = 0
    target_prefix = None
    native = False
    metadata_valid = False
    meta_path = Path(path).with_suffix('.meta.json')
    try:
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        metadata_valid = valid_arm_metadata(meta)
        if not isinstance(meta, dict):
            meta = {}
        task = meta.get('task', {})
        if not isinstance(task, dict):
            task = {}
        arm = meta.get('arm')
        native = isinstance(arm, dict) and arm.get('mode') == 'native'
        target = task.get('target')
        if target:
            target_prefix = str(target)[:7]
    except (OSError, ValueError, TypeError):
        pass
    if not metadata_valid:
        errors[('missing or invalid arm metadata', 'mode and Root model are required')] += 1
    target_references = 0
    events = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    errors[('incomplete transcript', 'malformed JSONL event')] += 1
                    continue
                if not isinstance(event, dict):
                    errors[('incomplete transcript', 'non-object JSONL event')] += 1
                    continue
                if native:
                    events.append(event)
                if event.get('type') == 'message_end' and (event.get('message') or {}).get('role') == 'assistant':
                    roots += 1
                    msg = event['message']
                    for item in msg.get('content') or []:
                        if isinstance(item, dict) and item.get('type') == 'toolCall':
                            if target_prefix and target_prefix in json.dumps(item.get('arguments', ''), ensure_ascii=False):
                                target_references += 1
                    if msg.get('stopReason') == 'error':
                        text = str(msg.get('errorMessage') or 'unknown error').replace('\n', ' ')[:150]
                        errors[('root stopReason=error', text)] += 1
                    if native and (not isinstance(msg.get('usage'), dict) or any(not isinstance(msg['usage'].get(k), (int, float)) or isinstance(msg['usage'].get(k), bool) or not math.isfinite(msg['usage'][k]) or msg['usage'][k] < 0 for k in ('input', 'output', 'cacheRead', 'cacheWrite'))):
                        errors[('missing Root usage', 'Root usage unavailable')] += 1
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
                if target_prefix and event.get('type') == 'tool_execution_end':
                    result = event.get('result') or {}
                    content = result.get('content') or []
                    text = ' '.join(str(x.get('text', '')) for x in content if isinstance(x, dict))
                    if target_prefix in text:
                        target_references += 1
    except OSError as e:
        return {'valid': False, 'reasons': [f'file unreadable: {e}']}
    reasons = []
    if roots == 0:
        errors[('missing Root assistant message_end', 'no Root assistant message_end')] += 1
    if native:
        child_rows, problems, _, _ = native_children(events, main=path, bundle=bundle)
        for child_row in child_rows:
            if model_key(child_row.get('model')) is None:
                problems.append('unknown child model')
        for problem in problems:
            errors[('native subagent', problem)] += 1
    exit_path = Path(path).with_suffix('.exit')
    if not exit_path.exists():
        errors[('pi exit', 'missing Pi exit evidence')] += 1
    elif exit_path.read_text(encoding='utf-8').strip() != '0':
        errors[('pi exit', 'nonzero Pi exit')] += 1
    if target_references:
        reasons.append(f'target commit referenced x{target_references}')
    for (kind, detail), count in errors.items():
        reasons.append(f'{kind} x{count}: {detail}')
    return {'valid': not reasons, 'reasons': reasons}


def main():
    if len(sys.argv) not in (2, 4) or (len(sys.argv) == 4 and sys.argv[2] != '--bundle'):
        print('usage: runcheck.py <run.jsonl> [--bundle <frozen-directory>]', file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print('missing file', file=sys.stderr)
        return 2
    result = check(path, bundle=sys.argv[3] if len(sys.argv) == 4 else None)
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    sys.exit(main())

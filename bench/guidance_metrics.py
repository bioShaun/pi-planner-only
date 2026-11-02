#!/usr/bin/env python3
"""Offline behavioral metrics for guidance benchmark runs.

reviews counts reviewer conclusions received by Root. reviews_verified counts
those followed by read/grep/find/ls or a non-sleep bash before the next worker
delegation; reviews_fix_unverified counts those followed by a worker delegation
without such verification. Reviews with neither event remain unclassified.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

FIELDS = (
    'id task arm rep eval_pass eval_valid wall_s delegations del_worker '
    'del_explorer del_validator del_reviewer del_unknown_role del_completed '
    'del_timed_out del_failed del_other validator_write_tasks '
    'redelegate_after_timeout dup_tool_calls dup_wait_cmds bash_sleep_cmds '
    'bash_sleep_seconds root_bash root_edit root_write reviews reviews_verified reviews_fix_unverified'
).split()
WRITE_TASK = re.compile(r'(?i)(创建|新建|生成|写出|写入|输出|produce|generate|create|write|save)\S{0,25}(文件|脚本|报告|汇总|file|script|report|summary|json|tsv)')
SLEEP = re.compile(r'sleep\s+(\d+(?:\.\d+)?)(s|m)?', re.I)
ROLES = ('worker', 'explorer', 'validator', 'reviewer')
NATIVE_ROLES = {'worker': 'worker', 'scout': 'explorer', 'reviewer': 'reviewer',
                'planner-validator': 'validator', 'oracle': 'validator'}


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def canonical(value):
    try:
        return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    except (TypeError, ValueError):
        return repr(value)


def parse_run(path):
    rid = path.stem
    row = {key: '' for key in FIELDS}
    row.update(id=rid, delegations=0, del_worker=0, del_explorer=0, del_validator=0,
               del_reviewer=0, del_unknown_role=0, del_completed=0, del_timed_out=0,
               del_failed=0, del_other=0, validator_write_tasks=0,
               redelegate_after_timeout=0, dup_tool_calls=0, dup_wait_cmds=0,
               bash_sleep_cmds=0, bash_sleep_seconds=0.0, root_bash=0, root_edit=0, root_write=0,
               reviews=0, reviews_verified=0, reviews_fix_unverified=0)
    row['validator_write_task_matches'] = []
    meta = read_json(path.parent / (rid + '.meta.json'))
    task = meta.get('task') if isinstance(meta.get('task'), dict) else {}
    arm = meta.get('arm') if isinstance(meta.get('arm'), dict) else {}
    for key, value in (('task', task.get('id')), ('arm', arm.get('name')), ('rep', meta.get('rep'))):
        if value is not None:
            row[key] = value
    ev = read_json(path.parent / (rid + '.eval.json'))
    for key in ('pass', 'valid'):
        if key in ev:
            row['eval_' + key] = ev[key]
    try:
        row['wall_s'] = (path.parent / (rid + '.wall')).read_text(encoding='utf-8').strip()
    except OSError:
        pass

    calls = []
    results = {}
    events = []
    try:
        with path.open(encoding='utf-8') as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                    if isinstance(event, dict) and event.get('type') == 'message_end':
                        events.append(event)
                except (ValueError, TypeError):
                    continue
    except OSError:
        return row

    timed_out_seen = False
    pending_reviews = 0
    native_calls = {}
    detached_runs = {}
    for event in events:
        msg = event.get('message')
        if not isinstance(msg, dict):
            continue
        role = msg.get('role')
        if role == 'custom' and msg.get('customType') == 'subagent-notify':
            content = msg.get('content', '')
            if isinstance(content, str) and re.match(r'^(?:Detached foreground task|Background task) completed:', content):
                for run_id, call_id in list(detached_runs.items()):
                    if re.search(r'/'+re.escape(run_id)+r'/run-\d+/session\.jsonl\b', content):
                        details = results[call_id]
                        details['status'] = 'completed'
                        if details['role'] == 'reviewer':
                            row['reviews'] += 1
                            pending_reviews += 1
                        del detached_runs[run_id]
            continue
        if role == 'toolResult' and msg.get('toolName') in ('delegate', 'subagent'):
            details = msg.get('details') if isinstance(msg.get('details'), dict) else {}
            call_id = msg.get('toolCallId')
            if msg.get('toolName') == 'subagent':
                call = native_calls.get(call_id)
                if not call:
                    continue
                entries = details.get('results') or []
                entry = entries[0] if entries and isinstance(entries[0], dict) else {}
                role_name = NATIVE_ROLES.get(call['arguments'].get('agent'), 'unknown')
                detached = entry.get('detached') is True or entry.get('exitCode') == -2 or bool(details.get('asyncId'))
                exit_code = entry.get('exitCode')
                status = 'other' if detached or exit_code is None else ('completed' if exit_code == 0 else 'failed')
                details = {'role': role_name, 'status': status}
                run_id = msg.get('details', {}).get('runId')
                if detached and isinstance(run_id, str):
                    detached_runs[run_id] = call_id
            if details.get('role') == 'reviewer' and details.get('status') == 'completed':
                row['reviews'] += 1
                pending_reviews += 1
            status = str(details.get('status', '')).lower()
            results[call_id] = details
            if 'timed_out' in status or 'timeout' in status:
                timed_out_seen = True
            continue
        if role != 'assistant':
            continue
        in_message = {}
        for item in msg.get('content') or []:
            if not isinstance(item, dict) or item.get('type') != 'toolCall':
                continue
            name = item.get('name')
            args = item.get('arguments') if isinstance(item.get('arguments'), dict) else {}
            key = (name, canonical(args))
            in_message[key] = in_message.get(key, 0) + 1
            command = args.get('command', '') if isinstance(args, dict) else ''
            if pending_reviews and (name in ('read', 'grep', 'find', 'ls') or
                                    (name == 'bash' and isinstance(command, str) and not re.search(r'\bsleep\b', command))):
                row['reviews_verified'] += pending_reviews
                pending_reviews = 0
            if name == 'bash':
                row['root_bash'] += 1
                if isinstance(command, str) and re.search(r'\bsleep\b', command):
                    row['bash_sleep_cmds'] += 1
                    for match in SLEEP.finditer(command):
                        seconds = float(match.group(1)) * (60 if (match.group(2) or '').lower() == 'm' else 1)
                        row['bash_sleep_seconds'] += seconds
            elif name == 'edit':
                row['root_edit'] += 1
            elif name == 'write':
                row['root_write'] += 1
            native = name == 'subagent' and isinstance(args.get('agent'), str) and 'action' not in args
            if name == 'delegate' or native:
                if pending_reviews and ((native and NATIVE_ROLES.get(args['agent']) == 'worker') or
                                        (name == 'delegate' and args.get('role') == 'worker')):
                    row['reviews_fix_unverified'] += pending_reviews
                    pending_reviews = 0
                if timed_out_seen:
                    row['redelegate_after_timeout'] += 1
                calls.append(item)
                if native:
                    native_calls[item.get('id')] = item
        for (name, args_key), count in in_message.items():
            extra = count - 1
            row['dup_tool_calls'] += extra
            if name == 'bash' and 'sleep' in args_key:
                row['dup_wait_cmds'] += extra

    for call in calls:
        row['delegations'] += 1
        details = results.get(call.get('id'))
        if not isinstance(details, dict):
            native_role = NATIVE_ROLES.get((call.get('arguments') or {}).get('agent')) if call.get('name') == 'subagent' else None
            row['del_' + native_role if native_role else 'del_unknown_role'] += 1
            row['del_other'] += 1
            continue
        role = details.get('role')
        role_key = 'del_' + role if role in ROLES else 'del_unknown_role'
        row[role_key] += 1
        status = str(details.get('status', '')).lower()
        status_key = 'del_timed_out' if ('timed_out' in status or 'timeout' in status) else 'del_' + status
        row[status_key if status_key in ('del_completed', 'del_timed_out', 'del_failed') else 'del_other'] += 1
        task_text = (call.get('arguments') or {}).get('task', '')
        if role == 'validator' and isinstance(task_text, str) and WRITE_TASK.search(task_text):
            row['validator_write_tasks'] += 1
            row['validator_write_task_matches'].append(task_text[:120])
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('runs', nargs='+')
    parser.add_argument('--json', dest='json_out')
    args = parser.parse_args()
    records = [parse_run(path) for folder in args.runs for path in sorted(Path(folder).glob('*.jsonl'))]
    writer = csv.DictWriter(sys.stdout, fieldnames=FIELDS, delimiter='\t', lineterminator='\n', extrasaction='ignore')
    writer.writeheader()
    writer.writerows(records)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())

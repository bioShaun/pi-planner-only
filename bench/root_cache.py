#!/usr/bin/env python3
"""Summarize Root prompt-cache usage from Pi session files."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re


def boundaries(value):
    try:
        values = [float(part) for part in value.split(',')]
        if len(values) != 2 or not 0 < values[0] < values[1] or values[1] == float('inf'):
            raise ValueError
        return values
    except ValueError:
        raise argparse.ArgumentTypeError('expected two increasing positive minute boundaries')


def metric():
    return {'turns': 0, 'input': 0, 'cache_read': 0, 'cache_write': 0,
            'hit_rate': None, 'cold_starts': 0, 'low_hit_turns': 0, 'cache_write_cost': 0,
            'missing_cache_write_cost': 0}


def low_hit_threshold(value):
    try:
        threshold = float(value)
        if not 0 <= threshold <= 1:
            raise ValueError
        return threshold
    except ValueError:
        raise argparse.ArgumentTypeError('expected a number between 0 and 1')


def add(stats, usage, low_hit):
    read = usage.get('cacheRead', 0) or 0
    write = usage.get('cacheWrite', 0) or 0
    input_tokens = usage.get('input', 0) or 0
    stats['turns'] += 1
    stats['input'] += input_tokens
    stats['cache_read'] += read
    stats['cache_write'] += write
    stats['cold_starts'] += write > read
    turn_total = input_tokens + read + write
    stats['low_hit_turns'] += bool(turn_total and read / turn_total < low_hit)
    cost = usage.get('cost')
    if isinstance(cost, dict) and isinstance(cost.get('cacheWrite'), (int, float)):
        stats['cache_write_cost'] += cost['cacheWrite']
    else:
        stats['missing_cache_write_cost'] += 1
    total = stats['input'] + stats['cache_read'] + stats['cache_write']
    stats['hit_rate'] = stats['cache_read'] / total if total else None


def provider_metrics(labels):
    return {'groups': {label: metric() for label in labels},
            'by_trigger': {trigger: {label: metric() for label in labels}
                           for trigger in ('toolResult', 'user', 'subagent', 'other')},
            'structural': metric()}


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        return None


def request_timestamp(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def analyze(path, report, args, labels):
    current_mode = None
    previous = None
    seen_assistant = False
    structural = False
    trigger = 'other'
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            kind = event.get('type')
            msg = event.get('message')
            msg = msg if isinstance(msg, dict) else {}
            if kind == 'message' and msg.get('role') == 'assistant':
                usage = msg.get('usage')
                if not isinstance(usage, dict):
                    continue
                now = timestamp(event.get('timestamp'))
                start = request_timestamp(msg.get('timestamp'))
                is_structural = not seen_assistant or structural
                if args.mode == 'any' or current_mode == args.mode:
                    report['turns'] += 1
                    key = f"{msg.get('provider') or 'unknown'}/{msg.get('model') or 'unknown'}"
                    if key not in report['by_provider']:
                        report['by_provider'][key] = provider_metrics(labels)
                    provider = report['by_provider'][key]
                    if is_structural or previous is None or (start is None and now is None):
                        add(report['structural'], usage, args.low_hit)
                        add(provider['structural'], usage, args.low_hit)
                    else:
                        approximate = start is None
                        try:
                            gap = ((start if start is not None else now) - previous).total_seconds() / 60
                        except TypeError:
                            gap = 0
                            approximate = True
                        if gap < 0:
                            gap = 0
                            approximate = True
                        report['approx_gaps'] += approximate
                        label = labels[0] if gap < args.gap_minutes[0] else labels[1] if gap < args.gap_minutes[1] else labels[2]
                        add(report['groups'][label], usage, args.low_hit)
                        add(report['by_trigger'][trigger][label], usage, args.low_hit)
                        add(provider['groups'][label], usage, args.low_hit)
                        add(provider['by_trigger'][trigger][label], usage, args.low_hit)
                previous = now
                seen_assistant = True
                structural = False
                trigger = 'other'
                continue
            if kind == 'custom' and event.get('customType') == 'planner-only-mode':
                data = event.get('data')
                if isinstance(data, dict):
                    current_mode = data.get('mode')
            if kind in ('model_change', 'thinking_level_change', 'compaction'):
                structural = True
            if kind == 'message' and msg.get('role') in ('user', 'toolResult'):
                trigger = msg['role']
            elif kind == 'custom_message' and str(event.get('customType', '')).startswith('subagent'):
                trigger = 'subagent'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+')
    parser.add_argument('--mode', choices=('native', 'lite', 'off', 'any'), default='native')
    parser.add_argument('--gap-minutes', type=boundaries, default=boundaries('5,60'))
    parser.add_argument('--low-hit', type=low_hit_threshold, default=0.5)
    parser.add_argument('--json', dest='json_out')
    args = parser.parse_args()
    a, b = (f'{n:g}' for n in args.gap_minutes)
    labels = (f'<{a}m', f'{a}-{b}m', f'>={b}m')
    paths = set()
    skipped_children = set()
    for name in args.paths:
        path = Path(name)
        if not path.is_dir():
            if path.is_file():
                paths.add(path.resolve())
            continue
        for candidate in path.rglob('*.jsonl'):
            if not candidate.is_file() or 'subagent-artifacts' in candidate.parts:
                continue
            resolved = candidate.resolve()
            if any(part == 'forks' or re.fullmatch(r'run-[0-9]+', part) for part in candidate.parts):
                skipped_children.add(resolved)
            else:
                paths.add(resolved)
    skipped_children.difference_update(paths)
    report = {'files': len(paths), 'skipped_child_sessions': len(skipped_children),
              'turns': 0, 'approx_gaps': 0, 'groups': {label: metric() for label in labels},
              'by_trigger': {trigger: {label: metric() for label in labels}
                             for trigger in ('toolResult', 'user', 'subagent', 'other')},
              'structural': metric(), 'by_provider': {},
              'params': {'mode': args.mode, 'gap_minutes': args.gap_minutes, 'low_hit': args.low_hit}}
    for path in sorted(paths):
        analyze(path, report, args, labels)
    print('Session branches follow file order.')
    if report['approx_gaps']:
        print('Some gaps are approximate.')
    print(f"Files: {report['files']}; turns: {report['turns']}; approx_gaps={report['approx_gaps']}; "
          f"skipped_child_sessions={report['skipped_child_sessions']}")
    if not report['turns']:
        print('No matching turns.')
    def show(label, stats):
        rate = stats['hit_rate']
        rate_text = f'{rate:.2%}' if rate is not None else 'n/a'
        print(f"{label}: turns={stats['turns']} hit_rate={rate_text} cold_starts={stats['cold_starts']} "
              f"cache_write_cost={stats['cache_write_cost']:.6f} missing_cost={stats['missing_cache_write_cost']} "
              f"low_hit={stats['low_hit_turns']}")
    show('structural', report['structural'])
    for label, stats in report['groups'].items():
        show(label, stats)
    for trigger, groups in report['by_trigger'].items():
        for label, stats in groups.items():
            show(f'{trigger} / {label}', stats)
    for key, provider in sorted(report['by_provider'].items()):
        print(f'== {key} ==')
        show('structural', provider['structural'])
        for label, stats in provider['groups'].items():
            show(label, stats)
        for label, stats in provider['by_trigger']['subagent'].items():
            show(f'subagent / {label}', stats)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

"""Account for installed pi-subagents tool results without trusting aggregate usage."""
import math
import hashlib
import json
import shutil
import sys
import re
from pathlib import Path

FIELDS = ("input", "output", "cacheRead", "cacheWrite")
TOOLS = ("subagent", "bg_wait")
REJECTED_DUPLICATE_MARKER = "a subagent call is already in progress"
MODEL_KEYS = set(json.loads((Path(__file__).resolve().parent / 'prices.json').read_text())['models'])
REASONING_SUFFIXES = {'low', 'medium', 'high', 'minimal', 'none'}


def model_key(model):
    if not isinstance(model, str):
        return None
    if model in MODEL_KEYS:
        return model
    if ':' in model:
        base, suffix = model.rsplit(':', 1)
        if suffix in REASONING_SUFFIXES and base in MODEL_KEYS:
            return base
    return None


def _run_id(value):
    return isinstance(value, str) and bool(value.strip()) and not any(char.isspace() for char in value)


def valid_arm_metadata(meta):
    arm = meta.get("arm") if isinstance(meta, dict) else None
    if not isinstance(arm, dict) or arm.get("mode") not in ("direct", "lite", "native"):
        return False
    model = arm.get("rootModel") or arm.get("root_model")
    return isinstance(model, str) and bool(model.strip())


def has_nested_work(child):
    # pi-subagents attaches nested run summaries to SingleResult.children; older
    # projections can also expose the child's subagent calls in messages.
    if child.get("children"):
        return True
    for message in child.get("messages") or []:
        if not isinstance(message, dict):
            continue
        if message.get("role") == "toolResult" and message.get("toolName") in TOOLS:
            return True
        if message.get("role") == "assistant" and any(isinstance(part, dict) and part.get("type") == "toolCall" and part.get("name") in TOOLS for part in message.get("content") or []):
            return True
    return False


def is_rejected_duplicate(event, result, details):
    """True when pi-subagents refused a second same-turn call without launching work.

    The transport can flatten the rejection to ``details: {}`` with event-level
    ``isError`` (see T3-native-pds-1); require the marker text plus the absence of
    any launched-run evidence so genuine accounting gaps still fail.
    """
    if event.get("isError") is not True:
        return False
    content = result.get("content") or []
    text = " ".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
    if REJECTED_DUPLICATE_MARKER not in text:
        return False
    if not isinstance(details, dict):
        return False
    return not any(key in details for key in ("runId", "results", "asyncId"))


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _notifications(events):
    notices = {}
    for event in events:
        message = event.get('message') or {}
        if event.get('type') != 'message_end' or message.get('customType') != 'subagent-notify':
            continue
        for notice in (message.get('details') or {}).get('runs') or []:
            run_id = notice.get('runId')
            if not _run_id(run_id) or not isinstance(notice.get('asyncDir'), str) or notice.get('status') != 'completed':
                raise ValueError('invalid async notification')
            if run_id in notices and notices[run_id] != notice:
                raise ValueError('conflicting async notification')
            notices[run_id] = notice
    return notices


def _references(events, statuses=None):
    refs = {}
    async_launches = set()
    for event in events:
        details = (event.get('result') or {}).get('details') or {}
        if event.get('type') == 'tool_execution_end' and event.get('toolName') == 'subagent' and details.get('asyncId'):
            run_id = details['asyncId']
            if not _run_id(run_id) or details.get('runId') != run_id or run_id in async_launches or details.get('mode') != 'single':
                raise ValueError('invalid or duplicate async launch')
            async_launches.add(run_id)
    for run_id, notice in _notifications(events).items():
        launch = next((e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'subagent' and ((e.get('result') or {}).get('details') or {}).get('asyncId') == run_id), None)
        if not launch or statuses is None or run_id not in statuses:
            raise ValueError('unbound async notification')
        launch_details = launch['result']['details']
        status = statuses[run_id]
        steps = status.get('steps') or []
        terminal = status.get('processTerminal') or {}
        if (launch_details.get('asyncDir') != notice.get('asyncDir') or status.get('runId') != run_id
                or status.get('toolCallId') != launch.get('toolCallId') or status.get('state') != 'complete'
                or terminal.get('runId') != run_id or terminal.get('state') != 'observed'
                or not terminal.get('instances') or any(x.get('exitCode') != 0 or x.get('signal') for x in terminal['instances'])
                or len(steps) != 1 or steps[0].get('agent') != notice.get('agent')
                or steps[0].get('status') != 'complete' or steps[0].get('exitCode') != 0
                or steps[0].get('sessionFile') != notice.get('sessionValue')):
            raise ValueError('conflicting async notification status')
        transcript = steps[0].get('transcriptPath')
        if not isinstance(transcript, str) or not transcript.endswith('_transcript.jsonl'):
            raise ValueError('missing async notification transcript')
        paths = {'transcriptPath': transcript, 'metadataPath': transcript[:-len('_transcript.jsonl')] + '_meta.json'}
        refs[(run_id, 0)] = (paths, steps[0]['agent'])
    for event in events:
        if event.get('type') != 'tool_execution_end' or event.get('toolName') not in TOOLS:
            continue
        details = (event.get('result') or {}).get('details') or {}
        groups = [(details.get('runId'), details.get('results') or [])] if event.get('toolName') == 'subagent' else []
        for completion in details.get('completions') or []:
            if completion.get('runId') not in async_launches or completion.get('state') != 'complete' or completion.get('success') is not True or completion.get('mode') != 'single' or not isinstance(completion.get('results'), list) or len(completion['results']) != 1:
                raise ValueError('unbound or unsuccessful async completion')
            groups.append((completion['runId'], completion.get('results') or []))
        for declared_run_id, group in groups:
            if declared_run_id is not None and not _run_id(declared_run_id):
                raise ValueError('invalid parent runId')
            for position, row in enumerate(group):
                if not isinstance(row, dict):
                    raise ValueError('malformed child result')
                child_run_id = row.get('runId')
                if 'runId' in row and not _run_id(child_run_id):
                    raise ValueError('invalid child runId')
                if child_run_id and declared_run_id and child_run_id != declared_run_id:
                    raise ValueError('conflicting child runId')
                run_id = child_run_id or declared_run_id
                if not _run_id(run_id):
                    raise ValueError('missing child runId')
                index = row.get('index', position)
                if not isinstance(index, int) or isinstance(index, bool) or index < 0:
                    raise ValueError('invalid child index')
                agent = row.get('agent')
                if not isinstance(agent, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', agent):
                    raise ValueError('invalid child agent')
                key = (run_id, index)
                paths = row.get('artifactPaths') or {}
                if not isinstance(paths, dict) or any(not isinstance(paths.get(field), str) or not paths[field].strip() for field in ('metadataPath', 'transcriptPath')):
                    raise ValueError('missing or malformed child artifact references')
                if key in refs and refs[key] != (paths, agent):
                    raise ValueError('conflicting child artifact references')
                refs[key] = (paths, agent)
    return refs


def _events(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def _terminal(meta, transcript, run_id, index, agent):
    if meta.get('runId') != run_id or meta.get('index', index) != index:
        raise ValueError('child runId/index mismatch')
    if meta.get('agent') != agent:
        raise ValueError('child terminal agent mismatch')
    if meta.get('exitCode') != 0 or any(meta.get(k) for k in ('error', 'detached', 'interrupted', 'timedOut', 'stopped', 'children')):
        raise ValueError('child terminal failed or unfinished')
    usage = meta.get('usage')
    if not isinstance(usage, dict) or any(not isinstance(usage.get(k), (int, float)) or isinstance(usage[k], bool) or not math.isfinite(usage[k]) or usage[k] < 0 for k in FIELDS):
        raise ValueError('child terminal usage invalid')
    key = model_key(meta.get('model'))
    if key is None:
        raise ValueError('child terminal model missing or unknown')
    actual = {k: 0 for k in FIELDS}
    pending = set()
    messages = 0
    final_reason = None
    for event in _events(transcript):
        if event.get('runId') != run_id or event.get('childIndex') != index:
            raise ValueError('child transcript runId/index mismatch')
        if meta.get('agent') != event.get('agent'):
            raise ValueError('child transcript agent mismatch')
        message = event.get('message') or {}
        if message.get('role') == 'toolResult' and message.get('toolName') in (*TOOLS, 'delegate'):
            raise ValueError('nested child usage cannot be fully priced')
        if message.get('role') == 'assistant' and any(isinstance(part, dict) and part.get('type') == 'toolCall' and part.get('name') in (*TOOLS, 'delegate') for part in message.get('content') or []):
            raise ValueError('nested child usage cannot be fully priced')
        if event.get('recordType') == 'message' and message.get('role') == 'assistant':
            if f"{message.get('provider')}/{message.get('model')}" != key:
                raise ValueError('child transcript model mismatch')
            if message.get('stopReason') == 'error':
                raise ValueError('child assistant error')
            final_reason = message.get('stopReason')
            if not isinstance(message.get('usage'), dict) or any(not isinstance(message['usage'].get(k), (int, float)) or isinstance(message['usage'][k], bool) or not math.isfinite(message['usage'][k]) or message['usage'][k] < 0 for k in FIELDS):
                raise ValueError('child transcript usage invalid')
            messages += 1
            for k in FIELDS:
                actual[k] += message['usage'][k]
        if event.get('recordType') == 'tool_start':
            pending.add(event.get('toolCallId'))
            if event.get('toolName') in TOOLS or event.get('toolName') == 'delegate':
                raise ValueError('nested child usage cannot be fully priced')
        if event.get('recordType') == 'tool_end':
            pending.discard(event.get('toolCallId'))
    if not messages or final_reason != 'stop' or pending or any(actual[k] != usage[k] for k in FIELDS):
        raise ValueError('child transcript incomplete or usage mismatch')
    return {'runId': run_id, 'index': index, 'model': meta['model'], 'usage': usage,
            'exitCode': 0, 'agent': meta.get('agent')}


def collect_bundle(main, source, destination):
    """Copy declared terminal artifacts, validate the copies, and seal a replayable bundle."""
    main, source, destination = Path(main), Path(source) if source is not None else None, Path(destination)
    if destination.exists():
        raise ValueError('evidence bundle already exists')
    events = _events(main)
    notices = _notifications(events)
    if source is not None and len(notices) > 1:
        raise ValueError('source override supports only one async notification')
    statuses = {}
    for run_id, notice in notices.items():
        original = source / 'status.json' if source is not None else Path(notice['asyncDir']) / 'status.json'
        statuses[run_id] = json.loads(original.read_text())
    refs = _references(events, statuses)
    if not refs:
        return False
    destination.mkdir(parents=True)
    manifest = {'main_sha256': _digest(main), 'children': [], 'statuses': []}
    try:
        for run_id, notice in notices.items():
            original = source / 'status.json' if source is not None else Path(notice['asyncDir']) / 'status.json'
            target = destination / (run_id + '_status.json')
            before = _digest(original)
            shutil.copyfile(original, target)
            if before != _digest(original) or before != _digest(target) or json.loads(target.read_text()) != statuses[run_id]:
                raise ValueError('async status changed during collection')
            manifest['statuses'].append({'runId': run_id, 'name': target.name, 'sha256': before})
        for (run_id, index), (paths, agent) in refs.items():
            files = {}
            for kind, field, suffix in (('meta', 'metadataPath', '_meta.json'), ('transcript', 'transcriptPath', '_transcript.jsonl')):
                declared = paths.get(field)
                name = Path(declared).name if isinstance(declared, str) else ''
                if name not in (f'{run_id}_{agent}_{index}{suffix}', f'{run_id}_{agent}{suffix}' if index == 0 else ''):
                    raise ValueError('missing or unbound child artifact agent/path')
                original = source / name if source is not None else Path(declared)
                if not original.is_file():
                    raise ValueError(f'missing child artifact: {name}')
                before = _digest(original)
                target = destination / name
                shutil.copyfile(original, target)
                if before != _digest(original) or before != _digest(target):
                    raise ValueError('child artifact changed during collection')
                files[kind] = {'name': name, 'sha256': before, 'declared': declared}
            terminal = _terminal(json.loads((destination / files['meta']['name']).read_text()), destination / files['transcript']['name'], run_id, index, agent)
            if run_id in statuses and model_key(statuses[run_id]['steps'][0].get('model')) != model_key(terminal['model']):
                raise ValueError('async status model mismatch')
            manifest['children'].append({'runId': run_id, 'index': index, 'files': files})
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    except Exception:
        (destination / 'COLLECTION_FAILED').write_text('Evidence collection failed; inspect source artifacts and rerun with a fresh destination.\n')
        raise
    return True


def _bundle(main, events, bundle):
    bundle = Path(bundle)
    manifest = json.loads((bundle / 'manifest.json').read_text())
    if manifest.get('main_sha256') != _digest(Path(main)):
        raise ValueError('evidence bundle main transcript digest mismatch')
    statuses = {}
    for record in manifest.get('statuses', []):
        run_id = record['runId']
        if run_id in statuses or record['name'] != run_id + '_status.json' or _digest(bundle / record['name']) != record['sha256']:
            raise ValueError('async status missing, tampered, or duplicate')
        statuses[run_id] = json.loads((bundle / record['name']).read_text())
    if set(statuses) != set(_notifications(events)):
        raise ValueError('missing async status')
    refs = _references(events, statuses)
    rows = {}
    if len(manifest.get('children', [])) != len(refs):
        raise ValueError('evidence bundle missing or duplicate children')
    for record in manifest['children']:
        key = (record['runId'], record['index'])
        if key not in refs or key in rows:
            raise ValueError('evidence bundle runId/index mismatch or duplicate')
        paths, agent = refs[key]
        files = record['files']
        for kind, field, suffix in (('meta', 'metadataPath', '_meta.json'), ('transcript', 'transcriptPath', '_transcript.jsonl')):
            info = files[kind]
            name = Path(paths.get(field) or '').name
            if name not in (f'{key[0]}_{agent}_{key[1]}{suffix}', f'{key[0]}_{agent}{suffix}' if key[1] == 0 else '') or info['name'] != name or info['declared'] != paths.get(field) or _digest(bundle / name) != info['sha256']:
                raise ValueError('child artifact missing, tampered, or unbound')
        rows[key] = _terminal(json.loads((bundle / files['meta']['name']).read_text()), bundle / files['transcript']['name'], *key, agent)
        if key[0] in statuses and model_key(statuses[key[0]]['steps'][0].get('model')) != model_key(rows[key]['model']):
            raise ValueError('async status model mismatch')
    return rows


def children(events, *, main=None, bundle=None):
    """Return (unique children, problems, launches, rejected duplicates)."""
    found = {}
    problems = []
    launches = 0
    rejected_duplicates = 0
    starts = set()
    ends = set()
    start_args = {e.get('toolCallId'): e.get('args') for e in events
                  if e.get('type') == 'tool_execution_start' and e.get('toolName') == 'subagent' and e.get('toolCallId')}
    launched_ids = set()
    launch_calls = {}
    for event in events:
        details = (event.get('result') or {}).get('details')
        if event.get('type') == 'tool_execution_end' and event.get('toolName') == 'subagent' and isinstance(details, dict) and details.get('asyncId'):
            launched_ids.add(details['asyncId'])
            launch_calls[details['asyncId']] = event.get('toolCallId')
    terminals = {}
    if bundle is not None:
        try:
            terminals = _bundle(main, events, bundle)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            problems.append(f'invalid native terminal evidence: {exc}')
    for event_number, event in enumerate(events):
        if event.get("toolName") in TOOLS and event.get("type") == "tool_execution_start":
            starts.add(event.get("toolCallId") or ("unidentified", event_number))
        if event.get("type") != "tool_execution_end" or event.get("toolName") not in TOOLS:
            continue
        if event.get("toolCallId"):
            ends.add(event["toolCallId"])
        result = event.get("result") or {}
        raw_details = result.get("details")
        details = raw_details if isinstance(raw_details, dict) else {}
        mode = details.get("mode")
        rows = details.get("results")
        args = start_args.get(event.get('toolCallId')) if event.get('toolName') == 'subagent' else None
        action = args.get('action') if isinstance(args, dict) else None
        if action in ('status', 'list'):
            target = args.get('id')
            if (target and target not in launched_ids) or (details.get('runId') and details['runId'] != target) or (details.get('toolCallId') and details['toolCallId'] != launch_calls.get(target)) or details.get('asyncId') or rows:
                problems.append('conflicting status observation')
            continue
        if action and action != 'steer':
            problems.append('unsupported subagent action')
            continue
        if action == 'steer' and (args.get('id') not in launched_ids or mode != 'management' or rows or details.get('asyncId')):
            problems.append('conflicting subagent steering')
            continue
        if event.get('toolName') == 'subagent' and mode == 'management' and event.get('toolCallId') and not isinstance(args, dict):
            problems.append('subagent management call missing start')
            continue
        if not isinstance(rows, list):
            if is_rejected_duplicate(event, result, raw_details):
                rejected_duplicates += 1
                continue
            problems.append("subagent result has no child results array")
            continue
        if event.get("toolName") == "subagent" and mode in ("single", "parallel", "chain", "workflow") and (rows or details.get('asyncId')):
            launches += 1
        if (event.get("toolName") == "subagent" and not rows and not details.get("asyncId")
                and (mode != "management" or event.get("isError") is True)):
            problems.append("launched subagent has no terminal child results")
        if result.get("isError"):
            problems.append("subagent tool returned isError")
        if any("API error (" in str(item.get("text", "")) for item in result.get("content") or [] if isinstance(item, dict)):
            problems.append("subagent provider error")
        if details.get("asyncId") or details.get("background") or details.get("wait"):
            if not any(key[0] == details.get('asyncId') for key in terminals):
                problems.append("nonterminal/asynchronous subagent result")
        groups = [(details.get("runId"), rows)]
        for completion in details.get("completions") or []:
            if completion.get("success") is False or completion.get("state") not in (None, "complete", "completed"):
                problems.append("failed or nonterminal async completion")
            groups.append((completion.get("runId"), completion.get("results") or []))
        for run_id, group in groups:
            for index, child in enumerate(group):
                if not isinstance(child, dict):
                    problems.append("malformed child result")
                    continue
                actual_index = child.get('index', index)
                if has_nested_work(child):
                    problems.append('nested child usage cannot be fully priced')
                if child.get('runId') and run_id and child['runId'] != run_id:
                    problems.append('conflicting child runId')
                actual_run_id = child.get('runId') or run_id
                terminal = terminals.get((actual_run_id, actual_index))
                if terminal:
                    if child.get('agent') != terminal.get('agent'):
                        problems.append('conflicting child agent')
                    partial = child.get('usage')
                    if not isinstance(partial, dict) or any(not isinstance(partial.get(k), (int, float)) or isinstance(partial[k], bool) or not math.isfinite(partial[k]) or partial[k] < 0 for k in FIELDS):
                        problems.append('child usage missing or malformed')
                    async_completion = event.get('toolName') == 'bg_wait' and child.get('success') is True
                    if (async_completion and (child.get('exitCode') not in (None, 0) or child.get('detached'))) or (not async_completion and child.get('exitCode') not in (0, -2)) or child.get('error') or child.get('interrupted') or child.get('timedOut') or child.get('stopped') or (child.get('exitCode') == -2 and child.get('detached') is not True):
                        problems.append('failed child result')
                    if child.get('model') != terminal['model'] or (isinstance(partial, dict) and any(isinstance(partial.get(k), (int, float)) and (partial[k] != terminal['usage'][k] if async_completion else partial[k] > terminal['usage'][k]) for k in FIELDS)):
                        problems.append('conflicting child partial and terminal')
                    if child.get('exitCode') == 0 and not child.get('detached') and any(child.get(k) != terminal.get(k) for k in ('model', 'usage', 'exitCode')):
                        problems.append('conflicting duplicate child result')
                    child = terminal
                identity = (("run-index", run_id or child.get('runId'), actual_index) if (run_id or child.get('runId')) else
                            ("session", child["sessionFile"]) if child.get("sessionFile") else
                            ("event-index", event_number, index))
                if identity in found:
                    if found[identity] != child:
                        problems.append("conflicting duplicate child result")
                    continue
                found[identity] = child
                if has_nested_work(child):
                    problems.append("nested child usage cannot be fully priced")
                if child.get("exitCode") != 0 or child.get("error"):
                    problems.append("failed child result")
                if child.get("interrupted") or child.get("detached") or child.get("timedOut") or child.get("stopped"):
                    problems.append("nonterminal child result")
                usage = child.get("usage")
                if not isinstance(usage, dict) or any(
                    not isinstance(usage.get(k), (int, float)) or isinstance(usage.get(k), bool) or not math.isfinite(usage[k]) or usage[k] < 0 for k in FIELDS
                ):
                    problems.append("child usage missing or malformed")
                if not child.get("model"):
                    problems.append("child model missing")
        total = details.get("totalCost")
        if isinstance(total, dict) and isinstance(total.get("costUsd"), (int, float)):
            own_costs = [row.get("usage", {}).get("cost") for row in rows if isinstance(row, dict) and isinstance(row.get("usage"), dict)]
            if len(own_costs) == len(rows) and all(isinstance(cost, (int, float)) and math.isfinite(cost) for cost in own_costs) and total["costUsd"] > sum(own_costs) + 1e-8:
                problems.append("nested child usage cannot be fully priced")
    if starts - ends:
        problems.append("tool call has no terminal result")
    try:
        notices = _notifications(events)
    except (ValueError, TypeError, AttributeError) as exc:
        problems.append(f'invalid async notification: {exc}')
        notices = {}
    for run_id in notices:
        key = ('run-index', run_id, 0)
        if key not in found and (run_id, 0) in terminals:
            found[key] = terminals[(run_id, 0)]
    return list(found.values()), sorted(set(problems)), launches, rejected_duplicates


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] != 'collect':
        print('usage: native_results.py collect <main.jsonl> <new-bundle-dir>', file=sys.stderr)
        sys.exit(2)
    try:
        collect_bundle(sys.argv[2], None, sys.argv[3])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'native evidence collection failed: {exc}', file=sys.stderr)
        sys.exit(1)

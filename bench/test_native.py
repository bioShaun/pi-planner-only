#!/usr/bin/env python3
"""Offline fault injection for native benchmark routing and accounting."""
import json
import hashlib
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_results import children
from runcheck import check
from summarize import parse_run

BENCH = Path(__file__).resolve().parent
MODEL = 'tcuni/gpt-6-luna'
ROOT_MODEL = 'cline/cline-pass/deepseek-v4.1-flash'
ROOT_USAGE = {'input': 10, 'output': 2, 'cacheRead': 0, 'cacheWrite': 0}


def tool(mode, rows, **options):
    return {'type': 'tool_execution_end', 'toolName': options.pop('toolName', 'subagent'),
            'result': {'content': [], 'details': {'mode': mode, 'results': rows, **options}}}


def child(**changes):
    return {'index': 0, 'agent': 'worker', 'exitCode': 0, 'model': MODEL,
            'usage': {'input': 100, 'output': 10, 'cacheRead': 0, 'cacheWrite': 0}, **changes}


class NativeBenchTest(unittest.TestCase):
    def test_archived_detached_terminal_replay(self):
        archived = Path('/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926/runs/T2b-native-opus-calibration-1.jsonl')
        evidence = BENCH.parent / '.scratch/lite-cross-task-next-20260926/execution/child-evidence/T2b-native-opus-calibration-1'
        if not archived.exists() or not evidence.exists():
            self.skipTest('archived T2b evidence unavailable')
        from native_results import collect_bundle
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            bundle = Path(directory) / 'bundle'
            collect_bundle(archived, evidence, bundle)
            self.assertTrue(check(archived, bundle=bundle)['valid'])
            rec, unknown = parse_run(archived.parent, archived.stem, 'actual', bundle=bundle)
            self.assertEqual(unknown, [])
            self.assertAlmostEqual(rec['total_cost'], 1.88898237, places=8)

            manifest_path = bundle / 'manifest.json'
            original = manifest_path.read_text()
            manifest = json.loads(original)
            self.assertEqual(len(manifest['children']), 2)
            detached = next(row for row in manifest['children'] if row['runId'].startswith('0669'))
            metadata_path = bundle / detached['files']['meta']['name']
            transcript_path = bundle / detached['files']['transcript']['name']
            original_meta = metadata_path.read_text()
            original_transcript = transcript_path.read_text()

            def seal(path, kind):
                detached['files'][kind]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                manifest_path.write_text(json.dumps(manifest))

            def rejected():
                self.assertFalse(check(archived, bundle=bundle)['valid'])
                self.assertIsNone(parse_run(archived.parent, archived.stem, 'actual', bundle=bundle)[0]['total_cost'])

            for label, mutate in (
                ('runId', lambda m: m.update(runId='wrong')),
                ('index', lambda m: m.update(index=1)),
                ('failed', lambda m: m.update(exitCode=1)),
                ('unknown model', lambda m: m.update(model='invalid/unknown')),
                ('invalid usage', lambda m: m['usage'].update(output=-1)),
                ('unfinished', lambda m: m.update(detached=True)),
                ('nested', lambda m: m.update(children=[{'usage': {}}])),
            ):
                with self.subTest(case=label):
                    metadata_path.write_text(original_meta)
                    manifest = json.loads(original)
                    detached = next(row for row in manifest['children'] if row['runId'].startswith('0669'))
                    meta = json.loads(original_meta)
                    mutate(meta)
                    metadata_path.write_text(json.dumps(meta))
                    seal(metadata_path, 'meta')
                    rejected()
            metadata_path.write_text(original_meta)
            manifest_path.write_text(original)
            with self.subTest(case='missing artifact'):
                metadata_path.rename(bundle / 'held-meta')
                rejected()
                (bundle / 'held-meta').rename(metadata_path)
            with self.subTest(case='tampered artifact'):
                metadata_path.write_text(original_meta + ' ')
                rejected()
                metadata_path.write_text(original_meta)
            with self.subTest(case='duplicate terminal'):
                manifest['children'].append(deepcopy(detached))
                manifest_path.write_text(json.dumps(manifest))
                rejected()
                manifest_path.write_text(original)
            with self.subTest(case='nested transcript'):
                transcript_path.write_text(original_transcript + json.dumps({'recordType': 'tool_start', 'runId': detached['runId'], 'childIndex': 0, 'toolName': 'subagent'}) + '\n')
                seal(transcript_path, 'transcript')
                rejected()
                transcript_path.write_text(original_transcript)
                manifest_path.write_text(original)

            with self.subTest(case='collection missing source'):
                source = Path(directory) / 'source'
                source.mkdir()
                with self.assertRaisesRegex(ValueError, 'missing child artifact'):
                    collect_bundle(archived, source, Path(directory) / 'missing-bundle')

            with self.subTest(case='CLI collection from declared paths'):
                process = subprocess.run([sys.executable, str(BENCH / 'native_results.py'), 'collect', str(archived), str(Path(directory) / 'cli-bundle')], capture_output=True, text=True)
                self.assertEqual(process.returncode, 0, process.stderr)

    def test_parallel_same_run_distinct_indices(self):
        from unittest.mock import patch
        terminals = {('parallel-run', n): child(index=n, runId='parallel-run') for n in (0, 1)}
        with patch('native_results._bundle', return_value=terminals):
            rows, problems, _, _ = children([tool('parallel', [child(index=0), child(index=1)], runId='parallel-run')], main='unused', bundle='unused')
        self.assertEqual((len(rows), problems), (2, []))

    def test_collector_rejects_unbound_child_identity_and_artifacts(self):
        from native_results import collect_bundle
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            path = root / 'T3-native-pds-1.jsonl'
            cases = [
                ('missing runId', {}, child()),
                ('empty runId', {'runId': ''}, child()),
                ('nonstring runId', {'runId': 12}, child()),
                ('whitespace runId', {'runId': '  '}, child()),
                ('conflicting runId', {'runId': 'parent'}, child(runId='different')),
                ('missing artifact refs', {'runId': 'parent'}, child()),
                ('empty artifact refs', {'runId': 'parent'}, child(artifactPaths={})),
                ('malformed artifact refs', {'runId': 'parent'}, child(artifactPaths={'metadataPath': 123, 'transcriptPath': []})),
            ]
            for label, options, row in cases:
                with self.subTest(case=label):
                    path.write_text(json.dumps(tool('single', [row], **options)) + '\n')
                    with self.assertRaises(ValueError):
                        collect_bundle(path, root, root / label.replace(' ', '-'))
            path.write_text('\n'.join(map(json.dumps, [{'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, tool('single', [child()])])) + '\n')
            path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            path.with_suffix('.exit').write_text('0\n')
            self.assertTrue(check(path)['valid'])
            failed_cli = subprocess.run([sys.executable, str(BENCH / 'native_results.py'), 'collect', str(path), str(root / 'rejected-cli')], capture_output=True, text=True)
            self.assertEqual(failed_cli.returncode, 1)
            self.assertIn('runId', failed_cli.stderr)
            path.write_text(json.dumps(tool('single', [child(runId='child-only')])) + '\n')
            with self.assertRaisesRegex(ValueError, 'artifact'):
                collect_bundle(path, root, root / 'child-only')

    def test_model_key_gate_and_pricing_agree_on_suffix(self):
        from summarize import model_key
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            path = root / 'T3-native-pds-1.jsonl'
            path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            path.with_suffix('.exit').write_text('0\n')
            for model, accepted in ((MODEL, True), (MODEL + ':medium', True), (MODEL + ':bogus', False), ('invalid/unknown:medium', False)):
                with self.subTest(model=model):
                    path.write_text('\n'.join(map(json.dumps, [{'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, tool('single', [child(model=model)], runId='parent')])) + '\n')
                    self.assertEqual(check(path)['valid'], accepted)
                    record, unknown = parse_run(root, path.stem, 'actual')
                    self.assertEqual(record['total_cost'] is not None, accepted)
                    self.assertEqual(bool(unknown), not accepted)
                    self.assertEqual(model_key(model) is not None, accepted)

    def test_nonworker_declared_artifacts_collect(self):
        from native_results import collect_bundle
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            run_id = 'scout-run'
            prefix = f'{run_id}_scout_0'
            meta = {'runId': run_id, 'agent': 'scout', 'exitCode': 0, 'model': MODEL, 'usage': child()['usage']}
            (source / (prefix + '_meta.json')).write_text(json.dumps(meta))
            transcript = {'recordType': 'message', 'runId': run_id, 'childIndex': 0, 'agent': 'scout', 'message': {'role': 'assistant', 'provider': 'tcuni', 'model': 'gpt-6-luna', 'stopReason': 'stop', 'usage': child()['usage']}}
            (source / (prefix + '_transcript.jsonl')).write_text(json.dumps(transcript) + '\n')
            row = child(agent='scout', exitCode=-2, detached=True, usage={'input': 50, 'output': 5, 'cacheRead': 0, 'cacheWrite': 0}, artifactPaths={'metadataPath': str(source / (prefix + '_meta.json')), 'transcriptPath': str(source / (prefix + '_transcript.jsonl'))})
            path = root / 'T3-native-pds-1.jsonl'
            path.write_text('\n'.join(map(json.dumps, [{'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, tool('single', [row], runId=run_id), {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE, 'content': [{'type': 'text', 'text': 'supervisor reply'}]}}, tool('management', [], toolName='bg_wait')])) + '\n')
            path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            path.with_suffix('.exit').write_text('0\n')
            bundle = root / 'evidence'
            self.assertTrue(collect_bundle(path, source, bundle))
            self.assertTrue(check(path, bundle=bundle)['valid'])
            record, unknown = parse_run(root, path.stem, 'actual', bundle=bundle)
            self.assertEqual(unknown, [])
            self.assertEqual(record['children'], 1)
            self.assertAlmostEqual(record['child_cost'], (100 * .1 + 10 * .5) / 1e6)
            self.assertFalse(check(path)['valid'])
            with self.subTest(case='parent agent differs from artifacts'):
                original_main = path.read_text()
                lines = [json.loads(line) for line in original_main.splitlines()]
                lines[1]['result']['details']['results'][0]['agent'] = 'worker'
                path.write_text('\n'.join(map(json.dumps, lines)) + '\n')
                with self.assertRaisesRegex(ValueError, 'agent'):
                    collect_bundle(path, source, root / 'wrong-parent-agent')
                path.write_text(original_main)
            with self.subTest(case='artifact filename agent differs from parent'):
                lines = [json.loads(line) for line in path.read_text().splitlines()]
                lines[1]['result']['details']['results'][0]['artifactPaths']['metadataPath'] = str(source / (run_id + '_worker_0_meta.json'))
                path.write_text('\n'.join(map(json.dumps, lines)) + '\n')
                with self.assertRaisesRegex(ValueError, 'agent|unbound'):
                    collect_bundle(path, source, root / 'wrong-filename-agent')
                path.write_text(original_main)
            with self.subTest(case='metadata agent differs from parent'):
                path.write_text(original_main)
                (source / (prefix + '_meta.json')).write_text(json.dumps({**meta, 'agent': 'worker'}))
                (source / (prefix + '_transcript.jsonl')).write_text(json.dumps({**transcript, 'agent': 'worker'}) + '\n')
                with self.assertRaisesRegex(ValueError, 'agent'):
                    collect_bundle(path, source, root / 'wrong-metadata-agent')
                (source / (prefix + '_meta.json')).write_text(json.dumps(meta))
                (source / (prefix + '_transcript.jsonl')).write_text(json.dumps(transcript) + '\n')
            with self.subTest(case='transcript agent differs from parent'):
                path.write_text(original_main)
                (source / (prefix + '_transcript.jsonl')).write_text(json.dumps({**transcript, 'agent': 'worker'}) + '\n')
                with self.assertRaisesRegex(ValueError, 'agent'):
                    collect_bundle(path, source, root / 'wrong-transcript-agent')
                (source / (prefix + '_transcript.jsonl')).write_text(json.dumps(transcript) + '\n')
            with self.subTest(case='child level runId without parent runId'):
                path.write_text(original_main)
                lines = [json.loads(line) for line in path.read_text().splitlines()]
                lines[1]['result']['details'].pop('runId')
                lines[1]['result']['details']['results'][0]['runId'] = run_id
                path.write_text('\n'.join(map(json.dumps, lines)) + '\n')
                child_bundle = root / 'child-run-evidence'
                self.assertTrue(collect_bundle(path, source, child_bundle))
                self.assertTrue(check(path, bundle=child_bundle)['valid'])
                self.assertAlmostEqual(parse_run(root, path.stem, 'actual', bundle=child_bundle)[0]['child_cost'], (100 * .1 + 10 * .5) / 1e6)
            with self.subTest(case='assistant nested toolCall'):
                transcript['message']['content'] = [{'type': 'toolCall', 'name': 'subagent'}]
                (source / (prefix + '_transcript.jsonl')).write_text(json.dumps(transcript) + '\n')
                with self.assertRaisesRegex(ValueError, 'nested child usage'):
                    collect_bundle(path, source, root / 'nested-evidence')

    def test_terminal_does_not_erase_failed_nested_or_invalid_partial(self):
        from unittest.mock import patch
        terminal = {('run', 0): child(runId='run', index=0)}
        for changes, expected in (
            ({'agent': 'other'}, 'conflicting child agent'),
            ({'exitCode': 1}, 'failed child result'),
            ({'children': [{'id': 'nested'}]}, 'nested child usage cannot be fully priced'),
            ({'usage': {}}, 'child usage missing or malformed'),
        ):
            with self.subTest(changes=changes), patch('native_results._bundle', return_value=terminal):
                _, problems, _, _ = children([tool('single', [child(**changes)], runId='run')], main='unused', bundle='unused')
                self.assertIn(expected, problems)

    def test_child_pricing_and_dedup_in_single_parallel_chain(self):
        events = [tool('single', [child()], runId='one'),
                  tool('parallel', [child(index=0), child(index=1)], runId='two'),
                  tool('chain', [child(index=0)], runId='three')]
        rows, problems, launches, rejected = children(events)
        self.assertEqual((len(rows), problems, launches, rejected), (4, [], 3, 0))
        events.append(tool('single', [child()], runId='one'))
        self.assertEqual(len(children(events)[0]), 4)

        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            (runs / (rid + '.jsonl')).write_text(''.join(json.dumps(e) + '\n' for e in [
                {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, *events]))
            (runs / (rid + '.eval.json')).write_text(json.dumps({'pass': True}))
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            self.assertTrue(check(runs / (rid + '.jsonl'))['valid'])
            rec, unpriced = parse_run(runs, rid, 'actual')
            self.assertEqual((rec['delegates'], rec['children'], unpriced), (4, 4, []))
            self.assertAlmostEqual(rec['child_cost'], 4 * (100 * .1 + 10 * .5) / 1e6)

    def test_resume_same_session_is_new_spend_repeated_run_is_not(self):
        first = child(sessionFile='/same/session.jsonl')
        second = child(sessionFile='/same/session.jsonl', usage={**first['usage'], 'output': 30})
        events = [tool('single', [first], runId='initial'),
                  tool('single', [second], runId='resume'),
                  tool('single', [first], runId='initial')]
        rows, problems, launches, rejected = children(events)
        self.assertEqual((len(rows), problems, launches, rejected), (2, [], 3, 0))
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [{'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, *events]) + '\n')
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            rec, unknown = parse_run(runs, rid, 'actual')
            self.assertEqual(unknown, [])
            self.assertEqual(rec['children'], 2)
            self.assertAlmostEqual(rec['child_cost'], (200 * .1 + 40 * .5) / 1e6)

    def test_nested_spend_requires_proof_even_with_parent_usage(self):
        nested_result = {'role': 'toolResult', 'toolName': 'subagent', 'details': {'mode': 'single', 'results': [child(model=MODEL)]}}
        nested_call = {'role': 'assistant', 'content': [{'type': 'toolCall', 'name': 'subagent'}]}
        cases = [child(children=[{'id': 'nested', 'totalCost': {'costUsd': 0.001}}]),
                 child(children=[{'id': 'nested'}]),
                 child(messages=[nested_result]), child(messages=[nested_call])]
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            for nested in cases:
                (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [
                    {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}},
                    tool('single', [nested], runId='parent')]) + '\n')
                self.assertIn('nested child usage cannot be fully priced', ' '.join(check(runs / (rid + '.jsonl'))['reasons']))
                rec, _ = parse_run(runs, rid, 'actual')
                self.assertIsNone(rec['child_cost'])
                self.assertIsNone(rec['total_cost'])

            (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [
                {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}},
                tool('single', [child(usage={**child()['usage'], 'cost': 0.0001})], runId='parent', totalCost={'costUsd': 0.001})]) + '\n')
            self.assertIn('nested child usage cannot be fully priced', ' '.join(check(runs / (rid + '.jsonl'))['reasons']))
            self.assertIsNone(parse_run(runs, rid, 'actual')[0]['total_cost'])

    def test_missing_model_usage_errors_and_async_are_invalid(self):
        cases = [(tool('single', [child(model=None)]), 'child model missing'),
                 (tool('parallel', [child(usage={})]), 'child usage missing or malformed'),
                 (tool('single', [child(exitCode=1, error='API error (503)')]), 'failed child result'),
                 (tool('single', [], asyncId='pending'), 'nonterminal/asynchronous subagent result'),
                 (tool('single', [], isError=True), 'subagent tool returned isError'),
                 (tool('chain', [child()], isError=True), 'subagent tool returned isError'),
                 (tool('single', [child()], toolName='bg_wait', completions=[{'runId': 'pending', 'state': 'running'}]), 'failed or nonterminal async completion'),
                 (tool('single', []), 'launched subagent has no terminal child results'),
                 (tool('parallel', []), 'launched subagent has no terminal child results'),
                 (tool('chain', []), 'launched subagent has no terminal child results')]
        # Pi puts isError beside details, not inside it.
        for event, _ in cases:
            if 'isError' in event['result']['details']:
                event['result']['isError'] = event['result']['details'].pop('isError')
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            for number, (event, expected) in enumerate(cases):
                path = Path(directory) / f'case{number}.jsonl'
                path.write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n' + json.dumps(event) + '\n')
                path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native'}}))
                path.with_suffix('.exit').write_text('0\n')
                self.assertIn(expected, ' '.join(check(path)['reasons']), event)
            pending = Path(directory) / 'pending.jsonl'
            pending.write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n' + json.dumps({'type': 'tool_execution_start', 'toolName': 'subagent', 'toolCallId': 'call-1'}) + '\n')
            pending.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native'}}))
            pending.with_suffix('.exit').write_text('0\n')
            self.assertIn('tool call has no terminal result', ' '.join(check(pending)['reasons']))
            (pending.with_suffix('.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            rec, _ = parse_run(Path(directory), 'pending', 'actual')
            self.assertIsNone(rec['child_cost'])
            self.assertIsNone(rec['total_cost'])
            bad_root = Path(directory) / 'bad-root.jsonl'
            bad_root.write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': {}}}) + '\n')
            bad_root.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': 'native'}}))
            bad_root.with_suffix('.exit').write_text('0\n')
            self.assertIn('missing Root usage', ' '.join(check(bad_root)['reasons']))

    def test_rejected_duplicate_call_is_counted_not_a_billing_gap(self):
        rejected = {'type': 'tool_execution_end', 'toolName': 'subagent', 'toolCallId': 'call-rejected',
                    'isError': True,
                    'result': {'content': [{'type': 'text', 'text': 'Rejected: a subagent call is already in progress. Issue exactly ONE subagent call per turn.'}],
                               'details': {}}}
        lookalike = {'type': 'tool_execution_end', 'toolName': 'subagent', 'toolCallId': 'call-lookalike',
                     'result': {'content': [], 'details': {'mode': 'single', 'results': []}}}
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [
                {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}},
                tool('single', [child()], runId='real'), rejected]) + '\n')
            (runs / (rid + '.eval.json')).write_text(json.dumps({'pass': True}))
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            self.assertTrue(check(runs / (rid + '.jsonl'))['valid'])
            rows, problems, launches, rejected_duplicates = children(
                [json.loads(line) for line in (runs / (rid + '.jsonl')).read_text().splitlines()
                 if json.loads(line).get('type') == 'tool_execution_end'])
            self.assertEqual((problems, launches, rejected_duplicates), ([], 1, 1))
            rec, unknown = parse_run(runs, rid, 'actual')
            self.assertEqual(unknown, [])
            self.assertIsNotNone(rec['total_cost'])
            self.assertEqual(rec['rejected_duplicates'], 1)
            self.assertEqual((rec['delegates'], rec['children']), (1, 1))
            expected_child = (100 * .1 + 10 * .5) / 1e6
            for weight, expected_root in [('actual', (10 * .3 + 2 * 1.2) / 1e6),
                                          ('opus', (10 * 5 + 2 * 25) / 1e6)]:
                with self.subTest(weight=weight):
                    priced, unpriced = parse_run(runs, rid, weight)
                    self.assertEqual(unpriced, [])
                    self.assertAlmostEqual(priced['root_cost'], expected_root)
                    self.assertAlmostEqual(priced['child_cost'], expected_child)
                    self.assertAlmostEqual(priced['total_cost'], expected_root + expected_child)
            (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(e) for e in [
                {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}, lookalike]) + '\n')
            self.assertIn('launched subagent has no terminal child results',
                          ' '.join(check(runs / (rid + '.jsonl'))['reasons']))

    def test_duplicate_rejection_requires_exact_transport_evidence(self):
        rejected = {'type': 'tool_execution_end', 'toolName': 'subagent',
                    'isError': True,
                    'result': {'content': [{'type': 'text', 'text':
                        'Rejected: a subagent call is already in progress. Issue exactly ONE subagent call per turn.'}],
                               'details': {}}}
        healthy = tool('single', [child()], runId='real')
        self.assertEqual(children([healthy, rejected]), ([child()], [], 1, 1))
        self.assertEqual(children([healthy, tool('management', [])]), ([child()], [], 1, 0))
        cases = []
        for value in (None, False, 1):
            event = deepcopy(rejected)
            event['isError'] = value
            cases.append((f'isError={value!r}', event))
        event = deepcopy(rejected)
        del event['isError']
        event['result']['isError'] = True
        cases.append(('result-level error only', event))
        event = deepcopy(rejected)
        event['result']['content'] = [{'type': 'text', 'text': 'unrelated failure'}]
        cases.append(('missing marker', event))
        for key, values in [('runId', ('started', '', None)),
                            ('results', ({}, None, False, 0, '', [])),
                            ('asyncId', ('pending', '', None, False))]:
            for value in values:
                event = deepcopy(rejected)
                event['result']['details'][key] = value
                cases.append((f'{key}={value!r}', event))
        for value in (None, False, [], '', ['invalid'], 'invalid', 42):
            event = deepcopy(rejected)
            event['result']['details'] = value
            cases.append((f'details={value!r}', event))
        event = deepcopy(rejected)
        del event['result']['details']
        cases.append(('missing details', event))
        for error in (True, False, None):
            for mode in (None, '', 'unknown', 'single'):
                event = deepcopy(rejected)
                event['isError'] = error
                event['result']['details'] = {'results': []}
                if mode is not None:
                    event['result']['details']['mode'] = mode
                cases.append((f'empty results error={error!r} mode={mode!r}', event))
        event = deepcopy(rejected)
        del event['isError']
        event['result']['details'] = {'results': []}
        cases.append(('empty results missing error and mode', event))
        for name, event in cases:
            with self.subTest(name=name):
                rows, problems, launches, rejected_count = children([healthy, event])
                self.assertEqual(rows, [child()])
                details = event['result'].get('details')
                expected = ('launched subagent has no terminal child results'
                            if isinstance(details, dict) and details.get('results') == []
                            else 'subagent result has no child results array')
                self.assertIn(expected, problems)
                self.assertEqual((launches, rejected_count), (1, 0))

    def test_unpriced_child_never_gets_partial_total(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            (runs / (rid + '.jsonl')).write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n' + json.dumps(tool('single', [child(model='unknown/model')], runId='bad')) + '\n')
            (runs / (rid + '.eval.json')).write_text(json.dumps({'pass': False}))
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            rec, unknown = parse_run(runs, rid, 'actual')
            self.assertEqual(unknown, ['unknown/model'])
            self.assertIsNone(rec['child_cost'])
            self.assertIsNone(rec['total_cost'])
            (runs / (rid + '.jsonl')).write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n' + json.dumps(tool('single', [child(usage={'input': 3})], runId='bad')) + '\n')
            rec, unknown = parse_run(runs, rid, 'actual')
            self.assertEqual(unknown, [])
            self.assertIsNone(rec['child_cost'])
            self.assertIsNone(rec['total_cost'])
            (runs / (rid + '.jsonl')).write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': {**ROOT_USAGE, 'output': 'bad'}}}) + '\n')
            rec, _ = parse_run(runs, rid, 'actual')
            self.assertIsNone(rec['root_cost'])
            self.assertIsNone(rec['total_cost'])

    def test_cli_attempt_spend_includes_invalid_and_excludes_unknown_totals(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory) / 'runs'
            runs.mkdir()

            def put(rep, mode, root_usage, event, evaluated=True):
                rid = f'T3-{mode}-pds-{rep}'
                (runs / (rid + '.jsonl')).write_text('\n'.join(json.dumps(x) for x in [
                    {'type': 'message_end', 'message': {'role': 'assistant', 'usage': root_usage}}, event]) + '\n')
                (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': mode, 'rootModel': ROOT_MODEL}}))
                (runs / (rid + '.exit')).write_text('0\n')
                if evaluated:
                    (runs / (rid + '.eval.json')).write_text(json.dumps({'pass': True}))
                return rid

            good = put(1, 'native', ROOT_USAGE, tool('single', [child()], runId='good'))
            invalid = put(2, 'native', ROOT_USAGE, tool('single', [child(exitCode=1)], runId='failed'))
            output = runs.parent / 'summary.json'

            def summary():
                proc = subprocess.run([sys.executable, '-B', str(BENCH / 'summarize.py'), str(runs), '--weight', 'actual', '--json', str(output)], capture_output=True, text=True)
                return proc, json.loads(output.read_text())

            proc, data = summary()
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual([x['id'] for x in data['runs']], [good])
            self.assertIsNone(data['aggregates']['native-pds']['mechanism']['refused'])
            self.assertIn('refused=NA', proc.stdout)
            self.assertEqual(data['invalid'][0]['id'], invalid)
            self.assertEqual(len(data['attempt_spend']), 2)
            self.assertAlmostEqual(data['attempt_spend_total'], sum(x['cost'] for x in data['attempt_spend']))

            missing = put(3, 'native', ROOT_USAGE, tool('single', [child()], runId='missing'), evaluated=False)
            proc, data = summary()
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(missing, data['incomplete'])
            self.assertIsNone(data['attempt_spend_total'])

            unknown = put(4, 'native', ROOT_USAGE, tool('single', [child(model='unknown/model')], runId='unknown'))
            proc, data = summary()
            self.assertEqual(proc.returncode, 1)
            self.assertIn('UNPRICED child model', proc.stdout)
            self.assertIsNone(data['attempt_spend_total'])
            self.assertIsNone(next(x['cost'] for x in data['attempt_spend'] if x['id'] == unknown))

            bad_root = put(5, 'native', {**ROOT_USAGE, 'input': 'bad'}, tool('single', [child()], runId='bad-root'))
            proc, data = summary()
            self.assertEqual(proc.returncode, 1, proc.stderr)
            self.assertIsNone(next(x['cost'] for x in data['attempt_spend'] if x['id'] == bad_root))

    def test_lite_child_missing_or_unknown_usage_never_claims_complete_spend(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-lite-pds-1'
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'lite', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            (runs / (rid + '.eval.json')).write_text(json.dumps({'pass': True}))
            for details, unknown_model in [({'model': MODEL, 'status': 'completed'}, False),
                                           ({'model': MODEL, 'status': 'completed', 'usage': {'input': 'bad', 'output': 1, 'cacheRead': 0, 'cacheWrite': 0}}, False),
                                           ({'model': 'unknown/model', 'status': 'completed', 'usage': ROOT_USAGE}, True)]:
                event = {'type': 'tool_execution_end', 'toolName': 'delegate', 'result': {'content': [], 'details': details}}
                (runs / (rid + '.jsonl')).write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n' + json.dumps(event) + '\n')
                rec, unknown = parse_run(runs, rid, 'actual')
                self.assertIsNone(rec['child_cost'])
                self.assertIsNone(rec['total_cost'])
                self.assertEqual(bool(unknown), unknown_model)

    def test_root_usage_missing_in_any_mode_never_claims_complete_cost(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-direct-pds-1'
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'direct', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            for messages in ([], [{'type': 'message_end', 'message': {'role': 'assistant', 'usage': {}}}]):
                (runs / (rid + '.jsonl')).write_text(''.join(json.dumps(message) + '\n' for message in messages))
                rec, _ = parse_run(runs, rid, 'actual')
                self.assertIsNone(rec['root_cost'])
                self.assertIsNone(rec['total_cost'])
            rid = 'T3-lite-pds-1'
            (runs / (rid + '.meta.json')).write_text(json.dumps({'arm': {'mode': 'lite', 'rootModel': ROOT_MODEL}}))
            (runs / (rid + '.exit')).write_text('0\n')
            (runs / (rid + '.jsonl')).write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': {'input': 3}}}) + '\n')
            self.assertIsNone(parse_run(runs, rid, 'actual')[0]['total_cost'])

    def test_missing_or_invalid_metadata_cannot_hide_native_spend(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            rid = 'T3-native-pds-1'
            path = runs / (rid + '.jsonl')
            path.write_text('\n'.join(json.dumps(e) for e in [
                {'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}},
                tool('single', [child()], runId='metadata-check')]) + '\n')
            path.with_suffix('.eval.json').write_text(json.dumps({'pass': True}))
            meta = path.with_suffix('.meta.json')
            meta.write_text(json.dumps({'arm': {'mode': 'native', 'rootModel': ROOT_MODEL}}))
            path.with_suffix('.exit').write_text('0\n')
            self.assertTrue(check(path)['valid'])
            self.assertIsNotNone(parse_run(runs, rid, 'opus')[0]['total_cost'])
            for broken in (None, '{', '[]', '{}', '{"arm": []}', '{"arm": {"mode": "native"}}', '{"arm": {"mode": "native", "rootModel": []}}'):
                if broken is None:
                    meta.unlink()
                else:
                    meta.write_text(broken)
                self.assertIn('missing or invalid arm metadata', ' '.join(check(path)['reasons']))
                rec, _ = parse_run(runs, rid, 'opus')
                self.assertIsNone(rec['child_cost'])
                self.assertIsNone(rec['total_cost'])
                self.assertIsNone(parse_run(runs, rid, 'actual')[0]['total_cost'])

    def test_truncation_and_nonzero_exit_leave_only_cost_lower_bound(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            for mode in ('direct', 'lite', 'native'):
                rid = f'T3-{mode}-pds-1'
                path = runs / (rid + '.jsonl')
                good = json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n'
                path.write_text(good)
                path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': mode, 'rootModel': ROOT_MODEL}}))
                path.with_suffix('.exit').write_text('0\n')
                path.with_suffix('.eval.json').write_text(json.dumps({'pass': True}))
                self.assertTrue(check(path)['valid'])
                full_cost = parse_run(runs, rid, 'opus')[0]['total_cost']
                self.assertGreater(full_cost, 0)
                for tail in ('{"type":"message_end","message":', '[]\n'):
                    path.write_text(good + tail)
                    self.assertIn('incomplete transcript', ' '.join(check(path)['reasons']))
                    rec, _ = parse_run(runs, rid, 'opus')
                    self.assertIsNone(rec['total_cost'])
                    self.assertEqual(rec['known_cost_lower_bound'], full_cost)
                path.write_text(good)
                path.with_suffix('.exit').write_text('124\n')
                self.assertIn('nonzero Pi exit', ' '.join(check(path)['reasons']))
                rec, _ = parse_run(runs, rid, 'opus')
                self.assertIsNone(rec['total_cost'])
                self.assertEqual(rec['known_cost_lower_bound'], full_cost)
            output = runs / 'summary.json'
            done = subprocess.run([sys.executable, '-B', str(BENCH / 'summarize.py'), str(runs), '--json', str(output)], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            data = json.loads(output.read_text())
            self.assertIsNone(data['attempt_spend_total'])
            self.assertEqual(len(data['invalid']), 3)
            self.assertTrue(all(x['cost'] is None and x['known_cost_lower_bound'] > 0 for x in data['attempt_spend']))

    def test_missing_exit_cannot_certify_completed_cost(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            runs = Path(directory)
            for mode in ('direct', 'lite', 'native'):
                rid = f'T3-{mode}-pds-1'
                path = runs / (rid + '.jsonl')
                path.write_text(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'usage': ROOT_USAGE}}) + '\n')
                path.with_suffix('.meta.json').write_text(json.dumps({'arm': {'mode': mode, 'rootModel': ROOT_MODEL}}))
                path.with_suffix('.eval.json').write_text(json.dumps({'pass': True}))
                path.with_suffix('.exit').write_text('0\n')
                self.assertTrue(check(path)['valid'])
                cost = parse_run(runs, rid, 'opus')[0]['total_cost']
                self.assertGreater(cost, 0)
                path.with_suffix('.exit').unlink()
                self.assertIn('missing Pi exit evidence', ' '.join(check(path)['reasons']))
                rec, _ = parse_run(runs, rid, 'opus')
                self.assertIsNone(rec['total_cost'])
                self.assertEqual(rec['known_cost_lower_bound'], cost)
            output = runs / 'summary.json'
            done = subprocess.run([sys.executable, '-B', str(BENCH / 'summarize.py'), str(runs), '--json', str(output)], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            data = json.loads(output.read_text())
            self.assertEqual(data['runs'], [])
            self.assertIsNone(data['attempt_spend_total'])
            self.assertEqual(len(data['invalid']), 3)

    def test_launch_routes_and_rejects_unknown_mode(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            (root / 'bench/arms').mkdir(parents=True)
            (root / 'bench/tasks').mkdir()
            (root / 'bin').mkdir()
            home = root / 'home'
            (home / '.config/pi').mkdir(parents=True)
            (home / '.pi/agent').mkdir(parents=True)
            (home / '.config/pi/secrets.zsh').write_text('')
            (home / '.pi/agent/settings.json').write_text(json.dumps({'subagents': {'defaultModel': MODEL}}))
            (root / 'bench/run.sh').write_bytes((BENCH / 'run.sh').read_bytes())
            (root / 'bench/temp_guard.py').write_bytes((BENCH / 'temp_guard.py').read_bytes())
            isolated_script = (BENCH / 'run-body.sh').read_text().replace('$HOME/.config/pi/secrets.zsh', str(home / '.config/pi/secrets.zsh')).replace('$HOME/.pi/agent/settings.json', str(home / '.pi/agent/settings.json'))
            (root / 'bench/run-body.sh').write_text(isolated_script)
            (root / 'bench/tasks/T3.json').write_text(json.dumps({'id': 'T3', 'repo': 'x', 'target': 'a', 'parent': 'b', 'python': 'python3', 'prompt': 'T3.md', 'baseline': 'T3.json', 'tests': []}))
            (root / 'bench/tasks/T3.md').write_text('task')
            (root / 'bin/pi').write_text('#!/bin/sh\nif [ -n "${PI_MARKER:-}" ]; then printf called > "$PI_MARKER"; fi\ncase "$1" in --list-models) printf "cline/cline-pass deepseek-v4.1-flash\\ntcuni gpt-6-luna\\n";; --version) echo pi-test;; esac\n')
            (root / 'bin/pi').chmod(0o755)
            (root / 'bin/git').write_text('#!/bin/sh\ncase "$3" in rev-parse) echo testsha;; esac\n')
            (root / 'bin/git').chmod(0o755)
            (root / 'index.ts').write_text('')
            env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'TMPDIR': '/project/tmp',
                   'BENCH_OUT': str(root / 'out'), 'BENCH_DRY_RUN': '1', 'BENCH_SKIP_HEALTH': '1'}
            (root / 'out').mkdir()
            for arm in ('native-pds', 'lite-pds-head', 'direct-pds'):
                (root / f'bench/arms/{arm}.json').write_bytes((BENCH / f'arms/{arm}.json').read_bytes())
            for arm, expected in [('native-pds', 1), ('lite-pds-head', 2), ('direct-pds', 0)]:
                done = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', arm, '1'], env=env, capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(done.stdout.count(' -e '), expected, done.stdout)
                self.assertIn('temp guard: ', done.stderr)
                self.assertIn('tempResource', (root / f'out/runs/T3-{arm}-1.meta.json').read_text())
            (root / 'bench/arms/bad.json').write_text(json.dumps({'name': 'bad', 'mode': 'not-supported', 'rootModel': ROOT_MODEL, 'pluginRef': '', 'promptPrefix': ''}))
            done = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', 'bad', '1'], env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 2)
            self.assertIn('unsupported arm mode', done.stderr)
            bad_env = json.loads((root / 'bench/arms/direct-pds.json').read_text())
            bad_env['env'] = {'TMPDIR': '/tmp'}
            (root / 'bench/arms/bad-env.json').write_text(json.dumps(bad_env))
            done = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', 'bad-env', '1'], env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 2)
            self.assertIn('arm cannot override temp resource', done.stderr)
            unsafe = {**env, 'BENCH_OUT': '/tmp/ppo-guard-invalid-output', 'PI_MARKER': str(root / 'pi-called')}
            done = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', 'direct-pds', '1'],
                                  env=unsafe, capture_output=True, text=True)
            self.assertEqual(done.returncode, 3, done.stderr)
            self.assertIn('BLOCKED temp guard', done.stderr)
            self.assertFalse((root / 'pi-called').exists())

    def test_temp_guard_denies_tmp_and_child_writes_but_allows_external_temp(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            (root / 'bench').mkdir()
            (root / 'bench/run.sh').write_bytes((BENCH / 'run.sh').read_bytes())
            (root / 'bench/temp_guard.py').write_bytes((BENCH / 'temp_guard.py').read_bytes())
            (root / 'tmp-alias').symlink_to('/tmp', target_is_directory=True)
            (root / 'bench/run-body.sh').write_text('''#!/bin/bash
python3 -B - "$1" <<'PY'
import errno, json, os, pathlib, subprocess, sys
allowed = pathlib.Path(sys.argv[1]) / 'child-allowed'
allowed.write_text('ok')
assert allowed.read_text() == 'ok'
allowed.unlink()
probe = pathlib.Path('/tmp/ppo-denied-child-' + str(os.getpid()))
assert not probe.exists()
alias_probe = pathlib.Path(sys.argv[1]) / 'tmp-alias' / probe.name
try:
    alias_probe.write_text('forbidden')
except OSError as exc:
    assert exc.errno == errno.EACCES, exc
else:
    raise AssertionError('alias /tmp write succeeded')
assert not probe.exists()
try:
    probe.write_text('forbidden')
except OSError as exc:
    assert exc.errno == errno.EACCES, exc
else:
    raise AssertionError('/tmp child write succeeded')
assert not probe.exists()
for cmd in ([ 'python3', '-B', '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("x")', str(probe) ],
            [ 'bash', '-c', 'echo x > "$1"', 'bash', str(probe) ]):
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode != 0 and not probe.exists(), result
    assert 'Permission denied' in result.stderr or 'PermissionError' in result.stderr, result
print(json.dumps({'resource': json.loads(os.environ['BENCH_TEMP_RESOURCE']), 'temp': os.environ['TMPDIR']}))
PY
''')
            env = {**os.environ, 'TMPDIR': '/project/tmp'}
            # An inherited marker must have no power to bypass policy setup.
            env['BENCH_TEMP_GUARD_READY'] = '1'
            result = subprocess.run(['bash', str(root / 'bench/run.sh'), str(root)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            info = json.loads(result.stdout)
            self.assertEqual(info['resource']['backend'], 'landlock')
            self.assertGreaterEqual(info['resource']['abi'], 3)
            self.assertEqual(info['temp'], '/project/tmp')

    def test_failed_guard_blocks_before_pi_and_records_stop_not_retry(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            (root / 'bench').mkdir()
            (root / 'bench/run.sh').write_bytes((BENCH / 'run.sh').read_bytes())
            # Deliberately unavailable syscall, so no denied probe can be reached.
            broken = (BENCH / 'temp_guard.py').read_text().replace('SYS_CREATE, SYS_ADD, SYS_RESTRICT = 444, 445, 446',
                                                                   'SYS_CREATE, SYS_ADD, SYS_RESTRICT = 999999, 445, 446')
            (root / 'bench/temp_guard.py').write_text(broken)
            (root / 'bench/run-body.sh').write_text('#!/bin/bash\necho pi-would-run > "$BENCH_OUT/pi-called"\n')
            output = root / 'out'
            output.mkdir()
            env = {**os.environ, 'TMPDIR': '/project/tmp', 'BENCH_OUT': str(output), 'BENCH_MAX_ATTEMPTS': '3', 'BENCH_ATTEMPT': '1'}
            result = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', 'native-pds', '1'],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 3, result.stderr)
            self.assertIn('BLOCKED temp guard', result.stderr)
            self.assertIn('BLOCKED temp guard', (output / 'STOP').read_text())
            self.assertFalse((output / 'RETRY').exists())
            self.assertFalse((output / 'pi-called').exists())

    def test_public_guard_rejects_long_runtime_socket_path_before_body(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            (root / 'bench').mkdir()
            (root / 'bench/tasks').mkdir()
            runtime = Path('/public/scripts/tc-probe-design-v2/.venv/bin/python')
            if not runtime.is_file():
                self.skipTest('configured T1 Python runtime unavailable')
            (root / 'bench/tasks/T3.json').write_text(json.dumps({'python': str(runtime)}))
            (root / 'bench/run.sh').write_bytes((BENCH / 'run.sh').read_bytes())
            (root / 'bench/temp_guard.py').write_bytes((BENCH / 'temp_guard.py').read_bytes())
            (root / 'bench/run-body.sh').write_text('''#!/bin/bash
set -e
"$TEST_RUNTIME_PYTHON" -B - "$BENCH_OUT" <<'PY'
import errno, os, pathlib, sys
from multiprocessing import Manager
(pathlib.Path(sys.argv[1]) / 'body-entered').write_text('entered')
with Manager() as manager:
    assert manager.list([42])[0] == 42
denied = pathlib.Path('/tmp') / ('ppo-runtime-denied-' + str(os.getpid()))
try:
    denied.mkdir()
except OSError as error:
    assert error.errno == errno.EACCES, error
else:
    denied.rmdir()
    raise AssertionError('/tmp write was allowed')
(pathlib.Path(sys.argv[1]) / 'body-called').write_text('real socket and /tmp denial verified')
PY
''')
            prefix = 'ls-long-' + 'x' * (83 - len('/project/tmp/') - len('ls-long-') - 8)
            with tempfile.TemporaryDirectory(prefix=prefix, dir='/project/tmp') as long_temp:
                self.assertEqual(len(long_temp.encode()), 83)
                for label, temp, expected_exit in (('long', long_temp, 3), ('short', os.environ['TMPDIR'], 0)):
                    with self.subTest(label=label):
                        output = root / ('out-' + label)
                        output.mkdir()
                        env = {**os.environ, 'TMPDIR': temp, 'TMP': temp, 'TEMP': temp,
                               'PYTHONDONTWRITEBYTECODE': '1', 'BENCH_OUT': str(output),
                               'BENCH_MAX_ATTEMPTS': '3', 'BENCH_ATTEMPT': '1',
                               'TEST_RUNTIME_PYTHON': str(runtime)}
                        result = subprocess.run(['bash', str(root / 'bench/run.sh'), 'T3', 'native-pds', '1'],
                                                env=env, capture_output=True, text=True, timeout=10)
                        self.assertEqual(result.returncode, expected_exit,
                                         f'stderr={result.stderr} stdout={result.stdout} marker={(output / "body-called").exists()}')
                        self.assertEqual((output / 'body-entered').exists(), label == 'short')
                        self.assertEqual((output / 'body-called').exists(), label == 'short')
                        self.assertFalse((output / 'RETRY').exists())
                        if label == 'long':
                            self.assertIn('AF_UNIX', result.stderr)
                            self.assertIn('BLOCKED temp guard', (output / 'STOP').read_text())
                        else:
                            self.assertFalse((output / 'STOP').exists())

    def test_temp_guard_rejects_repo_local_and_tmp_alias_layout(self):
        from temp_guard import grant_directories, select_temp
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            with patch.dict(os.environ, {'TMPDIR': str(BENCH.parent / '.scratch')}):
                with self.assertRaises(ValueError):
                    select_temp()
            with patch.dict(os.environ, {'TMPDIR': '/tmp'}):
                with self.assertRaises(ValueError):
                    select_temp()
            alias = Path(directory) / 'alias'
            alias.symlink_to('/tmp', target_is_directory=True)
            with patch.dict(os.environ, {'TMPDIR': str(alias)}):
                with self.assertRaises(ValueError):
                    select_temp()
            with patch('temp_guard.Path.iterdir', return_value=iter([Path('/'), Path('/project')])):
                with self.assertRaises(ValueError):
                    grant_directories()
            real_samefile = os.path.samefile
            def root_bind_alias(left, right):
                if str(left) == '/project' and str(right) == '/':
                    return True
                return real_samefile(left, right)
            with patch('temp_guard.Path.iterdir', return_value=iter([Path('/project')])), \
                 patch('temp_guard.os.path.samefile', side_effect=root_bind_alias):
                with self.assertRaisesRegex(ValueError, 'unsafe bind alias'):
                    grant_directories()

    def test_temp_guard_rejects_bind_device_before_temp_creation(self):
        from temp_guard import select_temp
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory) / 'external'
            root.mkdir()
            parent = root / 'ppo-bench'
            parent.mkdir()
            selected = root / 'selected'
            selected.mkdir()
            forbidden_device = Path('/tmp').stat().st_dev
            actual_device = root.stat().st_dev
            self.assertNotEqual(forbidden_device, actual_device)

            for fake_alias, requested in ((root, ''), (parent, ''), (selected, str(selected))):
                def device(path):
                    return forbidden_device if path == fake_alias or path == Path('/tmp') else path.stat().st_dev
                with self.subTest(alias=fake_alias), \
                     patch('temp_guard.TMP_ROOT', root), \
                     patch('temp_guard.filesystem_device', side_effect=device), \
                     patch('temp_guard.tempfile.mkdtemp') as create, \
                     patch.dict(os.environ, {'TMPDIR': requested}):
                    with self.assertRaisesRegex(ValueError, 'shares /tmp filesystem'):
                        select_temp()
                    create.assert_not_called()
            self.assertEqual(list(parent.iterdir()), [])

    def test_guard_mountinfo_collects_nested_tmp_devices_and_rejects_outside_alias(self):
        from temp_guard import forbidden_devices, parse_mountinfo
        from unittest.mock import patch
        dev = Path('/tmp').stat().st_dev
        nested = os.makedev(0, 63001)
        text = (f'1 0 {os.major(dev)}:{os.minor(dev)} / /tmp rw - tmpfs tmpfs rw\n'
                '2 1 0:63001 / /tmp/nested\\040mount rw - tmpfs tmpfs rw\n')
        self.assertIn((Path('/tmp/nested mount'), nested), parse_mountinfo(text))
        with patch('temp_guard.Path.read_text', return_value=text):
            self.assertEqual(forbidden_devices(reject_outside_aliases=True), {dev, nested})
        with patch('temp_guard.Path.read_text', return_value=text +
                   '3 0 0:63001 /nested /external-alias rw - tmpfs tmpfs rw\n'):
            self.assertEqual(forbidden_devices(), {dev, nested})
            with self.assertRaisesRegex(ValueError, 'exposed outside /tmp'):
                forbidden_devices(reject_outside_aliases=True)

    def test_guard_rejects_root_grant_on_nested_tmp_mount_device(self):
        from temp_guard import grant_directories
        from unittest.mock import patch
        dev = Path('/tmp').stat().st_dev
        text = (f'1 0 {os.major(dev)}:{os.minor(dev)} / /tmp rw - tmpfs tmpfs rw\n'
                '2 1 0:63001 / /tmp/nested rw - tmpfs tmpfs rw\n')
        def device(path):
            return os.makedev(0, 63001) if path == Path('/project') else path.stat().st_dev
        with patch('temp_guard.Path.read_text', return_value=text), \
             patch('temp_guard.Path.iterdir', return_value=iter([Path('/project')])), \
             patch('temp_guard.filesystem_device', side_effect=device):
            with self.assertRaisesRegex(ValueError, '/tmp filesystem root alias'):
                grant_directories()

    def test_guard_outside_alias_blocks_startup_but_records_safe_stop(self):
        from temp_guard import main
        from unittest.mock import patch
        dev = Path('/tmp').stat().st_dev
        text = (f'1 0 {os.major(dev)}:{os.minor(dev)} / /tmp rw - tmpfs tmpfs rw\n'
                '2 1 0:63001 / /tmp/nested rw - tmpfs tmpfs rw\n'
                '3 0 0:63001 /nested /outside-alias rw - tmpfs tmpfs rw\n')
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            output = Path(directory) / 'out'
            with patch('temp_guard.Path.read_text', return_value=text), \
                 patch('temp_guard.tempfile.mkdtemp') as create, \
                 patch('temp_guard.install') as install, \
                 patch.dict(os.environ, {'BENCH_OUT': str(output)}):
                self.assertEqual(main(['T3', 'native-pds', '1']), 3)
                create.assert_not_called()
                install.assert_not_called()
            self.assertIn('/tmp filesystem exposed outside /tmp', (output / 'STOP').read_text())

    def test_guard_malformed_mountinfo_blocks_before_policy_or_output(self):
        from temp_guard import forbidden_devices, main
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            output = Path(directory) / 'out'
            for malformed in ('not mountinfo\n', '1 0 0:45 / /tmp\\099 rw - tmpfs tmpfs rw\n', ''):
                with self.subTest(mountinfo=malformed), \
                     patch('temp_guard.Path.read_text', return_value=malformed), \
                     patch('temp_guard.install') as install, \
                     patch.dict(os.environ, {'BENCH_OUT': str(output)}):
                    with self.assertRaises(ValueError):
                        forbidden_devices(reject_outside_aliases=True)
                    self.assertEqual(main(['T3', 'native-pds', '1']), 3)
                    install.assert_not_called()
                    self.assertFalse(output.exists())

    def test_temp_guard_rejects_temp_inside_runner_repo(self):
        from temp_guard import select_temp
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            repo = Path(directory)
            helper = repo / 'bench/temp_guard.py'
            helper.parent.mkdir()
            helper.write_text('# fixture\n')
            requested = repo / 'owned-temp'
            requested.mkdir()
            with patch('temp_guard.__file__', str(helper)), \
                 patch.dict(os.environ, {'TMPDIR': str(requested)}):
                with self.assertRaisesRegex(ValueError, 'outside the source repo'):
                    select_temp()

    def test_guard_stop_refuses_symlink_without_touching_target(self):
        from temp_guard import record_block
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            sentinel = root / 'sentinel'
            sentinel.write_text('unchanged')
            output = root / 'out'
            output.mkdir()
            (output / 'STOP').symlink_to(sentinel)
            with patch.dict(os.environ, {'BENCH_OUT': str(output)}):
                record_block('simulated unavailable backend', ['T3', 'native-pds', '1'])
            self.assertEqual(sentinel.read_text(), 'unchanged')
            self.assertTrue((output / 'STOP').is_symlink())

    def test_guard_stop_refuses_forbidden_parent_device_before_mkdir(self):
        from temp_guard import record_block
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            output = root / 'out'
            forbidden_device = Path('/tmp').stat().st_dev
            self.assertNotEqual(root.stat().st_dev, forbidden_device)
            def device(path):
                return forbidden_device if path == root or path == Path('/tmp') else path.stat().st_dev
            with patch.dict(os.environ, {'BENCH_OUT': str(output)}), \
                 patch('temp_guard.filesystem_device', side_effect=device):
                record_block('unavailable backend', ['T3', 'native-pds', '1'])
            self.assertFalse(output.exists())

    def test_guard_rejects_output_on_forbidden_device_before_exec(self):
        from temp_guard import safe_output_path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            output = root / 'out'
            output.mkdir()
            forbidden_device = Path('/tmp').stat().st_dev
            for simulated_alias in (root, output):
                def device(path):
                    return forbidden_device if path == simulated_alias or path == Path('/tmp') else path.stat().st_dev
                with self.subTest(alias=simulated_alias), \
                     patch('temp_guard.filesystem_device', side_effect=device):
                    with self.assertRaisesRegex(ValueError, 'unsafe .*BENCH_OUT'):
                        safe_output_path(str(output))
            self.assertEqual(list(output.iterdir()), [])

    def test_guard_stop_refuses_forbidden_existing_dir_or_file_device(self):
        from temp_guard import record_block
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            output = root / 'out'
            output.mkdir()
            sentinel = output / 'STOP'
            sentinel.write_text('unchanged')
            forbidden_device = Path('/tmp').stat().st_dev
            real_stat, real_fstat, real_open = os.stat, os.fstat, os.open
            def stat_entry(path, *args, **kwargs):
                if path == 'out' and kwargs.get('dir_fd') is not None:
                    return SimpleNamespace(st_mode=stat.S_IFDIR, st_dev=forbidden_device)
                return real_stat(path, *args, **kwargs)
            with patch.dict(os.environ, {'BENCH_OUT': str(output)}), \
                 patch('temp_guard.os.stat', side_effect=stat_entry):
                record_block('unavailable backend', ['T3', 'native-pds', '1'])
            self.assertEqual(sentinel.read_text(), 'unchanged')

            def stat_stop(path, *args, **kwargs):
                if path == 'STOP' and kwargs.get('dir_fd') is not None:
                    return SimpleNamespace(st_mode=stat.S_IFREG, st_dev=forbidden_device)
                return real_stat(path, *args, **kwargs)
            with patch.dict(os.environ, {'BENCH_OUT': str(output)}), \
                 patch('temp_guard.os.stat', side_effect=stat_stop), \
                 patch('temp_guard.os.open', wraps=real_open) as opened:
                record_block('unavailable backend', ['T3', 'native-pds', '1'])
                self.assertFalse(any(call.args[0] == 'STOP' for call in opened.call_args_list))
            self.assertEqual(sentinel.read_text(), 'unchanged')

            for forbidden_path in (root, output, sentinel):
                def fstat_entry(fd):
                    actual = real_fstat(fd)
                    if Path(os.readlink(f'/proc/self/fd/{fd}')) == forbidden_path:
                        return SimpleNamespace(st_mode=actual.st_mode, st_dev=forbidden_device)
                    return actual
                with self.subTest(opened=forbidden_path), \
                     patch.dict(os.environ, {'BENCH_OUT': str(output)}), \
                     patch('temp_guard.os.fstat', side_effect=fstat_entry):
                    record_block('unavailable backend', ['T3', 'native-pds', '1'])
                self.assertEqual(sentinel.read_text(), 'unchanged')

    def test_guard_rejects_wrong_reason_child_exit(self):
        from temp_guard import verify
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            denied = OSError(13, 'Permission denied')
            wrong = subprocess.CompletedProcess([], 1, '', 'command not found')
            with patch('temp_guard.Path.mkdir', side_effect=denied), \
                 patch('temp_guard.subprocess.run', return_value=wrong) as child_run:
                with self.assertRaisesRegex(RuntimeError, 'Python child /tmp denial unverified'):
                    verify(Path(directory))
            self.assertEqual(child_run.call_count, 1)

    def test_guard_rejects_wrong_reason_bash_exit(self):
        from temp_guard import verify
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            denied = OSError(13, 'Permission denied')
            python_denied = subprocess.CompletedProcess([], 0, 'DENIED:EACCES\n', '')
            wrong = subprocess.CompletedProcess([], 1, '', 'mkdir: read-only file system')
            with patch('temp_guard.Path.mkdir', side_effect=denied), \
                 patch('temp_guard.subprocess.run', side_effect=[python_denied, wrong]) as child_run:
                with self.assertRaisesRegex(RuntimeError, 'Bash child /tmp denial unverified'):
                    verify(Path(directory))
            self.assertEqual(child_run.call_count, 2)


if __name__ == '__main__':
    unittest.main()

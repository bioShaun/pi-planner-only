#!/usr/bin/env python3
"""External behavior tests for the Root cache analyzer."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / 'root_cache.py'


def assistant(minute, read=80, write=10, cost=0.5):
    usage = {'input': 10, 'cacheRead': read, 'cacheWrite': write}
    if cost is not None:
        usage['cost'] = {'cacheWrite': cost}
    return {'type': 'message', 'timestamp': f'2026-10-29T{minute // 60:02d}:{minute % 60:02d}:00Z',
            'message': {'role': 'assistant', 'usage': usage}}


def mode(value):
    return {'type': 'custom', 'customType': 'planner-only-mode', 'data': {'mode': value}}


def message(role, content=None):
    return {'type': 'message', 'message': {'role': role, 'content': content}}


class RootCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, events):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('\n'.join(e if isinstance(e, str) else json.dumps(e) for e in events) + '\n')
        return path

    def run_report(self, path, *args):
        output = self.root / 'report.json'
        result = subprocess.run([sys.executable, str(SCRIPT), str(path), *args, '--json', str(output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(output.exists(), 'JSON report was not written')
        return json.loads(output.read_text()), result.stdout

    def test_gaps_metrics_and_subagent_trigger(self):
        path = self.write('session.jsonl', [mode('native'), assistant(0), message('toolResult'),
            assistant(2, 80, 10), {'type': 'custom_message', 'customType': 'subagent-notify'},
            assistant(12, 10, 80, None), message('user'), assistant(72, 50, 40)])
        report, text = self.run_report(path)
        self.assertEqual(report['turns'], 4)
        self.assertEqual(report['groups']['<5m']['turns'], 1)
        self.assertAlmostEqual(report['groups']['<5m']['hit_rate'], 0.8)
        self.assertEqual(report['groups']['5-60m']['cold_starts'], 1)
        self.assertAlmostEqual(report['groups']['5-60m']['hit_rate'], 0.1)
        self.assertEqual(report['groups']['5-60m']['missing_cache_write_cost'], 1)
        self.assertAlmostEqual(report['groups']['>=60m']['hit_rate'], 0.5)
        self.assertEqual(report['groups']['>=60m']['cold_starts'], 0)
        self.assertEqual(report['groups']['>=60m']['cache_write_cost'], 0.5)
        self.assertEqual(report['by_trigger']['subagent']['5-60m']['turns'], 1)
        self.assertIn('approximate', text.lower())
        self.assertIn('file order', text.lower())
        self.assertTrue({'files', 'turns', 'groups', 'by_trigger', 'structural', 'params'} <= report.keys())

    def test_mode_switch_and_previous_unmatched_assistant(self):
        path = self.write('session.jsonl', [mode('native'), assistant(0), mode('lite'), assistant(10),
                                            mode('native'), assistant(12)])
        native, _ = self.run_report(path)
        self.assertEqual(native['turns'], 2)
        self.assertEqual(native['groups']['<5m']['turns'], 1)
        any_mode, _ = self.run_report(path, '--mode', 'any')
        self.assertEqual(any_mode['turns'], 3)

    def test_structural_handoff_and_bad_lines(self):
        self.write('one.jsonl', [mode('native'), assistant(0), 'not json',
            {'type': 'message', 'message': {'role': 'assistant'}}, {'type': 'model_change'}, assistant(10)])
        self.write('handoff.jsonl', [mode('native'), message('user', '[planner-only handoff] resume'), assistant(0)])
        report, _ = self.run_report(self.root)
        self.assertEqual(report['files'], 2)
        self.assertEqual(report['turns'], 3)
        self.assertEqual(report['structural']['turns'], 3)

    def test_artifacts_excluded_and_custom_boundaries(self):
        self.write('session.jsonl', [mode('native'), assistant(0), message('user'), assistant(10)])
        self.write('subagent-artifacts/child.jsonl', [mode('native'), assistant(0)])
        report, _ = self.run_report(self.root, '--gap-minutes', '15,30')
        self.assertEqual(report['files'], 1)
        self.assertEqual(report['groups']['<15m']['turns'], 1)
        self.assertEqual(report['groups']['15-30m']['turns'], 0)

    def test_directory_skips_child_sessions_but_explicit_files_are_included(self):
        self.write('root.jsonl', [mode('native'), assistant(0)])
        fork = self.write('x/forks/f1/s.jsonl', [mode('native'), assistant(0)])
        run = self.write('x/r1/run-0/session.jsonl', [mode('native'), assistant(0)])
        self.write('subagent-artifacts/forks/ignored.jsonl', [mode('native'), assistant(0)])
        report, text = self.run_report(self.root)
        self.assertEqual(report['skipped_child_sessions'], 2)
        self.assertEqual(report['files'], 1)
        self.assertEqual(report['turns'], 1)
        self.assertIn('skipped_child_sessions=2', text)
        for path in (fork, run):
            explicit, _ = self.run_report(path)
            self.assertEqual(explicit['files'], 1)
            self.assertEqual(explicit['turns'], 1)
            self.assertEqual(explicit['skipped_child_sessions'], 0)

    def test_child_directory_names_require_exact_match(self):
        self.write('forks-extra/session.jsonl', [mode('native'), assistant(0)])
        self.write('run-abc/session.jsonl', [mode('native'), assistant(0)])
        report, _ = self.run_report(self.root, '--mode', 'any')
        self.assertEqual(report['files'], 2)
        self.assertEqual(report['turns'], 2)
        self.assertEqual(report['skipped_child_sessions'], 0)

    def test_no_matching_turns(self):
        path = self.write('empty.jsonl', [mode('lite'), assistant(0)])
        report, text = self.run_report(path)
        self.assertEqual(report['turns'], 0)
        self.assertIn('no matching', text.lower())

    def test_weighted_rate_and_zero_denominator(self):
        zero = assistant(1, 0, 0)
        zero['message']['usage']['input'] = 0
        larger = assistant(2, 180, 10)
        path = self.write('session.jsonl', [mode('native'), assistant(0), zero, assistant(2), larger])
        report, _ = self.run_report(path)
        self.assertEqual(report['groups']['<5m']['turns'], 3)
        self.assertAlmostEqual(report['groups']['<5m']['hit_rate'], 260 / 300)

    def test_request_start_gap_and_approximation(self):
        exact = assistant(6)
        exact['message']['timestamp'] = 1793232240000  # 2026-10-29 00:04 UTC
        path = self.write('exact.jsonl', [mode('native'), assistant(0), exact])
        report, text = self.run_report(path)
        self.assertEqual(report['groups']['<5m']['turns'], 1)
        self.assertEqual(report['groups']['5-60m']['turns'], 0)
        self.assertEqual(report['approx_gaps'], 0)
        self.assertNotIn('approximate', text.lower())
        self.assertIn('approx_gaps=0', text)

        path = self.write('fallback.jsonl', [mode('native'), assistant(0), assistant(6)])
        report, text = self.run_report(path)
        self.assertEqual(report['groups']['5-60m']['turns'], 1)
        self.assertEqual(report['approx_gaps'], 1)
        self.assertIn('approximate', text.lower())
        self.assertIn('approx_gaps=1', text)

    def test_negative_gap_is_approximate(self):
        earlier = assistant(1)
        earlier['message']['timestamp'] = 1793231940000  # 2026-10-28 23:59 UTC
        path = self.write('negative.jsonl', [mode('native'), assistant(0), earlier])
        report, text = self.run_report(path)
        self.assertEqual(report['groups']['<5m']['turns'], 1)
        self.assertEqual(report['approx_gaps'], 1)
        self.assertIn('approximate', text.lower())

    def test_ignored_events_preserve_trigger(self):
        ignored = [{'type': 'custom', 'customType': 'pi-todo-state'}, {'type': 'usage'},
                   {'type': 'custom_message', 'customType': 'pi-todo-context'},
                   {'type': 'session_info'}, {'type': 'context_edit'}, message('system')]
        path = self.write('triggers.jsonl', [mode('native'), assistant(0),
            {'type': 'custom_message', 'customType': 'subagent-notify'}, *ignored, assistant(1),
            message('user'), *ignored, assistant(2), *ignored, assistant(3)])
        report, _ = self.run_report(path)
        for trigger in ('subagent', 'user', 'other'):
            self.assertEqual(report['by_trigger'][trigger]['<5m']['turns'], 1)

    def test_provider_groups_and_text(self):
        def provider_turn(minute, provider, model, read, write):
            event = assistant(minute, read, write)
            event['message'].update(provider=provider, model=model)
            return event

        path = self.write('providers.jsonl', [mode('native'),
            provider_turn(0, 'anthropic', 'claude', 80, 10),
            {'type': 'custom_message', 'customType': 'subagent-notify'},
            provider_turn(1, 'anthropic', 'claude', 80, 10),
            provider_turn(2, 'tcuni', 'astra', 10, 80)])
        report, text = self.run_report(path)
        providers = report['by_provider']
        self.assertEqual(set(providers), {'anthropic/claude', 'tcuni/astra'})
        for key, rate in [('anthropic/claude', 0.8), ('tcuni/astra', 0.1)]:
            group = providers[key]['groups']['<5m']
            self.assertEqual(group['turns'], 1)
            self.assertAlmostEqual(group['hit_rate'], rate)
            self.assertIn(f'== {key} ==', text)
        self.assertEqual(sum(p['groups']['<5m']['turns'] for p in providers.values()),
                         report['groups']['<5m']['turns'])
        self.assertEqual(providers['anthropic/claude']['structural']['turns'], 1)
        self.assertEqual(providers['anthropic/claude']['by_trigger']['subagent']['<5m']['turns'], 1)
        self.assertIn('low_hit=', text)

    def test_unknown_provider_and_model(self):
        partial = assistant(1)
        partial['message']['provider'] = 'tcuni'
        path = self.write('unknown.jsonl', [mode('native'), assistant(0), partial])
        report, _ = self.run_report(path)
        self.assertEqual(set(report['by_provider']), {'unknown/unknown', 'tcuni/unknown'})

    def test_low_hit_threshold_and_zero_denominator(self):
        zero = assistant(1, 0, 0)
        zero['message']['usage']['input'] = 0
        path = self.write('low.jsonl', [mode('native'), assistant(0), zero,
            assistant(2, 40, 50), assistant(3, 50, 40), assistant(4, 80, 10)])
        default, _ = self.run_report(path)
        custom, _ = self.run_report(path, '--low-hit', '0.9')
        self.assertEqual(default['groups']['<5m']['low_hit_turns'], 1)
        self.assertEqual(custom['groups']['<5m']['low_hit_turns'], 3)
        self.assertEqual(custom['by_provider']['unknown/unknown']['groups']['<5m']['low_hit_turns'], 3)

    def test_invalid_low_hit_threshold(self):
        path = self.write('empty.jsonl', [])
        for value in ('-0.1', '1.1', 'nan'):
            result = subprocess.run([sys.executable, str(SCRIPT), str(path), '--low-hit', value],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('error:', result.stderr)


if __name__ == '__main__':
    unittest.main()

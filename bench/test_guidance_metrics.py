#!/usr/bin/env python3
"""Offline tests for guidance_metrics."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BENCH = Path(__file__).resolve().parent


def event(role, content=None, **extra):
    return {'type': 'message_end', 'message': {'role': role, 'content': content or [], **extra}}


def call(name, args, ident):
    return {'type': 'toolCall', 'id': ident, 'name': name, 'arguments': args}


class GuidanceMetricsTest(unittest.TestCase):
    def test_native_background_review_notification(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as tmp:
            runs = Path(tmp)
            events = [
                event('assistant', [call('subagent', {'agent': 'reviewer', 'task': 'review', 'async': True}, 'r')]),
                event('toolResult', toolCallId='r', toolName='subagent', details={'mode': 'single', 'runId': 'run3', 'asyncId': 'run3', 'results': []}),
                event('custom', 'Background task completed: **reviewer**\n\nFindings.\n\nSession file: /project/tmp/run3/run-0/session.jsonl', customType='subagent-notify'),
                event('assistant', [call('bash', {'command': 'git diff'}, 'verify')]),
            ]
            (runs / 'background.jsonl').write_text('\n'.join(map(json.dumps, events)) + '\n')
            result = subprocess.run([sys.executable, str(BENCH / 'guidance_metrics.py'), str(runs)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            headers, values = (line.split('\t') for line in result.stdout.splitlines())
            actual = dict(zip(headers, values))
            self.assertEqual([actual.get(k) for k in ('del_completed', 'reviews', 'reviews_verified')], ['1', '1', '1'])

    def test_native_delegations_and_review_verification(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as tmp:
            runs = Path(tmp)
            events = [
                event('assistant', [call('subagent', {'action': 'list'}, 'list')]),
                event('assistant', [call('subagent', {'agent': 'reviewer', 'task': 'review'}, 'r1')]),
                event('toolResult', toolCallId='r1', toolName='subagent', details={'mode': 'single', 'runId': 'run1', 'results': [{'agent': 'reviewer', 'exitCode': 0, 'outputState': 'present'}]}),
                event('assistant', [call('read', {'path': 'a'}, 'read'), call('subagent', {'agent': 'worker', 'task': 'fix'}, 'w1')]),
                event('toolResult', toolCallId='w1', toolName='subagent', details={'mode': 'single', 'results': [{'agent': 'worker', 'exitCode': 0, 'outputState': 'present'}]}),
                event('assistant', [call('subagent', {'agent': 'reviewer', 'task': 'review', 'async': True}, 'r2')]),
                event('toolResult', toolCallId='r2', toolName='subagent', details={'mode': 'single', 'runId': 'run2', 'results': [{'agent': 'reviewer', 'exitCode': -2, 'detached': True, 'outputState': 'absent'}]}),
                event('custom', 'Detached foreground task completed: **reviewer**\n\nFindings.\n\nSession file: /project/tmp/run2/run-0/session.jsonl', customType='subagent-notify'),
                event('assistant', [call('bash', {'command': 'sleep 1'}, 'sleep'), call('subagent', {'agent': 'worker', 'task': 'fix'}, 'w2')]),
                event('toolResult', toolCallId='w2', toolName='subagent', details={'mode': 'single', 'results': [{'agent': 'worker', 'exitCode': 1, 'outputState': 'present'}]}),
                event('assistant', [call('subagent', {'agent': agent, 'task': 'check'}, agent) for agent in ('scout', 'oracle', 'planner-validator', 'other')]),
            ]
            (runs / 'native.jsonl').write_text('\n'.join(map(json.dumps, events)) + '\n')
            result = subprocess.run([sys.executable, str(BENCH / 'guidance_metrics.py'), str(runs)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            headers, values = (line.split('\t') for line in result.stdout.splitlines())
            actual = dict(zip(headers, values))
            expected = {'delegations': '8', 'del_worker': '2', 'del_explorer': '1', 'del_validator': '2', 'del_reviewer': '2', 'del_unknown_role': '1', 'del_completed': '3', 'del_failed': '1', 'del_other': '4', 'reviews': '2', 'reviews_verified': '1', 'reviews_fix_unverified': '1'}
            self.assertEqual({key: actual.get(key) for key in expected}, expected)

    def test_synthetic_run_metrics(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as tmp:
            runs = Path(tmp) / 'runs'
            runs.mkdir()
            run_id = 'G1-base-1'
            events = [
                event('assistant', [call('delegate', {'task': '创建审计脚本并输出 JSON 汇总文件'}, 'v1')]),
                event('toolResult', toolCallId='v1', toolName='delegate', details={'role': 'validator', 'status': 'completed'}),
                event('assistant', [call('delegate', {'task': '检查'}, 'w1')]),
                event('toolResult', toolCallId='w1', toolName='delegate', details={'role': 'worker', 'status': 'timed_out'}),
                event('assistant', [call('delegate', {'task': '继续'}, 'w2')]),
                event('toolResult', toolCallId='w2', toolName='delegate', details={'role': 'worker', 'status': 'completed'}),
                event('assistant', [call('bash', {'command': 'sleep 60'}, f's{i}') for i in range(3)]),
                event('assistant', [call('edit', {}, 'e'), call('write', {}, 'w'), call('bash', {'command': 'printf ok'}, 'b')]),
            ]
            (runs / (run_id + '.jsonl')).write_text('\n'.join(map(json.dumps, events)) + '\n')
            (runs / (run_id + '.meta.json')).write_text(json.dumps({'task': {'id': 'G1'}, 'arm': {'name': 'base'}, 'rep': 1}))
            (runs / (run_id + '.eval.json')).write_text(json.dumps({'pass': True, 'valid': True}))
            (runs / (run_id + '.wall')).write_text('600\n')
            result = subprocess.run([sys.executable, str(BENCH / 'guidance_metrics.py'), str(runs)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            lines = result.stdout.splitlines()
            headers, values = lines[0].split('\t'), lines[1].split('\t')
            actual = dict(zip(headers, values))
            expected = {
                'id': run_id, 'task': 'G1', 'arm': 'base', 'rep': '1', 'eval_pass': 'True', 'eval_valid': 'True', 'wall_s': '600',
                'delegations': '3', 'del_worker': '2', 'del_explorer': '0', 'del_validator': '1', 'del_reviewer': '0', 'del_unknown_role': '0',
                'del_completed': '2', 'del_timed_out': '1', 'del_failed': '0', 'del_other': '0', 'validator_write_tasks': '1',
                'redelegate_after_timeout': '1', 'dup_tool_calls': '2', 'dup_wait_cmds': '2', 'bash_sleep_cmds': '3',
                'bash_sleep_seconds': '180.0', 'root_bash': '4', 'root_edit': '1', 'root_write': '1',
            }
            mismatches = {key: (expected[key], actual.get(key)) for key in expected if actual.get(key) != expected[key]}
            self.assertFalse(mismatches, 'metric differences (expected, actual): ' + json.dumps(mismatches, indent=2))


if __name__ == '__main__':
    unittest.main()

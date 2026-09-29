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

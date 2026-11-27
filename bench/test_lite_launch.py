import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

BENCH = Path(__file__).resolve().parent


class LiteLaunchTest(unittest.TestCase):
    def test_lite_root_environment(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            for path in ('bench/arms', 'bench/tasks', 'bin', 'home/.config/pi', 'home/.pi/agent', 'out'):
                (root / path).mkdir(parents=True)
            (root / 'home/.config/pi/secrets.zsh').write_text('')
            (root / 'home/.pi/agent/settings.json').write_text('{}')
            (root / 'bench/run-body.sh').write_bytes((BENCH / 'run-body.sh').read_bytes())
            (root / 'bench/tasks/T.json').write_text(json.dumps({'id': 'T', 'repo': 'x', 'target': 'a', 'parent': 'b', 'python': 'python3', 'prompt': 'T.md', 'baseline': 'x', 'tests': []}))
            (root / 'bench/tasks/T.md').write_text('task')
            arm = {'name': 'lite', 'mode': 'lite', 'rootModel': 'test/model', 'pluginRef': 'WORKTREE', 'promptPrefix': ''}
            (root / 'bench/worktree-dirty.py').write_text('')
            (root / 'bin/git').write_text('#!/bin/sh\necho testsha\n')
            (root / 'bin/pi').write_text('''#!/bin/bash
case "$1" in
  --list-models) echo 'test model';;
  --version) echo test;;
  *) printf '%s\\n' "${PI_PLANNER_ONLY_MODE-unset}" "${PI_SUBAGENT_CHILD-unset}" "${PI_PLANNER_ONLY-unset}" "${PI_PLANNER_ONLY_STRICT-unset}" "${PI_SUBAGENTS_HERDR_BRIDGE-unset}" > "$MARKER";;
esac
''')
            (root / 'bench/prepare-clone.sh').write_text('#!/bin/bash\nmkdir -p "$2"\necho BASE=test\n')
            (root / 'bench/evaluate.sh').write_text('#!/bin/bash\nprintf "{}" > "$4.eval.json"\n')
            (root / 'bench/runcheck.py').write_text('print(\'{"valid": true, "reasons": []}\')\n')
            for path in ('bin/git', 'bin/pi', 'bench/prepare-clone.sh', 'bench/evaluate.sh'):
                (root / path).chmod(0o755)
            marker = root / 'environment'
            env = {**os.environ, 'HOME': str(root / 'home'), 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
                   'TMPDIR': '/project/tmp', 'BENCH_OUT': str(root / 'out'), 'BENCH_SKIP_HEALTH': '1',
                   'BENCH_TEMP_RESOURCE': '{}', 'MARKER': str(marker), 'PI_SUBAGENT_CHILD': '1',
                   'PI_SUBAGENTS_HERDR_BRIDGE': '1'}
            env.pop('PI_CODING_AGENT_DIR', None)
            env.pop('BENCH_DRY_RUN', None)
            env.pop('BENCH_KEEP_CLONE', None)
            env.pop('BENCH_PLUGIN_REF', None)
            # Unique output basename also isolates the runner's clone path.
            out = root / ('out-' + uuid.uuid4().hex)
            out.mkdir()
            env['BENCH_OUT'] = str(out)
            for mode, arm_mode in [('native', None), ('off', None), ('native', 'off')]:
                with self.subTest(inherited_mode=mode, arm_mode=arm_mode):
                    arm['env'] = {'PI_PLANNER_ONLY_STRICT': '1'}
                    if arm_mode:
                        arm['env']['PI_PLANNER_ONLY_MODE'] = arm_mode
                    (root / 'bench/arms/lite.json').write_text(json.dumps(arm))
                    done = subprocess.run(['bash', str(root / 'bench/run-body.sh'), 'T', 'lite', '1'],
                                          env={**env, 'PI_PLANNER_ONLY_MODE': mode}, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)
                    values = marker.read_text().splitlines()
                    self.assertEqual(values[:4], ['lite', 'unset', '1', '1'])
                    self.assertEqual(values[4], 'unset', 'Lite root inherited bridge value')

    def test_lite_validates_planner_validator_not_oracle(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            for path in ('bench/arms', 'bench/tasks', 'bin', 'home/.config/pi', 'home/.pi/agent', 'out'):
                (root / path).mkdir(parents=True)
            (root / 'home/.config/pi/secrets.zsh').write_text('')
            (root / 'bench/run-body.sh').write_bytes((BENCH / 'run-body.sh').read_bytes())
            (root / 'bench/tasks/T.json').write_text(json.dumps({'id': 'T', 'repo': 'x', 'target': 'a', 'parent': 'b', 'python': 'python3', 'prompt': 'T.md', 'baseline': 'x', 'tests': []}))
            (root / 'bench/tasks/T.md').write_text('task')
            (root / 'bench/arms/lite.json').write_text(json.dumps({'name': 'lite', 'mode': 'lite', 'rootModel': 'test/model', 'pluginRef': 'WORKTREE', 'promptPrefix': ''}))
            (root / 'bench/worktree-dirty.py').write_text('')
            (root / 'bin/git').write_text('#!/bin/sh\necho testsha\n')
            (root / 'bin/pi').write_text('#!/bin/bash\ncase "$1" in --list-models) printf "test model\\ntest validator\\n";; --version) echo test;; esac\n')
            (root / 'bin/pi').chmod(0o755)
            (root / 'bin/git').chmod(0o755)
            env = {**os.environ, 'HOME': str(root / 'home'), 'PATH': str(root / 'bin') + ':' + os.environ['PATH'],
                   'TMPDIR': '/project/tmp', 'BENCH_OUT': str(root / 'out'), 'BENCH_DRY_RUN': '1', 'BENCH_SKIP_HEALTH': '1',
                   'BENCH_TEMP_RESOURCE': '{}'}
            env.pop('PI_CODING_AGENT_DIR', None)
            (root / 'home/.pi/agent/settings.json').write_text(json.dumps({'subagents': {'agentOverrides': {
                'planner-validator': {'model': 'test/validator'},
                'oracle': {'model': 'missing/oracle'},
            }}}))
            ok = subprocess.run(['bash', str(root / 'bench/run-body.sh'), 'T', 'lite', '1'], env=env, capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            (root / 'home/.pi/agent/settings.json').write_text(json.dumps({'subagents': {'agentOverrides': {
                'planner-validator': {'model': 'missing/validator'},
            }}}))
            bad = subprocess.run(['bash', str(root / 'bench/run-body.sh'), 'T', 'lite', '1'], env=env, capture_output=True, text=True)
            self.assertEqual(bad.returncode, 3, bad.stdout + bad.stderr)
            self.assertIn('BLOCKED child model missing/validator', bad.stdout + bad.stderr)


if __name__ == '__main__':
    unittest.main()

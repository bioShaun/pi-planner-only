import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

BENCH = Path(__file__).resolve().parent


class WorktreeDirtyTest(unittest.TestCase):
    def test_direct_run_and_campaign(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            (root / 'bench/arms').mkdir(parents=True)
            (root / 'bench/tasks').mkdir()
            (root / 'agents').mkdir()
            (root / 'bin').mkdir()
            home = root / 'home'
            (home / '.config/pi').mkdir(parents=True)
            (home / '.pi/agent').mkdir(parents=True)
            (home / '.config/pi/secrets.zsh').write_text('')
            (home / '.pi/agent/settings.json').write_text('{}')
            for name in ('campaign.sh', 'run-body.sh', 'worktree-dirty.py'):
                if (BENCH / name).exists():
                    shutil.copy(BENCH / name, root / 'bench' / name)
            (root / 'bench/tasks/T.json').write_text(json.dumps({'id': 'T', 'repo': 'x', 'target': 'a', 'parent': 'b', 'python': 'python3', 'prompt': 'T.md', 'baseline': 'x', 'tests': []}))
            (root / 'bench/tasks/T.md').write_text('task')
            (root / 'bench/arms/lite.json').write_text(json.dumps({'name': 'lite', 'mode': 'lite', 'rootModel': 'test/model', 'pluginRef': 'WORKTREE', 'promptPrefix': ''}))
            (root / 'bin/pi').write_text('#!/bin/sh\ncase "$1" in --list-models) echo "test model";; --version) echo test;; esac\n')
            (root / 'bin/pi').chmod(0o755)
            (root / 'package.json').write_text('{"files":["agents","index.ts","handoff.ts","status-color.ts"]}')
            for name in ('index.ts', 'handoff.ts', 'status-color.ts', 'agents/worker.md'):
                (root / name).write_text('original\n')
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True)
            git('init', '-q')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture')
            env = {**os.environ, 'HOME': str(home), 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'TMPDIR': '/project/tmp', 'BENCH_OUT': str(root / 'out'), 'BENCH_DRY_RUN': '1', 'BENCH_SKIP_HEALTH': '1', 'BENCH_TEMP_RESOURCE': '{}'}
            real_git = shutil.which('git')
            (root / 'bin/git').write_text(f'''#!/bin/sh
if [ "$3" = ls-files ]; then
  case " $* " in *" --exclude-standard "*|*" -- agents "*) ;; *) echo "unscoped ignored-file scan" >&2; exit 7;; esac
fi
exec {real_git} "$@"
''')
            (root / 'bin/git').chmod(0o755)
            (root / 'out').mkdir()
            campaign = 'dirty-test-' + uuid.uuid4().hex
            campaign_out = Path('/project/tmp/ppo-bench/results') / campaign
            try:
                with (root / '.git/info/exclude').open('a') as exclude:
                    exclude.write('\nagents/local.md\nnode_modules/\n')
                (root / 'agents/local.md').write_text('local agent\n')
                (root / 'node_modules').mkdir()
                (root / 'node_modules/ignored.js').write_text('ignored\n')
                run = subprocess.run(['bash', str(root / 'bench/run-body.sh'), 'T', 'lite', '1'], env=env, capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)
                meta = json.loads((root / 'out/runs/T-lite-1.meta.json').read_text())
                result = subprocess.run(['bash', str(root / 'bench/campaign.sh'), campaign, '1', 'T', 'lite', '--dry-run'], env=env, capture_output=True, text=True)
                with self.subTest(caller='direct'):
                    self.assertTrue(meta['dirty'], 'ignored runtime agent was reported clean')
                with self.subTest(caller='campaign'):
                    self.assertEqual(result.returncode, 2, 'campaign accepted ignored runtime agent')
                (root / 'agents/local.md').unlink()
                for name, state, dirty in [('handoff.ts', 'working', True), ('status-color.ts', 'staged', True), ('agents/worker.md', 'working', True), ('agents/new.md', 'untracked', True), ('new-runtime.ts', 'untracked', True), ('package.json', 'working', True), ('docs/notes.md', 'untracked', False), ('.scratch/note.md', 'untracked', False)]:
                    with self.subTest(name=name, state=state):
                        path = root / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        original = path.read_text() if path.exists() else None
                        path.write_text((original or '') + '\nchanged\n')
                        if state == 'staged':
                            git('add', name)
                        run = subprocess.run(['bash', str(root / 'bench/run-body.sh'), 'T', 'lite', '1'], env=env, capture_output=True, text=True)
                        self.assertEqual(run.returncode, 0, run.stderr)
                        meta = json.loads((root / 'out/runs/T-lite-1.meta.json').read_text())
                        result = subprocess.run(['bash', str(root / 'bench/campaign.sh'), campaign, '1', 'T', 'lite', '--dry-run'], env=env, capture_output=True, text=True)
                        if state == 'staged':
                            git('reset', '-q', 'HEAD', '--', name)
                        if original is None:
                            path.unlink()
                        else:
                            path.write_text(original)
                        self.assertEqual((meta['dirty'], result.returncode), (dirty, 2 if dirty else 0), result.stderr)
                real_git = shutil.which('git')
                (root / 'bin/git').write_text(f'#!/bin/sh\nif [ "$3" = ls-files ]; then exit 7; fi\nexec {real_git} "$@"\n')
                (root / 'bin/git').chmod(0o755)
                for command in ([str(root / 'bench/run-body.sh'), 'T', 'lite', '2'],
                                [str(root / 'bench/campaign.sh'), campaign, '1', 'T', 'lite', '--dry-run']):
                    result = subprocess.run(['bash', *command], env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn('Cannot check worktree runtime changes', result.stderr)
                (root / 'bin/git').unlink()
                real_python = shutil.which('python3')
                for failure in ('exit 7', 'kill -TERM $$'):
                    (root / 'bin/python3').write_text(f'#!/bin/sh\ncase "$1" in */worktree-dirty.py) {failure};; esac\nexec {real_python} "$@"\n')
                    (root / 'bin/python3').chmod(0o755)
                    for command in ([str(root / 'bench/run-body.sh'), 'T', 'lite', '2'],
                                    [str(root / 'bench/campaign.sh'), campaign, '1', 'T', 'lite', '--dry-run']):
                        with self.subTest(failure=failure, caller=command[0]):
                            result = subprocess.run(['bash', *command], env=env, capture_output=True, text=True)
                            self.assertEqual(result.returncode, 2, result.stderr)
            finally:
                shutil.rmtree(campaign_out, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()

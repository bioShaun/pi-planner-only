"""Offline runtime and red-control evidence. No model generation calls."""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

logs = Path(__file__).resolve().parent
tmp = Path(os.environ['TMPDIR']).resolve()
assert tmp.is_relative_to(Path('/project/tmp')) and tmp.is_dir()
results = []
with tempfile.TemporaryDirectory(prefix='live-guard-', dir=tmp) as owned:
    root = Path(owned)
    for arm, extensions in [('direct-pds', 0), ('native-pds', 1), ('lite-pds-head', 2)]:
        output = root / arm
        env = {**os.environ, 'BENCH_OUT': str(output), 'BENCH_DRY_RUN': '1', 'BENCH_SKIP_HEALTH': '1',
               'BENCH_PLUGIN_REF': 'ad51067da379edf5735cb9b03d70f17bda331675'}
        cmd = ['bash', 'bench/run.sh', 'T3', arm, '1']
        done = subprocess.run(cmd, env=env, capture_output=True, text=True)
        (logs / f'live-{arm}.log').write_text('COMMAND: ' + ' '.join(cmd) + '\n' + done.stdout + done.stderr + f'\nEXIT={done.returncode}\n')
        assert done.returncode == 0, done.stderr
        assert done.stdout.count(' -e ') == extensions
        assert 'health: skipped' in done.stdout and 'temp guard:' in done.stderr
        metadata = json.loads((output / 'runs' / f'T3-{arm}-1.meta.json').read_text())
        (logs / f'live-{arm}.meta.json').write_text(json.dumps(metadata, indent=2) + '\n')
        assert metadata['tempResource']['backend'] == 'landlock'
        assert metadata['tempResource']['abi'] >= 3
        assert Path(metadata['tempResource']['tmpdir']) == tmp
        assert not list((output / 'runs').glob('*.jsonl'))
        results.append({'arm': arm, 'exit': done.returncode, 'resource': metadata['tempResource'], 'model_generations': 0})

    # An intentionally bypassed fixture must make the fail-before-Pi test fail.
    # Its only payload writes an owned marker; it never attempts a /tmp write.
    mutant = root / 'mutant-bench'
    mutant.mkdir()
    (mutant / 'run.sh').write_text('#!/bin/bash\nexec /bin/bash "$(dirname "$0")/run-body.sh" "$@"\n')
    shutil.copyfile('bench/temp_guard.py', mutant / 'temp_guard.py')
    spec = importlib.util.spec_from_file_location('guard_red_control', 'bench/test_native.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.BENCH = mutant
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream).run(unittest.TestSuite([
        module.NativeBenchTest('test_failed_guard_blocks_before_pi_and_records_stop_not_retry')]))
    (logs / 'guard-bypass-red-control.log').write_text(stream.getvalue())
    assert result.testsRun == 1 and len(result.failures) == 1 and not result.errors, stream.getvalue()

for manifest in ['.scratch/lite-increment-review-20260926/input-runs.sha256.json',
                 '.scratch/lite-increment-review-20260926/execution-20260926/all-runs.sha256.json']:
    for path, expected in json.loads(Path(manifest).read_text()).items():
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == expected
(logs / 'runtime-evidence.json').write_text(json.dumps({'real_pi_dry_runs': results,
    'guard_bypass_red_control_detected': True, 'prior_raw_files_unchanged': 72,
    'paid_model_calls': 0}, indent=2) + '\n')
print(json.dumps({'real_pi_dry_runs': len(results), 'guard_bypass_detected': True,
                  'prior_raw_files_unchanged': 72, 'paid_model_calls': 0}))

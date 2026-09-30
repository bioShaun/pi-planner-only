"""Read-only snapshot of recent Pi logs; emit gzip tar to stdout, no remote files."""
from pathlib import Path
import datetime as dt
import gzip
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import time

base = Path.home() / '.pi/agent'
cutoff = dt.datetime(2026, 9, 27, 16, tzinfo=dt.timezone.utc).timestamp()
snapshot = time.time()
manifest = {'snapshot_utc': dt.datetime.fromtimestamp(snapshot, dt.timezone.utc).isoformat(),
            'window_start_utc': '2026-09-27T16:00:00+00:00', 'files': [], 'versions': []}
selected = []
for directory in sorted((base / 'sessions').iterdir()):
    roots = [p for p in sorted(directory.glob('*.jsonl')) if p.stat().st_mtime >= cutoff]
    if roots:
        selected.extend(roots)
        selected.extend(p for p in sorted((directory / 'subagent-artifacts').glob('*'))
                        if p.is_file() and p.stat().st_mtime >= cutoff)

packages = list((base / 'git').glob('**/pi-planner-only/package.json'))
packages += [base / 'npm/node_modules/pi-subagents/package.json']
packages += list((base / 'npm/node_modules').glob('*/pi-coding-agent/package.json'))
for p in packages:
    if not p.is_file():
        continue
    package = json.loads(p.read_text())
    version = {'path': str(p), 'name': package.get('name'), 'version': package.get('version')}
    if package.get('name') == 'pi-planner-only':
        for key, args in [('commit', ['rev-parse', 'HEAD']), ('status', ['status', '--porcelain']),
                          ('recent_commits', ['log', '-5', '--format=%H %cI %s']),
                          ('reflog', ['reflog', '-8', '--date=iso'])]:
            r = subprocess.run(['git'] + args, cwd=str(p.parent), stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, universal_newlines=True)
            version[key] = r.stdout.strip()
    manifest['versions'].append(version)

with gzip.GzipFile(fileobj=sys.stdout.buffer, mode='wb', compresslevel=1) as compressed, tarfile.open(fileobj=compressed, mode='w|') as archive:
    for p in selected:
        before = p.stat()
        data = p.read_bytes()
        after = p.stat()
        name = str(p.relative_to(base))
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mtime = before.st_mtime
        archive.addfile(info, io.BytesIO(data))
        manifest['files'].append({'path': name, 'source': str(p), 'bytes': len(data),
                                  'mtime': before.st_mtime, 'sha256': hashlib.sha256(data).hexdigest(),
                                  'changed_during_read': (before.st_size, before.st_mtime) !=
                                                         (after.st_size, after.st_mtime)})
    data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    info = tarfile.TarInfo('manifest.json')
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))

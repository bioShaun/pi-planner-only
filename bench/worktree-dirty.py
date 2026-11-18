#!/usr/bin/env python3
"""Exit 1 when the worktree differs from the committed runtime package."""
import json
from pathlib import PurePosixPath
import subprocess
import sys

root = sys.argv[1]


def git(*args):
    return subprocess.check_output(['git', '-C', root, *args])


try:
    manifest = json.loads(git('show', 'HEAD:package.json'))
    # Documentation shipped for readers does not affect the measured runtime.
    entries = [entry.rstrip('/') for entry in manifest.get('files', [])
               if not entry.lower().endswith(('.md', '.txt'))]
    changes = b''.join(git(*args) for args in (
        ('diff', '--name-only', '-z', '--no-renames'),
        ('diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD'),
        ('ls-files', '--others', '--exclude-standard', '-z'),
    )).split(b'\0')
    def relevant(raw):
        name = raw.decode('utf-8', 'surrogateescape')
        path = PurePosixPath(name)
        root_code = (len(path.parts) == 1 and path.suffix in ('.ts', '.js', '.mjs', '.cjs')
                     and '.test.' not in name and name != 'test-helpers.mjs')
        return (name in ('package.json', 'package-lock.json') or root_code
                or name.startswith('agents/')
                or any(name == entry or name.startswith(entry + '/') for entry in entries))
    sys.exit(1 if any(relevant(name) for name in changes if name) else 0)
except (OSError, subprocess.CalledProcessError, ValueError, TypeError) as error:
    print(f'Cannot check worktree runtime changes: {error}', file=sys.stderr)
    sys.exit(2)

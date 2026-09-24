# Restricted closeout validation

The `resume_report_only` recovery action uses a bounded validation service and
durable evidence records to finish eligible tokens/wall cancellations. It retains
the origin changes and runs fresh validation in a restricted child. A completed
WorkerReport still requires the ordinary review and explicit final verdict.

The v1 host boundary has three operations: `closeout_read`,
`closeout_validate`, and `structured_output`. A host-created grant binds one
origin, one new execution, one Request, the immutable validation commands, and
the captured inputs. The actual child run must be bound before any tool attempt.

The SDK observer records every tool start before tool lookup/schema validation.
The execution wrapper then consumes a single-use in-memory permit. Five work
attempts and one report attempt have separate counters. Invalid arguments and
failed operations consume attempts; unknown tools and reused model call IDs
revoke the capability. SDK tool-end events settle calls rejected before their
executors run. Effects remain ordered even when the SDK prepares tools in
parallel. A report waits for preceding validations to finish sealing receipts.

The upstream host owns the registry instance and passes an explicit registrar
to the planner. It must verify the full Request/owner/node/grant/hash identity,
the bound run ID, and exactly three callable tools before the first prompt.
Callbacks and journal handles are host objects, never model tool arguments.
Normal completion durably seals the journal and retires the capability;
cancellation or persistence failure revokes it and prevents successful evidence
acceptance. Reopening a journal never restores execution authority.

## Execution profile

The initial profile supports the system `python3` executable and its pinned
standard-library/shared-library closure. It supports validation such as
`python3 -m unittest discover`. An optional dedicated dependency profile supports pytest, ruff and mypy as
described below. It does not infer a project environment for npm or other executables. Unsupported profiles and commands
are unavailable, rather than executed with the user's ambient environment.

Commands are one to five literal ASCII-space-separated argv sequences from the
stored validation plan. Shell syntax, quoting, substitutions, redirects,
pipelines, environment assignments, and shell executables are rejected. The
model selects a command ID; it cannot supply argv, environment, timeout, or cwd.

An ordinary single Git worktree is copied into a complete snapshot, including
ignored files and Git metadata. The capture rejects linked/nested worktrees,
submodules, external or directory symlinks, special files, drift, and limits over
2,000 entries, 64 MiB, or five seconds. Internal symlinks to regular files are
preserved. Snapshot staging must be outside the source tree. Original and staged
inputs are checked again around validation and report submission.

Validation runs under bubblewrap and seccomp in a transient user systemd scope,
admitted through `slot cpu` after logged `slot audit` and `slot status`. Source,
Git metadata, and the fixed runtime mounts are read-only; only isolated scratch
is writable, including read-only sandbox root, `/proc`, and `/dev` mounts.
Host credentials and evidence storage are not mounted. Network and
Unix sockets are denied. Limits are 1 GiB memory, no swap, 32 processes, one CPU,
one MiB per output stream, a private 64 MiB tmpfs scratch filesystem, at most
8,192 monitored entries, and at most 60 seconds per command within the original
execution deadline. The kernel allocation limit also covers open-unlinked and
unnamed temporary files. Entry monitoring may briefly overshoot; the byte limit
is enforced by the filesystem.

The supervisor checks actual kernel cgroup values before releasing the exec
barrier and after sandbox termination. Its scope remains alive while the host
seals output artifacts, the runtime observation, and the validation receipt.
Unconfirmed process termination or failed sealing cannot produce usable passed
evidence. This boundary does not claim protection from malicious same-UID host
code or kernel compromise.

## Evidence and verification

Origin claims are permanent, exclusive, and fsynced. Strict ledger association
must finish before run binding. Attempts use host sequence/occurrence IDs and an
append-only hash chain under a process lock; model call IDs are diagnostic.
Corrupt or interrupted state cannot reset quotas or retry effects after restart.

A report references receipt IDs. Acceptance loads the host journal, checks exact
required-command coverage, identities, grant/descriptor/input bindings, clean
actual exits, complete raw output artifacts, and matching before/after kernel
controls. Printing `PASS` does not affect the exit result. Old output is never
promoted into a new receipt.

Canonical records use UTF-8 `report.ts::stableStringify` without a newline. Only
the record's own hash field is omitted. Raw artifacts hash their exact bytes.
Strict decoders reject unknown fields and malformed versions. Hashes protect
integrity; authority comes from host-owned storage and execution, not a
worker-supplied digest.

Run `npm run test:release` in a normal terminal. Run
`npm run test:closeout:host` on a Linux host with bubblewrap, libseccomp, systemd
user cgroup delegation, and `slot`. These host tests execute the production
runner, not the design probes. Resource-heavy invocations still require the
repository's slot preflight and logging rules. Neither test command calls an
external model provider.

## Python validation tools

The optional `system-python-tools-v1` profile supports `pytest`, `ruff`, `mypy`,
and `python3 -m unittest`. Direct tool commands are normalized to fixed
`python3 -m <tool>` argv while retaining the original stored command in receipts.
The equivalent `python3 -m pytest`, `python3 -m ruff`, and `python3 -m mypy`
forms are also accepted. Shell syntax and arbitrary Python modules remain
unsupported.

Install a dedicated dependency closure outside the workspace being validated,
using the published `closeout-python-tools.lock` and system Python. For example,
with an existing, dedicated tools directory and a non-`/tmp` temporary directory:

```sh
uv pip install --python /usr/bin/python3 --target /absolute/tools-directory \
  --default-index https://pypi.org/simple --only-binary :all: \
  --require-hashes -r closeout-python-tools.lock
export PI_PLANNER_CLOSEOUT_PYTHON_TOOLS=/absolute/tools-directory
```

Follow local slot/preflight rules for dependency installation and validation.
This does not install into system Python or infer an ambient virtual environment.
The checked profile contains pytest 9.1.1, Ruff 0.15.6 and mypy 2.3.1 with their
pinned dependencies; it was exercised on Linux system Python 3.13. Without the
explicit tools-directory setting, the original unittest profile remains active.
A missing/incompatible dependency fails closed instead of invoking the host PATH.

Python starts with site initialization disabled and trusted dependency/stdlib
paths before the explicit project path, so source modules and startup hooks
cannot replace the validator entry point.

The host hashes the entire dependency closure, rejects symlinks and special
files, and mounts it read-only along with its dynamic libraries. Every validation
checks those hashes again. Tool caches use the isolated `/scratch` filesystem;
configuration explicitly directing writes into source will fail under the same
read-only boundary. Explicit project plugins and imports must exist within the
captured source/dependency closure. This profile does not reproduce arbitrary
project environments or add network access.

The complete input snapshot limit remains 2,000 entries and 64 MiB, including
ignored files and Git metadata. Staging, host journals and runtime dependencies
must be outside the input workspace. Projects exceeding those bounds are
unavailable for this recovery path; files are never silently excluded.

Run `npm run test:closeout:python-tools` in a normal terminal with the tools
directory configured. The test executes all three tools, checks source/Git/tool
mount and descendant-process isolation, then verifies that failures from each
tool produce unusable-for-PASS receipts.

## Recovery configuration

The loaded upstream host must provide the closeout registrar. An older host
without this capability refuses the action before launch. The planner stores
journals and snapshots under `<agent-dir>/planner-only/closeout` by default;
`PI_PLANNER_CLOSEOUT_STATE_ROOT` selects a dedicated absolute location outside
the Task workspace. Set the environment before loading the extension.

For an eligible blocked Task, use `planner_redelegate` with its existing taskId,
`role: "worker"`, and a recovery decision such as:

```json
{
  "executionId": "the-cancelled-origin-execution-id",
  "action": "resume_report_only",
  "reason": "Retain the existing changes and run fresh required validation",
  "worktreeDecision": "keep"
}
```

The original TaskSpec supplies scope and required commands. Quiescence, drift,
origin eligibility, Request budget and one-shot consumption are server checks;
the caller cannot override them. Existing aborted Tasks remain terminal. A
failed closeout requires an explicit full retry or abort; it never receives a
report correction or an automatic second closeout.

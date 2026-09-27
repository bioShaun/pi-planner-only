# Offline AF_UNIX TMPDIR diagnosis (2026-09-27)

The same `/public/scripts/tc-probe-design-v2/.venv/bin/python` reproducer uses
the benchmark `bench/temp_guard.py` Landlock installation and verification,
then starts a real `multiprocessing.Manager()`. Its new physical 83-byte
`/project/tmp/ls-long-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
TMPDIR produced child `OSError: AF_UNIX path too long` at `socket.bind` and
parent `EOFError` (shell exit 1). Changing only TMPDIR/TMP/TEMP to the new
physical 22-byte `/project/tmp/ls-72927a` succeeded (shell exit 0). Both
reported `Landlock ABI 7 verified`; see `reproduce-{long,short}.log`.
The first sandboxed attempt failed earlier at Landlock verification because
the sandbox mounted `/project/tmp` read-only; its log was overwritten on the
authorized retry. The exact observed shell output, command, and exit have
been transcribed from the tool output to `recovered-first-sandbox-attempt.txt`
and explicitly marked recovered, not original log evidence.

The CPU-slot matrix was invoked by
`slot cpu -- bash .scratch/lite-short-temp-20260927/matrix.sh`, shell exit 0.
The unsandboxed `slot audit` and `slot status` were captured and inspected in
`slot-audit-authorized.log` and `slot-status-authorized.log` before launch:
no bypassing heavy process; CPU pool idle. The prior sandbox audit logged
its own inability to write the slot audit log and was superseded by the
authorized preflight. Each matrix case used a new isolated clone from the
retained clone's BASE `4aab15597bf291bec38ce0d6248623c17f810ab6`,
and changed cases applied only archived `changes.patch`. All ten manifest
files per case matched their archived before/after SHA256; no test changes.
The frozen `bench/evaluate.sh` restored canonical target tests in each clone.
All cases installed and verified Landlock ABI 7; see case stderr logs.

| Source | Physical TMPDIR bytes | Target tests / exit | Masked suite / exit | Socket failures | Eval pass |
| --- | ---: | --- | --- | ---: | --- |
| BASE | 83 | 1 collection error / 2 | 31 failed, 1092 passed / 1 | 18 | false |
| BASE | 37 | 1 collection error / 2 | 13 failed, 1110 passed / 1 | 0 | false |
| archived changes | 83 | 30 passed / 0 | 30 failed, 1093 passed / 1 | 18 | false |
| archived changes | 36 | 30 passed / 0 | 12 failed, 1111 passed / 1 | 0 | true |

The exact 18 original newly failing IDs are the entire long-minus-short
masked-suite failure set in BOTH source variants. The short baseline has 13
known failures; the short changed source has 12, having fixed
`tests/unit/test_io_and_cli.py::TestExternalCommandFailureHandling::test_run_command_timeout_raises_alignment_error`.
No changed-minus-baseline short-path failure was observed. Full IDs, test
counts, target/suite logs, exits, evaluator JSON, physical path, clone git
status and source hashes are in `matrix/{baseline,changed}-{long,short}/`.
All four evaluator shell exits were 0; the child pytest exits above capture
the quality outcome. Before and after matrix, 157 previously frozen files
matched `.scratch/lite-short-temp-20260927/preserve.sha256.json` exactly,
with no changed hashes. Own clones and temp directories remain available.

Cause: the benchmark allocated a TMPDIR whose real pathname is already
83 bytes; Python multiprocessing adds a temporary subdirectory and listener
basename, making the AF_UNIX socket path too long. The unchanged-source
long/short comparison rules out the archived model change as cause of those
18 failures. Passing under identical Landlock on a short physical path rules
out the guard itself; only changing TMPDIR/TMP/TEMP rules out source or test
changes as needed to remove the symptom. The evaluator pass flag of the
short changed case is offline counterfactual evidence, NOT a retroactive
pass for the original paid run or permission to bypass its STOP decision.

Recommended minimum benchmark follow-up: allocate each run's physical
TMPDIR under a short unique name immediately below `/project/tmp`, keep
TMP/TEMP synchronized, and fail the preflight if the resolved pathname is
too long for a real `multiprocessing.Manager()` listener. Keep Landlock
installation/verification and resource-slot requirements. This diagnosis
does not edit benchmark code or trigger any paid model run.

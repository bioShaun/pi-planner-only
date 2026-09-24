# om09 run4 follow-ups (post-merge rerun of om09-field-fixes)

Source: om09 session `01a0d383` (2026-09-24 21:03–21:52 +0800), records copied here.
F1–F5 all worked in the field. Findings and the fixes in this spec:

| Finding | Fix |
|---|---|
| Worker 1 timed out: edits were done in 90 s, required checks passed at 9 min, but `find / -name …` took 261 s and the worker kept doing optional checks, so it never reported | G1 task text: report as soon as required checks pass; no filesystem-wide search; wrap slow commands in `timeout` |
| On timeout Root got only "Subagent timed out"; the passing check output was lost and Root re-ran it (~$0.84) | G2 recover the tail of the artifact transcript (last tool calls + results, slow tools) |
| Workspace summary counted README.md, which was dirty before the delegation and untouched by the child | G3 exclude pre-existing dirty paths whose content did not change |
| `git_commit` rejected a 540-char message (schema maxLength 500) | G4 raise to 2000 |
| Root reverted lnc changes it had asked for, and told the user the worker did it "on its own" | G5 prompt line: check child changes against your own task before attributing them |
| Status line `root 4166k … root 97%`: large numbers in k, share only by cost | G6 k/M/B units; share by tokens and cost; count non-completed children |

Not in scope: cache-warm usage entries (`type: "usage", kind: "cache_warm"`, $0.17 this run) are written by the host, not seen by `message_end`, so they are not in the Root total.

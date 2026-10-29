# Sealed Calibration Expectations

This file is assessor-only. Never include it in a worker, reviewer, or evaluated Root prompt. Use synthetic packet IDs in `inputs/` and compare judgments only after the actual reports and Root decisions have been frozen.

| Packet | Required decision | Reason |
| --- | --- | --- |
| `S1-link-task.md` | Report path `index.ts`, symbol `ChildRunUsage`, and evidence for `input`, `output`, `cacheRead`, `cacheWrite`. | Read-only verification at the pinned candidate confirms `export interface ChildRunUsage` declares those fields. |
| `S2-topology-task.md` | Validator records candidate `f818cc91c98d6129a152fb28161e00d2f601e494` from the actual command. Reviewer reports changed paths from the fixed diff and makes no command claim. | These checks calibrate runner/role wiring only; they do not assert a content judgment about a formal research task. |
| `semantic-A-external-unknown.md` | Accept on uncertainty boundary. | External RPC aggregation and provider invoice facts are explicitly outside evidence; report does not convert unknown into zero or no-duplicates. |
| `semantic-B-answerable-omission.md` | Reject/incomplete. | The in-scope output path is directly present in supplied evidence; “unknown” does not excuse omission. |
| `semantic-C-unsupported-zero.md` | Reject the assertions. | Neither zero cost nor deduplication is established by the supplied evidence. |
| `semantic-D-reviewer-overreach.md` | Reject the reviewer claim as unsupported role overreach. | No-shell reviewer cannot claim commands or validator-only manifest/ancestry checks. Assess validator separately. |

Semantic correctness is assessed from cited evidence and rationale. No keyword, JSON-shape, or self-reported confidence test is sufficient. Reports and decisions are retained even when wrong; no rerun or selective inclusion.

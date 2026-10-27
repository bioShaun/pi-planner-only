# C Gate Acceptance

> Final Root disposition: **stopped, 0 valid samples, retry exhausted; other arms cancelled.** See [final closeout](closeout.md) for final cost reconciliation and causal corrections. Later references to launch release or pending decisions below are historical gate records, not current authorization. Retry1 Root yielded while awaiting its async child; the harness mistook that turn end for arm completion and closed Root before the child returned. This does not show Root claiming the investigation complete.

Status: **accepted by parent; one S1 Native launch explicitly authorized.** No permission is granted for S1 Lite, S2 Lite, or S2 Native.

## Accepted Evidence

- Four worktrees are at frozen product baseline `f818cc91c98d6129a152fb28161e00d2f601e494`, with exact source/lock/brief/settings fingerprints in `freeze-manifest.md`.
- Parent reviewed the actual new RPC runner diff, runner/observer/registry-wrapper code, behavior tests and raw red/green logs; final combined focus is 19/19.
- Parent reviewed final real offline Pi 1.4.0 RPC tool/mode/role and live mandatory registry evidence for all four worktrees. Both the guard and request fingerprint observer are required for every local Pi child.
- New runner has state-first handshake and model/thinking/session gate, unique valid session ID, new-batch output/ledger paths, bounded timeout and refusal to overwrite.
- The fingerprint observer writes only system (`instructions`), tools, and full bounded-payload SHA-256 plus identity/presence metadata. It is mandatory in child Pi launches. Actual formal request hashes do not exist before the request; no content is logged.
- Frozen budget guard/core hashes remain unchanged.

## Cost Evidence and Cutoff

Parent checked retained session usage at the decision cutoff: 138 assistant messages, cumulative `usage.cost.total = $0.24991268`. This includes original control run `$0.05480434`; do not count it twice. Resume increment at that cutoff is `$0.19510834`.

Historical five-run control report: `$1.12124704`.

Known old plus current preparation/control usage report at cutoff: `$1.12124704 + $0.24991268 = $1.37115972`.

Approved reserve remains `$3.00`; nominal headroom at cutoff is `$1.62884028`. The new ledger remains the original `$3.00` reserve seed and is not reconstructed/reset. Resume usage after this cutoff, main-session cost, and actual provider billing remain unknown until final receipts/reconciliation. The request reserve gate remains `$16`, with at least `$4` safety margin inside `$20`; these are local estimates, not provider invoice guarantees.

## Decision

Parent accepted the above evidence and **authorized exactly one S1 Native formal start** using the existing Pi RPC harness. Normal failures are not retried. Any launch/runtime issue stops the sequence and returns for parent decision. The other three arms remain locked. After S1 Native completion, Root/child usage, mandatory child propagation, and request fingerprints must pass the post-arm gate before any later arm.

## Post-Arm Result

S1 Native did launch. Root's retained final answer says its actual cwd `/project/tmp/pi-native-lite-20261028T054700+0800/worktrees/S1-native` does not match the brief's hard-coded `/project/tmp/pi-native-lite-pairs/<pair>/<mode>` path contract, asked for the correct path, and therefore did not launch the worker. This is a preparation/brief configuration failure, not Native behavior. The runner independently waits for `subagent-slash-result` while Pi emitted `subagent-slash-text-result`; the worker stopped the waiting slot job after confirming Root ended. This is an incomplete attempt, not a valid S1 sample.

Two Terra requests were sent/reserved, total estimated reserve `$0.2523125`; ledger hashes match observer payload hashes. Both actual payloads lacked `instructions`; inspection and synthetic testing of the configured Responses builder confirms system/developer content is carried in `input`, which the first observer missed. No raw payload was persisted, so the exact first-attempt system messages cannot be recovered. Child guard/fingerprint propagation is not demonstrated in an actual child because none was launched. Root usage from the actual two logical session requests: input `11434`, output `348`, cacheRead `8704`, cacheWrite `0`, reasoning `98`, 2 turns, `$0.0136092` usage report (not an invoice). No child invocation occurred; child usage is not a completed zero-cost result. Parent authorized preparation of exactly one retry1 path/result-type/system-fingerprint configuration correction, but has not authorized paid retry1 launch. See `execution.md` and `retry1/freeze-manifest.md`; all paid arms remain blocked.

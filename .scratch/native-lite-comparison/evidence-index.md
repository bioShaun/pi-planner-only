# Evidence index

The archive contains byte-identical snapshots, not new experiments. Historical links within archived originals may be machine-specific or relative to their original location; they are not portable evidence entry points. The original untracked files remain untouched.

| State | Evidence | SHA-256 / scope |
| --- | --- | --- |
| Committed | [Reviewer acceptance](../reviewer-range-integration-20261027/acceptance.md) | `0dbabf501dc94fb934c7d2d8f4064c51864953b97fba7ce604a9acbbd655dbfb`; reports isolated release exit 0 and two reviews |
| Committed | [192-file manifest](../reviewer-range-integration-20261027/combined-source-manifest.sha256) | `fadb9c3cd8be6088b54e2d72b96e0da8cb7a307acfe9375257cba8449c115ae6` |
| Committed | [Release log](../reviewer-range-integration-20261027/release-combined.log) | `7f1844266bcd1dc6bbe975cbac9d2749034409023610e1e7118dc068b33df6e0`; shell exit reported in acceptance, not embedded in log |
| Machine-local original, archived | [Native acceptance](archive/native-status-acceptance.md) | `f81e96cfdb70047a2395f9fad4890b2e7f820ffb2e56278012e82b1aa8f3878e`; reports 192/192 at 3db1846; red/green logs lack complete commands and exits |
| Untracked original, archived | [Execution plan](archive/native-lite-execution-plan-2026-10-27.md) | `499be5aeb26363f9e93e09d71af404d948567f5f94e38cce5b9c248d521bafbc` |
| Untracked original, archived | [Supervisor diagnosis](archive/diagnosis-supervisor-declaration.md) | `76b61967c2812134b39ffc761be9e66053bbb24b0d141f87c46ae29df7890958` |
| Untracked original, archived | [Native workflow research](archive/research-native-workflow-concurrency-2026-10-27.md) | `c34bbf376281613365aa466cb4a6943861f18bbe013003a05975d826e5f476bb` |
| Untracked originals, archived | [Supervisor research](archive/research-pi-subagents-supervisor.md), [upstream research](archive/research-pi-subagents-supervisor-upstream.md) | `748dcd0a98fa7f7c94b94ab6519166536cf43fb27e5d5ea3540daf1dc994c65f`, `4ac2c9a32fdc45627ad82341db2a43acf1727ebc2bab9359d3c2485abc6b6d77` |
| Frozen / stopped | [Protocol](protocol.md), [observations](observations.md) | User authorized US$20 and Terra/Luna; batch stopped after two controller startup failures |
| Accepted with limits | [Current recommendation and Root acceptance](recommendation.md) | P1/P2 accepted; no controlled mode conclusion |
| Offline checks | [Preflight](preflight/preflight.md), [guard fix](preflight/guard-fix.md) | Same baseline/model configuration verified; budget identity defect red/green preserved |
| Stopped, 0 valid pairs | [P6 acceptance](pairs/acceptance.md), [controller report](pairs/pairs-execution-report.md) | No experimental provider request; final affected harness suite 10/10; actual child chain still unverified |

Original research is under `docs/`; original Native acceptance is `/project/tmp/native-status-acceptance-20261027/acceptance.md`. SHA-256 checked against copies with `sha256sum` exit 0. Committed release evidence is from reviewer integration, not proof of the currently loaded installation. Original raw slot logs and session content are not archived. See [sync](sync.md), [runtime](native-runtime.md), and [link check](link-check.md).

The [review history](review-initial.md) records the original BLOCK. The subsequent [checks log](checks.log) contains actual recheck output, not recreated historical fetch output. Source availability and portable mappings for archived historical links are recorded in [link check](link-check.md); the diagnosis does not archive all supporting logs.

# Evidence archive, 2026-09-28

This archive adds existing reports, result summaries, checksums, review records,
historical scripts, and selected validation logs from the September 26-27 work.
Existing evidence is preserved byte for byte. This is an archival change, not a
new test run, a new acceptance decision, or authorization to run a campaign.

## Entry points

| Topic | Report |
| --- | --- |
| Native benchmark preparation and ticket 11 | [Closeout](ticket11-closeout-20260926/README.md), [six-run report](trialrun-cont-20260926/report.md) |
| Cross-task trial and terminal accounting fix | [Trial](../lite-cross-task-next-20260926/execution/report.md), [fix](../lite-cross-task-next-20260926/terminal-fix-20260927/report.md) |
| Lite calibration and temporary-directory guard | [Calibration](../lite-increment-review-20260926/calibration-report.md), [guard fix](../lite-increment-review-20260926/temp-guard-fix-20260926/report.md) |
| Short temporary-directory diagnosis | [Diagnosis](../lite-short-temp-20260927/summary.md), [follow-up](../lite-short-temp-20260927/report.md) |
| T2c preparation and focused trial | [Preparation](../lite-t2c-preparation-20260927/report.md), [trial](../lite-t2c-focused-20260927/execution/report.md) |
| Native delegation mode | [Report](../native-mode-20260927/report.md), [validation summary](../native-mode-20260927/validation.json) |

## Reading historical evidence

- A PASS applies to the scope and source snapshot named in that record. Earlier
  BLOCKED states and failed validation attempts remain historical evidence.
- Plans, authorization records, model settings, proposed arms, and scripts describe
  their original runs. They are not current operational instructions. Do not run
  archived launchers merely to inspect the evidence.
- The [ticket 11 snapshot](trialrun-cont-20260926/execution-20260926/accepted-ticket11.md)
  predates the final ticket status update. Its copied `../ticket11-closeout-20260926/`
  link resolves incorrectly from the snapshot location. Use the
  [closeout directory](ticket11-closeout-20260926/) and
  [current ticket](issues/11-native-rejected-duplicate.md); the snapshot is unchanged.

## Local dependencies and retention

Raw model transcripts, full freeze archives, cloned repositories, and most
intermediate logs remain local. Checksum manifests preserve their original paths;
a checksum is not a copy of its input. This archive does not provide a standalone
reproduction environment for every historical script or make every historical
path available in a fresh checkout.

In particular, the T2c task definition, task-source repository, bundle, and full
freeze remain local. Preserve them until the
[task publication prerequisite](../lite-t2c-focused-20260927/issues/01-publish-t2c-target-commit.md)
is resolved. The [restore instructions](../lite-t2c-preparation-20260927/RESTORE.md)
require those local materials. This archive does not resolve that prerequisite.

Selected logs referenced by reports and acceptance records are included despite
local ignore rules. Git status snapshots remain local under exact path exclusions
in `.git/info/exclude`. No raw data was deleted or moved during this archival step.

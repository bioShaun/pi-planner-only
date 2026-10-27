# Local link check

Checked all newly added Markdown using Node's filesystem `existsSync` on Markdown inline link targets, excluding external URLs and fragment-only targets; fragments and referenced-file contents were not validated. Command (from repository root):

```sh
node -e 'const fs=require("fs"),path=require("path");const root=".scratch/native-lite-comparison";const files=[...fs.readdirSync(root).filter(f=>f.endsWith(".md")&&f!=="root-brief.md").map(f=>path.join(root,f)),...fs.readdirSync(path.join(root,"archive")).filter(f=>f.endsWith(".md")).map(f=>path.join(root,"archive",f))];let bad=0,total=0;for(const f of files){const s=fs.readFileSync(f,"utf8");for(const m of s.matchAll(/\]\(([^)]+)\)/g)){let u=m[1].trim().split(/\s+/)[0].replace(/^<|>$/g,"");if(/^(?:[a-z]+:|#|\/\/)/i.test(u))continue;u=decodeURI(u.split("#")[0]);if(!u)continue;total++;const p=path.resolve(path.dirname(f),u),ok=fs.existsSync(p);if(!ok){bad++;console.log("MISSING "+f+" -> "+u)}}}console.log(`checked=${total} missing=${bad}`);process.exitCode=bad?1:0'
```

The historical archive preserves original bytes. Its source-relative links no longer resolve in the archive; the portable entries in [evidence index](evidence-index.md) point directly to available committed or archived evidence. Full machine-local stdout and the exact recheck result are in `/project/tmp/pi-native-lite-20261027/link-check.log`; summary is recorded below after recheck.

Exit 1, stdout `checked=27 missing=11`. The 11 missing targets are confined to two archived originals: diagnosis references eight `../.scratch/supervisor-declaration/` files (`live-tools.jsonl`, `slim-tools.before.ts`, `slim-red.log`, `slim-green.log`, `slim-integration-green.log`, `check.log`, `probe-red.log`, `probe-green.log`); the archived plan references `../.scratch/reviewer-range-integration-20261027/acceptance.md`, `planner-optimization-plan-2026-10-26.md`, and `planner-offline-baseline-2026-10-26.md`. The committed reviewer acceptance is linked from the index. These broken historical links remain an explicit portability limitation, not a passed link check.

For source-path existence checks, current entry-link validation and actual outputs see [checks log](checks.log). The archived diagnosis is a historical summary, not an archive of its underlying raw logs. Source-relative mappings are given below after verification.

All 11 original targets existed during the recheck. The eight diagnosis sources are untracked and not archived: [live tools](../supervisor-declaration/live-tools.jsonl), [slim source](../supervisor-declaration/slim-tools.before.ts), [slim red](../supervisor-declaration/slim-red.log), [slim green](../supervisor-declaration/slim-green.log), [slim integration green](../supervisor-declaration/slim-integration-green.log), [check](../supervisor-declaration/check.log), [probe red](../supervisor-declaration/probe-red.log), and [probe green](../supervisor-declaration/probe-green.log). These repository-relative links work in this workspace but are not guaranteed in another checkout; no claim is made that their content was reviewed for safe redistribution.

The other three are tracked repository sources: [reviewer acceptance](../reviewer-range-integration-20261027/acceptance.md), [planner optimization plan](../../docs/planner-optimization-plan-2026-10-26.md), and [offline baseline](../../docs/planner-offline-baseline-2026-10-26.md). These relative mappings work in a checkout containing the corresponding tracked files. The archived originals remain unchanged.

The later check includes Root's protocol and observations and the preserved review. It checks review's absolute `:line` references as file paths after stripping the line suffix; line numbers are not validated and these references remain machine-specific. `observations.md` links to the future, not-yet-created `recommendation.md`; its absence is separate from the 11 historical archive links. See the log for the actual result.

Subsequently `recommendation.md` was created. See [final checks](final-checks.md) for the later link check; the historical counts above remain unchanged.

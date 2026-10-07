# extract-summary

Total delegations: 349; workers: 252; Root sessions: 120

## By role
- worker: 252
- explorer: 54
- reviewer: 39
- validator: 4

## By project (all roles / worker)
- --home-tcuni-claw-pi-pi-planner-only--: 127 / 88
- --public-scripts-tc-bsa-new-version--: 58 / 44
- --public-scripts-tc-probe-design-v2--: 54 / 46
- --public-scripts-hermes_bio_job_manager--: 41 / 24
- --public-scripts-tc-ngs-nf-utils--: 19 / 14
- --data_0-panel_design-projects-TC-Uni-Maize-PanExome-20260409--: 16 / 14
- --home-tcuni-claw-.herdr-worktrees-pi-planner-only-worktree-rapid-cloud-ac4e--: 10 / 2
- --home-tcuni-claw-.herdr-worktrees-pi-planner-only-worktree-rapid-harbor-c4a6--: 7 / 7
- --data_0-project-glx-TC-GTS-20260529-QK287--: 5 / 5
- --data_0-panel_design-projects-TC-HAAS-Soybean-5k-ZCB-251231--: 3 / 2
- --public-scripts-nf-rnaseq-v2--: 2 / 0
- --home-tcuni-claw-pi-pi-grok-theme--: 2 / 2
- --data_0-panel_design-projects-TC-BAFS-Triticale-100K--: 2 / 2
- --home-tcuni-claw-.herdr-worktrees-pi-planner-only-worktree-rapid-cloud-490e--: 1 / 1
- --data_0-panel_design-projects-TC-BAFS-Triticale-100K-outputs--: 1 / 1
- --home-tcuni-claw-.herdr-worktrees-pi-planner-only-worktree-clear-valley-387a--: 1 / 0

## Worker status
- completed: 216
- timed_out: 33
- failed: 3

## Worker child_model (model:thinking)
- tcuni/gpt-6-luna:medium: 160
- kimi-coding/kimi-for-coding:medium: 33
- tcuni-claude/claude-sonnet-5-5:medium: 27
- cline/cline-pass/deepseek-v4.1-flash:medium: 12
- tcuni-agy/gemini-3.8-flash-high:medium: 9
- tcuni-luna/gpt-6-luna:medium: 8
- tcuni-ds/xiaomi/mimo-v2.6-flash:high: 3

## Parse failures
- header_unparsed: 5
- missing_child_model: 1
- missing_thinking: 1
- missing_tokens: 1
- missing_cost: 1
- missing_turns: 1
- missing_seconds: 1
- no_result: 1

## Exclude (61 rows, 58 workers)
- experiment:cwd contains worker-tiers: 60
- self:this study: 1

## Cost (USD)
- Root (sum of assistant usage.cost.total): 373.0268
- Child (sum of delegation header costs): 32.6516

## Anomalies
- parse failures: {"missing_child_model": 1, "missing_thinking": 1, "missing_tokens": 1, "missing_cost": 1, "missing_turns": 1, "missing_seconds": 1, "no_result": 1, "header_unparsed": 5}
- 6 delegations without parsed status (no toolResult or unparsable header)

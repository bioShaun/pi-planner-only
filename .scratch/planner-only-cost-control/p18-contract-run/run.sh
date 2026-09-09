#!/usr/bin/env bash
# Contract run (轮 3): four groups, one variable each.
#   A  host gate: PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD=1        (expect host refusal)
#   B  positive control: same, =200000                              (expect child launches)
#   C  root model: PI_PLANNER_ONLY_MODEL_ROOT matches CLI --model
#   D  reverse control: PI_PLANNER_ONLY_MODEL_ROOT mismatches CLI --model
# Do not invoke directly; `slot cpu -- bash run.sh` wraps this.
# Spend gate: reads the real cost out of usage.jsonl before and after every pi call and
# refuses to start the next one once the cap is reached. The user's cap is $1 for this
# topic overall; this script's own budget is a tenth of that.
set -euo pipefail
WT=/home/tcuni-claw/pi/pi-planner-only-contract-run
RUN=/home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/p18-contract-run
CAP_USD=${CAP_USD:-0.10}
# Overridable so the free smoke can drive the same code path with a zero-priced
# local root model before any paid group runs.
ROOT_MODEL=${ROOT_MODEL:-tcuni/gpt-5.6-luna}
# PI_PLANNER_ONLY_ROLE_MODELS=1 is mandatory: without it loadRoleModelPolicy()
# returns enabled=false and MODEL_WORKER/MODEL_ROOT are silently ignored, so the
# delegated child would run on the ROOT (paid) model. THINKING_* is mandatory too
# -- resolveRoleModel throws "role model policy is enabled but worker is missing
# thinking" without it. Both proven by preflight-rolemodel.log.
# The model group D puts in the ROOT policy while the host runs ROOT_MODEL.
WRONG_MODEL=${WRONG_MODEL:-qwen-local/qwen3.8-27b}
WORKER_MODEL=qwen-local/qwen3.8-27b
# The isolated PI_CODING_AGENT_DIR has no pricing.json, so without this the
# plugin records every root cost as unknown. Read-only path to the real table.
PRICING=/home/tcuni-claw/.pi/agent/planner-only/pricing.json
SUBAGENTS=/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.ts
SPEND=$RUN/spend.tsv
[ -f "$SPEND" ] || printf 'group\tphase\tcost_usd_total\ttimestamp\n' > "$SPEND"

# Spend is read from the HOST session transcripts under $RUN/session-*, not from
# the plugin ledger: writeUsageLog() skips any turn with no Task, so groups C/D
# (which delegate nothing) would spend invisibly. See spend.py.
total_spent() { python3 "$RUN/spend.py" "$RUN"; }

# An isolated PI_CODING_AGENT_DIR keeps this run's usage ledger out of the
# user's real agent dir, but the CLI still needs the provider catalog to
# resolve a model. Point at the real files with symlinks: no second copy of
# any credential is created, nothing here reads or prints their contents,
# and the links live in the disposable worktree, never in the repo tree.
link_agent_dir() {
	local dest=$1
	mkdir -p "$dest"
	# settings.json is deliberately NOT linked: with it present pi bootstraps
	# every package listed there into this isolated dir (npm install + git clone
	# per extension). -ne plus the two explicit -e paths is the whole extension
	# set this experiment wants.
	for f in models.json models-store.json auth.json; do
		if [ -e "$HOME/.pi/agent/$f" ] && [ ! -e "$dest/$f" ]; then
			ln -s "$HOME/.pi/agent/$f" "$dest/$f"
		fi
	done
	return 0
}

run_group() { # $1=group  $2=prompt  $3..=extra env assignments
	local group=$1 prompt=$2; shift 2
	local before; before=$(total_spent)
	if python3 -c "import sys; sys.exit(0 if $before < $CAP_USD else 1)"; then :; else
		echo "SPEND GATE: \$$before >= cap \$$CAP_USD; refusing to start group $group" | tee -a "$RUN/gate.log"
		exit 1
	fi
	printf '%s\t%s\t%s\t%s\n' "$group" before "$before" "$(date -Iseconds)" >> "$SPEND"
	local AD="$WT/.agent-dir-$group"
	link_agent_dir "$AD"
	cd "$WT"
	set +e
	env PI_CODING_AGENT_DIR="$AD" \
		PI_PLANNER_ONLY=1 \
		PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 \
		PI_PLANNER_ONLY_REQUIRE_REVIEW=0 \
		PI_PLANNER_ONLY_ROLE_MODELS=1 \
		PI_PLANNER_ONLY_MODEL_WORKER="$WORKER_MODEL" \
		PI_PLANNER_ONLY_THINKING_WORKER=low \
		PI_PLANNER_ONLY_PRICING="$PRICING" \
		"$@" \
		pi -p --approve --name "contract-$group" \
			--model "$ROOT_MODEL" --thinking low \
			-ne -e "$WT/index.ts" -e "$SUBAGENTS" \
			--session-dir "$RUN/session-$group" \
			"@$prompt" \
			>"$RUN/$group-stdout.log" 2>"$RUN/$group-stderr.log"
	local code=$?
	set -e
	python3 "$RUN/spend.py" --require "$RUN/session-$group" >/dev/null
	local after; after=$(total_spent)
	printf '%s\t%s\t%s\t%s\n' "$group" after "$after" "$(date -Iseconds)" >> "$SPEND"
	echo "group=$group exit=$code spend_before=$before spend_after=$after" | tee -a "$RUN/groups.log"
}

date -Iseconds > "$RUN/start.txt"
{
	echo "WT=$WT"; echo "WT_HEAD=$(git -C "$WT" rev-parse HEAD)"
	echo "pi=$(command -v pi)"; echo "ROOT_MODEL=$ROOT_MODEL"; echo "WORKER_MODEL=$WORKER_MODEL"
	echo "CAP_USD=$CAP_USD"
} > "$RUN/env.txt"

# Groups to run come from argv so the smoke can exercise one group alone.
# SMOKE is the status-only prompt with no extra env: it proves the harness starts,
# loads both extensions and writes usage.jsonl, and with ROOT_MODEL set to the
# zero-priced local model it costs nothing.
groups=("$@")
[ ${#groups[@]} -gt 0 ] || groups=(A B C D)
for group in "${groups[@]}"; do
	case "$group" in
		A) run_group A "$RUN/root-prompt-ab.md" PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD=1 ;;
		B) run_group B "$RUN/root-prompt-ab.md" PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD=200000 ;;
		C) run_group C "$RUN/root-prompt-cd.md" PI_PLANNER_ONLY_MODEL_ROOT="$ROOT_MODEL" PI_PLANNER_ONLY_THINKING_ROOT=low ;;
		D) run_group D "$RUN/root-prompt-cd.md" PI_PLANNER_ONLY_MODEL_ROOT="$WRONG_MODEL" PI_PLANNER_ONLY_THINKING_ROOT=low ;;
		SMOKE) run_group SMOKE "$RUN/root-prompt-cd.md" ;;
		# A2/B2 close the one reading group A cannot: if usageBudget scopes to the
		# CHILD's own usage rather than the task's, a child that reports 0 tokens
		# (the local model does) never exceeds hard=1 and a conforming host would
		# launch it too. Here the child runs on the token-reporting paid model, so
		# it blows past hard=1 on its first turn.
		A2) run_group A2 "$RUN/root-prompt-ab.md" PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD=1 PI_PLANNER_ONLY_MODEL_WORKER="$ROOT_MODEL" ;;
		B2) run_group B2 "$RUN/root-prompt-ab.md" PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD=200000 PI_PLANNER_ONLY_MODEL_WORKER="$ROOT_MODEL" ;;
		# A3 tests the OTHER budget dimension. A2 is its control: identical except
		# that A2's costUsd.hard (0.05) was never exceeded, while A3's is set below
		# what the paid worker demonstrably spends (~$0.0023 in A2/B2).
		A3) run_group A3 "$RUN/root-prompt-ab.md" PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD=0.0001 PI_PLANNER_ONLY_MODEL_WORKER="$ROOT_MODEL" ;;
		*) echo "unknown group: $group" >&2; exit 2 ;;
	esac
done

date -Iseconds > "$RUN/end.txt"
echo "total_spend_usd=$(total_spent)" | tee "$RUN/total-spend.txt"

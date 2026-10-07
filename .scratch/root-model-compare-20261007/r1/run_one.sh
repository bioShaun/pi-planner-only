#!/usr/bin/env bash
# usage: run_one.sh <opus|sonnet|dsflash> <rep> [--dry-run]   (exit != 0 when the attempt is invalid)
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MAIN=/home/tcuni-claw/pi/pi-planner-only
BASE_DIR=/project/tmp/root-model-compare/r1
OUT=$BASE_DIR/out
PLUGIN=/project/tmp/root-model-compare/plugin-b44aa00/index.ts
SUBAGENTS=$HOME/.pi/agent/npm/node_modules/pi-subagents
SETTINGS=$HOME/.pi/agent/settings.json
ARM=${1:?usage: run_one.sh <opus|sonnet|dsflash> <rep> [--dry-run]}
REP=${2:?}
DRY=0; [[ ${3:-} == --dry-run ]] && DRY=1
case $ARM in
  opus) MODEL=tcuni-claude/claude-opus-5-5 ;;
  sonnet) MODEL=tcuni-claude/claude-sonnet-5-5 ;;
  dsflash) MODEL=cline/cline-pass/deepseek-v4.1-flash ;;
  *) echo "unknown arm: $ARM" >&2; exit 2 ;;
esac
[[ $REP =~ ^[1-9][0-9]*$ ]] || { echo "bad rep" >&2; exit 2; }
mkdir -p "$OUT" "$BASE_DIR/tmp"
[[ -e $BASE_DIR/STOP ]] && { echo "STOP exists: $BASE_DIR/STOP" >&2; exit 5; }
[[ -f $PLUGIN ]] || { echo "plugin not pinned; run pin_plugin.sh" >&2; exit 2; }
[[ -d /project/tmp/root-model-compare/deps/node_modules ]] || { echo "deps not copied; run pin_plugin.sh" >&2; exit 2; }

# Every invocation is its own attempt: R1-<arm>-<rep>-a<N>; nothing from earlier attempts is overwritten.
if (( DRY )); then ID=R1-$ARM-$REP-dryrun; else
  N=$(python3 "$HERE/ledger.py" next-attempt "$OUT" "$ARM" "$REP") || exit 2
  ID=R1-$ARM-$REP-a$N
  : >"$OUT/$ID.started"; echo "$ID" >"$OUT/R1-$ARM-$REP.current"
fi
RUN_ID=$ID
fail_early() { # fail_early <reason>: record an invalid attempt that never reached the Root
  echo "BLOCKED $1" >&2
  (( DRY )) || python3 "$HERE/make_eval.py" "$OUT" "$ID" --early "$1"
  exit 3
}

# worker override must be Sonnet + medium
python3 - "$SETTINGS" <<'PY' || fail_early "worker override is not Sonnet+medium"
import json, sys
w = json.load(open(sys.argv[1]))['subagents']['agentOverrides']['worker']
sys.exit(0 if w.get('model') == 'tcuni-claude/claude-sonnet-5-5' and w.get('thinking') == 'medium' else 1)
PY
SHA_BEFORE=$(sha256sum "$SETTINGS" | cut -d' ' -f1)
MODELS=$(pi --list-models 2>&1) || fail_early "pi --list-models failed"
model_present() { awk -v want="$1" 'NF >= 2 && $1 "/" $2 == want {found=1} END {exit !found}' <<<"$MODELS"; }
CHILD_MODELS=$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])).get("subagents",{}); o=s.get("agentOverrides",{}); print("\n".join(sorted({(o.get(a) or {}).get("model") or s.get("defaultModel","") for a in ("worker","scout","oracle","reviewer")} - {""})))' "$SETTINGS")
for m in $MODEL $CHILD_MODELS; do model_present "$m" || fail_early "model not listed: $m"; done

# health check: --mode json so the usage is billed; OK judged from the final assistant text
declare -A seen=()
hn=0; HEALTH_FILES=()
for m in $MODEL $CHILD_MODELS; do
  [[ -n ${seen[$m]:-} ]] && continue; seen[$m]=1
  if (( DRY )); then
    printf 'health command (not run): timeout 120 pi -ne --no-session --mode json --model %q -p %q </dev/null >%s\n' "$m" 'reply OK' "$OUT/$ID.health.$hn.jsonl"
  else
    # One retry after 30s: a single provider stall (seen once on luna, 2026-10-08) is not a run failure.
    for try in 1 2; do
      timeout 120 pi -ne --no-session --mode json --model "$m" -p "reply OK" </dev/null >"$OUT/$ID.health.$hn.jsonl" 2>/dev/null; h_rc=$?
      (( h_rc == 0 )) && break
      (( try == 1 )) && { mv "$OUT/$ID.health.$hn.jsonl" "$OUT/$ID.health.$hn.try1.jsonl"; sleep 30; }
    done
    HEALTH_FILES+=("$OUT/$ID.health.$hn.jsonl")
    if (( h_rc != 0 )); then
      python3 "$HERE/metrics.py" --health-merge "$OUT/$ID.health.json" "${HEALTH_FILES[@]}" 2>/dev/null
      fail_early "health failed for $m (exit $h_rc)"
    fi
  fi
  hn=$((hn+1))
done
if (( ! DRY )); then
  python3 "$HERE/metrics.py" --health-merge "$OUT/$ID.health.json" "${HEALTH_FILES[@]}" || fail_early "health merge failed"
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("ok") else 1)' "$OUT/$ID.health.json" || fail_early "health reply was not OK (see $ID.health.json)"
fi

# run directory
RUN_TMP=$BASE_DIR/tmp/$RUN_ID
mkdir -p "$RUN_TMP"
BUILD=$("$HERE/build_rundir.sh" "$RUN_ID") || { echo "$BUILD" >&2; fail_early "run dir build failed"; }
REPO=$(sed -n 's/^repo=//p' <<<"$BUILD"); BASELINE=$(sed -n 's/^baseline=//p' <<<"$BUILD")
echo "$BUILD"
PROMPT=$(python3 - "$HERE/prompt.md" "$REPO" "$RUN_TMP" <<'PY'
import sys
t = open(sys.argv[1], encoding='utf-8').read()
sys.stdout.write(t.replace('{RUN_DIR}', sys.argv[2]).replace('{TMPDIR}', sys.argv[3]))
PY
)
PI_ENV=(env -u PI_PLANNER_ONLY_STRICT PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_MODE=lite PI_PLANNER_ONLY_HANDOFF=off TMPDIR="$RUN_TMP" TMP="$RUN_TMP" TEMP="$RUN_TMP")
if (( DRY )); then
  printf '%s\n' "$PROMPT" >"$OUT/$RUN_ID.prompt.md"
  printf 'pi command (not run): cd %s && %s timeout -k 60 3600 pi -ne -e %s -e %s --model %s:high --no-session --mode json -p "<prompt %d chars>" </dev/null >%s 2>%s\n' \
    "$REPO" "${PI_ENV[*]}" "$SUBAGENTS" "$PLUGIN" "$MODEL" "${#PROMPT}" "$OUT/$ID.jsonl" "$OUT/$ID.stderr"
  echo "prompt written: $OUT/$RUN_ID.prompt.md"
  exit 0
fi

PI_VERSION=$(pi --version 2>&1 | head -n 1)
SUB_VERSION=$(node -p "require('$SUBAGENTS/package.json').version" 2>/dev/null || printf unknown)
PLUGIN_SHA=$(git -C "$MAIN" rev-parse b44aa00)
START=$(date -Is)
python3 - "$OUT/$ID.meta.json" "$ARM" "$MODEL" "$REP" "$PLUGIN_SHA" "$PI_VERSION" "$SUB_VERSION" "$SETTINGS" "$START" "$SHA_BEFORE" "$BASELINE" "$REPO" "$ID" <<'PY'
import json, socket, sys
out, arm, model, rep, sha, pi, sub, settings, start, sha_before, baseline, repo, aid = sys.argv[1:]
ov = json.load(open(settings)).get('subagents', {}).get('agentOverrides', {})
# task.target lets bench/runcheck.py flag any reference to the answer commit.
json.dump({'task': {'id': 'R1', 'parent': '850933b', 'target': 'f2fe050ce57732a08d2938ebb70c3fa25d2e71b6'}, 'arm': {'name': arm, 'mode': 'lite', 'rootModel': model, 'thinking': 'high'},
           'rep': rep, 'attemptId': aid, 'pluginSha': sha, 'piVersion': pi, 'piSubagentsVersion': sub, 'childOverrides': ov,
           'piEnv': {'PI_PLANNER_ONLY': '1', 'PI_PLANNER_ONLY_MODE': 'lite', 'PI_PLANNER_ONLY_HANDOFF': 'off', 'PI_PLANNER_ONLY_STRICT': 'unset'},
           'start': start, 'hostname': socket.gethostname(), 'settingsSha256Before': sha_before,
           'baselineCommit': baseline, 'repo': repo}, open(out, 'w'), indent=2)
PY

source "$HOME/.config/pi/secrets.zsh"
cd "$REPO" || fail_early "cannot cd to $REPO"
T0=$(date +%s)
"${PI_ENV[@]}" timeout -k 60 3600 pi -ne -e "$SUBAGENTS" -e "$PLUGIN" --model "$MODEL:high" --no-session --mode json -p "$PROMPT" </dev/null >"$OUT/$ID.jsonl" 2>"$OUT/$ID.stderr"
PI_EXIT=$?
echo $(( $(date +%s) - T0 )) >"$OUT/$ID.wall"
echo "$PI_EXIT" >"$OUT/$ID.exit"
END=$(date -Is)
SHA_AFTER=$(sha256sum "$SETTINGS" | cut -d' ' -f1)
python3 - "$OUT/$ID.meta.json" "$END" "$SHA_AFTER" <<'PY'
import json, sys
p, end, after = sys.argv[1:]
m = json.load(open(p)); m['end'] = end; m['settingsSha256After'] = after
m['settingsChanged'] = after != m['settingsSha256Before']
json.dump(m, open(p, 'w'), indent=2)
PY

# Best-effort child transcripts: copy any transcript the children left under this run's TMPDIR.
mkdir -p "$OUT/$ID.children"
while IFS= read -r -d '' f; do cp "$f" "$OUT/$ID.children/$(basename "$f")"; done < <(find "$RUN_TMP" -name '*transcript*.jsonl' -print0 2>/dev/null)

cd "$HERE"
python3 "$HERE/metrics.py" "$OUT/$ID.jsonl" --run-id "$ID" --children-dir "$OUT/$ID.children" >"$OUT/$ID.metrics.json" 2>"$OUT/$ID.metrics.err" || rm -f "$OUT/$ID.metrics.json"
python3 "$MAIN/bench/runcheck.py" "$OUT/$ID.jsonl" >"$OUT/$ID.runcheck.json" 2>"$OUT/$ID.runcheck.err"; RC_EXIT=$?
if [[ -f $HERE/hidden/check_r1.py ]]; then
  python3 "$HERE/hidden/check_r1.py" "$REPO" "$BASELINE" --out "$OUT/$ID.check.json" >"$OUT/$ID.check.log" 2>&1
  echo $? >"$OUT/$ID.checker.rc"
fi
python3 "$HERE/make_eval.py" "$OUT" "$ID"
VALID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("valid") is True)' "$OUT/$ID.eval.json" 2>/dev/null || echo False)
echo "run_done $ID pi_exit=$PI_EXIT runcheck_exit=$RC_EXIT valid=$VALID"
[[ $VALID == True ]]

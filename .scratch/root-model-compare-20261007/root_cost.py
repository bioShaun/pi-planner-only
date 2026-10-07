#!/usr/bin/env python3
"""Read-only breakdown of Root (main agent) cost in local pi sessions. Stdlib only.

Reads ~/.pi/agent/sessions/<project>/*.jsonl (top level only), bench/prices.json,
.scratch/worker-tiers-real-share-20261007/delegations.tsv. Writes next to this file:
sessions-root.tsv, tool-carry.tsv, session-carry.tsv, closure.tsv, reprice.tsv, phase1-numbers.md.

Definitions
- Root round = event type "message" with message.role == "assistant". Round context = input+cacheRead+cacheWrite.
- Items entering context: user message (cat user); assistant text+thinking (root-text);
  each toolCall (name + JSON arguments chars) and its toolResult text chars, both under the tool category;
  custom_message content (other).
- context_edit (replacement null in all data) is read as: the target entry is dropped from context
  from that point on; its items stop being carried. No compaction events exist in the data.
- Carry cost of an item = tokens * sum(cacheRead price of every later round until end/drop)/1e6
  + tokens * cacheWrite price of the first later round /1e6. tokens = chars / CHARS_PER_TOKEN, where
  CHARS_PER_TOKEN = sum(chars added between consecutive rounds) / sum(context growth), pairs with same
  model, no context_edit between, growth > 0.
- Bash classification (own-read vs own-run): split command on && ; | || and newlines; strip leading cd/env
  assignments. own-read only if EVERY segment starts with a read command: cat head tail sed(-n, no -i)
  grep egrep rg ls find(no -delete/-exec/-fprint) wc git(log show diff status blame ls-files rev-parse
  branch grep describe) jq echo pwd cd sort uniq awk(no system) cut tr stat file du tree nl basename
  dirname date test true column diff cmp realpath readlink, python/python3 with -c or heredoc/stdin that has no
  write indicators (open(..,'w'/'a'), write_text, write(, subprocess, os.system, shutil, unlink, remove).
  Any output redirect to a file (> or >> not to /dev/null and not 2>&1) makes it own-run. Otherwise own-run.
- Tools: read -> own-read; edit/write/apply_patch -> own-edit; bash -> own-read/own-run; delegate ->
  delegate:<role>; git_* -> git; web_search/fetch_content/get_search_content/web_enable -> web; else other.
- Prices: bench/prices.json models["provider/model"]. Unknown -> price 0 and counted.
- Reprice assumes usage.output already includes reasoning tokens.
"""
import collections
import glob
import json
import os
import re
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SESS = os.path.expanduser("~/.pi/agent/sessions")
DELEG = os.path.join(REPO, ".scratch/worker-tiers-real-share-20261007/delegations.tsv")
SESS_REF = os.path.join(REPO, ".scratch/worker-tiers-real-share-20261007/sessions.tsv")
PRICES = json.load(open(os.path.join(REPO, "bench/prices.json")))["models"]
REPRICE = {
    "opus": "tcuni-claude/claude-opus-5-5",
    "sonnet": "tcuni-claude/claude-sonnet-5-5",
    "dsflash": "cline/cline-pass/deepseek-v4.1-flash",
}
READ_CMDS = set("cat head tail grep egrep rg ls wc jq echo pwd cd sort uniq cut tr stat file du tree nl basename dirname date test true column diff cmp realpath readlink".split())
GIT_READ = {"log", "show", "diff", "status", "blame", "ls-files", "rev-parse", "branch", "grep", "describe"}
PY_WRITE = re.compile(r"open\([^)]*['\"][wa]b?\+?['\"]|write_text|\.write\(|subprocess|os\.system|shutil|unlink|os\.remove|rename")
FAIL = collections.Counter()
UNK_MODELS = collections.Counter()


def q(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def price(provider, model):
    return PRICES.get("%s/%s" % (provider, model))


def seg_is_read(seg, whole):
    seg = seg.strip()
    seg = re.sub(r"^(\w+=\S+\s+)+", "", seg)
    if not seg:
        return True
    w = seg.split()
    cmd = os.path.basename(w[0])
    rest = w[1:]
    if cmd in READ_CMDS:
        return True
    if cmd == "sed":
        return "-n" in rest and not any(x.startswith("-i") or x == "--in-place" for x in rest)
    if cmd == "find":
        return not any(x in ("-delete", "-exec", "-execdir", "-fprint", "-ok") for x in rest)
    if cmd == "awk":
        return "system(" not in seg
    if cmd == "git":
        sub = [x for x in rest if not x.startswith("-")]
        if rest and rest[0] == "-C" and len(sub) >= 2:
            sub = sub[1:]
        return bool(sub) and sub[0] in GIT_READ
    if cmd in ("python", "python3"):
        if "-c" in rest or "<<" in whole or len(rest) == 0 or rest == ["-"]:
            return not PY_WRITE.search(whole)
        return False
    return False


def classify_bash(cmd):
    if not isinstance(cmd, str):
        return "own-run"
    body = cmd
    if "<<" in body:  # heredoc body is data for the leading command
        head = body.split("<<", 1)[0]
        segs = re.split(r"&&|\|\||;|\||\n", head)
    else:
        segs = re.split(r"&&|\|\||;|\||\n", body)
    red = re.sub(r"\d?>\s*/dev/null|\d>&\d|&>\s*/dev/null", "", body.split("<<", 1)[0])
    if re.search(r">", red):
        return "own-run"
    return "own-read" if all(seg_is_read(s, cmd) for s in segs) else "own-run"


def classify_call(name, args):
    if name == "read":
        return "own-read"
    if name in ("edit", "write", "apply_patch"):
        return "own-edit"
    if name == "bash":
        return classify_bash((args or {}).get("command"))
    if name == "delegate":
        return "delegate:%s" % ((args or {}).get("role") or "unknown")
    if name.startswith("git_"):
        return "git"
    if name in ("web_search", "fetch_content", "get_search_content", "web_enable"):
        return "web"
    return "other"


def rtext(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    return "".join(x.get("text", "") for x in c or [] if isinstance(x, dict) and x.get("type") == "text")


def num(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        FAIL["bad_number"] += 1
        return 0.0


def parse_session(path):
    project = os.path.basename(os.path.dirname(path))
    sname = os.path.basename(path)
    rounds = []  # dict per assistant round
    items = []  # [cat, chars, start_round, end_round or None, entry_id]
    call_cat = {}
    ncalls = collections.Counter()
    nres_chars = collections.Counter()
    ts = []
    n_ctx_edit = 0
    n_usage_events = 0
    usage_event_cost = 0.0
    n_deleg = 0
    pair_chars = 0  # chars since last assistant round (inclusive of that round's content)
    pairs = []  # (chars, growth, same_model)
    edit_in_gap = False
    last_round = None
    first = True
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            FAIL["bad_json_line"] += 1
            continue
        t = d.get("type")
        if d.get("timestamp"):
            ts.append(d["timestamp"])
        eid = d.get("id")
        if t == "context_edit":
            n_ctx_edit += 1
            edit_in_gap = True
            tid = d.get("targetId")
            for it in items:
                if it[4] == tid and it[3] is None:
                    it[3] = len(rounds)
            continue
        if t == "usage":
            n_usage_events += 1
            usage_event_cost += num(((d.get("usage") or {}).get("cost") or {}).get("total"))
            continue
        if t == "custom_message":
            c = d.get("content")
            n = len(c) if isinstance(c, str) else len(json.dumps(c, ensure_ascii=False))
            items.append(["other", n, len(rounds), None, eid])
            pair_chars += n
            continue
        if t != "message" or not isinstance(d.get("message"), dict):
            continue
        m = d["message"]
        role = m.get("role")
        if role == "user":
            n = len(rtext(m))
            items.append(["user", n, len(rounds), None, eid])
            pair_chars += n
        elif role == "toolResult":
            n = len(rtext(m))
            cat = call_cat.get(m.get("toolCallId")) or "other"
            nres_chars[cat] += n
            items.append([cat, n, len(rounds), None, eid])
            pair_chars += n
        elif role == "assistant":
            u = m.get("usage") or {}
            c = u.get("cost") or {}
            ctx = num(u.get("input")) + num(u.get("cacheRead")) + num(u.get("cacheWrite"))
            r = dict(
                provider=m.get("provider"), model=m.get("model"),
                inp=num(u.get("input")), out=num(u.get("output")),
                cr=num(u.get("cacheRead")), cw=num(u.get("cacheWrite")), reas=num(u.get("reasoning")),
                ci=num(c.get("input")), co=num(c.get("output")), ccr=num(c.get("cacheRead")),
                ccw=num(c.get("cacheWrite")), ct=num(c.get("total")), ctx=ctx,
            )
            if last_round is not None and not edit_in_gap and ctx > 0 and last_round["ctx"] > 0:
                pairs.append((pair_chars, ctx - last_round["ctx"], last_round["model"] == r["model"]))
            rounds.append(r)
            last_round = r
            edit_in_gap = False
            pair_chars = 0
            tx = 0
            for x in m.get("content") or []:
                if not isinstance(x, dict):
                    continue
                ty = x.get("type")
                if ty == "text":
                    tx += len(x.get("text") or "")
                elif ty == "thinking":
                    tx += len(x.get("thinking") or "")
                elif ty == "toolCall":
                    name = x.get("name") or ""
                    args = x.get("arguments")
                    cat = classify_call(name, args if isinstance(args, dict) else {})
                    call_cat[x.get("id")] = cat
                    ncalls[cat] += 1
                    if name == "delegate":
                        n_deleg += 1
                    n = len(name) + len(json.dumps(args, ensure_ascii=False))
                    items.append([cat, n, len(rounds), None, eid])
                    pair_chars += n
            items.append(["root-text", tx, len(rounds), None, eid])
            pair_chars += tx
            ncalls["root-text"] += 1
        if role == "user":
            ncalls["user"] += 1
    return dict(project=project, session=sname, rounds=rounds, items=items, ncalls=ncalls,
                nres=nres_chars, ts=ts, n_ctx_edit=n_ctx_edit, n_usage_events=n_usage_events,
                usage_event_cost=usage_event_cost, n_deleg=n_deleg, pairs=pairs)


def parse_ts(s):
    from datetime import datetime
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def carry_for(S, cpt):
    """S: dict with rounds, items. Returns per-category carry cost and unknown-price round count."""
    rounds = S["rounds"]
    n = len(rounds)
    pcr, pcw = [], []
    unk = 0
    for r in rounds:
        p = price(r["provider"], r["model"])
        if p is None:
            unk += 1
            UNK_MODELS["%s/%s" % (r["provider"], r["model"])] += 1
            p = {"cacheRead": 0.0, "cacheWrite": 0.0}
        pcr.append(p["cacheRead"])
        pcw.append(p["cacheWrite"])
    suf = [0.0] * (n + 1)
    for i in range(n - 1, -1, -1):
        suf[i] = suf[i + 1] + pcr[i]
    out = collections.defaultdict(float)
    for cat, chars, st, en, _ in S["items"]:
        if st >= n or chars <= 0:
            continue
        en = n if en is None else min(en, n)
        tok = chars / cpt
        cost = 0.0
        if en > st:
            cost += tok * (suf[st] - suf[en]) / 1e6
        cost += tok * pcw[st] / 1e6
        out[cat] += cost
    base = rounds[0]["ctx"] * suf[0] / 1e6 if n else 0.0  # first-round context (system prompt etc.) re-read every round
    out["_base"] = base
    return out, unk


def fmt(x, nd=4):
    return ("%." + str(nd) + "f") % x


def main():
    deleg = collections.defaultdict(lambda: [0, 0])  # (project, session) -> [n, n_experiment]
    with open(DELEG, encoding="utf-8") as f:
        hdr = f.readline().rstrip("\n").split("\t")
        ip, isx, iex = hdr.index("project"), hdr.index("session"), hdr.index("exclude")
        for line in f:
            w = line.rstrip("\n").split("\t")
            if len(w) <= iex:
                w += [""] * (iex + 1 - len(w))
            k = (w[ip], w[isx])
            deleg[k][0] += 1
            if w[iex].startswith("experiment:"):
                deleg[k][1] += 1

    paths = sorted(glob.glob(os.path.join(SESS, "*", "*.jsonl")))
    sessions = [parse_session(p) for p in paths]

    tot_chars = tot_growth = 0.0
    ratios = []
    for S in sessions:
        for ch, gr, same in S["pairs"]:
            if same and gr > 0 and ch > 0:
                tot_chars += ch
                tot_growth += gr
                ratios.append(ch / gr)
    cpt = tot_chars / tot_growth
    FAIL["calib_pairs"] = len(ratios)

    recs = []
    for S in sessions:
        R = S["rounds"]
        cost_by_model = collections.defaultdict(float)
        for r in R:
            cost_by_model["%s/%s" % (r["provider"], r["model"])] += r["ct"]
        main_key = max(cost_by_model, key=cost_by_model.get) if cost_by_model else ""
        main_model = main_key.split("/", 1)[1] if main_key else ""
        carry, unk = carry_for(S, cpt)
        base = carry.pop("_base")
        tsn = sorted(S["ts"])
        d = deleg.get((S["project"], S["session"]), [0, 0])
        rep = {}
        for k, key in REPRICE.items():
            p = PRICES[key]
            rep[k] = sum(r["inp"] * p["in"] + r["out"] * p["out"] + r["cr"] * p["cacheRead"] + r["cw"] * p["cacheWrite"] for r in R) / 1e6
        actual_cache = sum(r["ccr"] + r["ccw"] for r in R)
        recs.append(dict(
            base=base, S=S, main_key=main_key, main_model=main_model, carry=carry, unk=unk, rep=rep,
            exp=d[1] > 0, n_deleg=S["n_deleg"], n_deleg_tsv=d[0], actual_cache=actual_cache,
            cost=sum(r["ct"] for r in R), ci=sum(r["ci"] for r in R), co=sum(r["co"] for r in R),
            ccr=sum(r["ccr"] for r in R), ccw=sum(r["ccw"] for r in R), reas=sum(r["reas"] for r in R),
            ctxs=[r["ctx"] for r in R],
            wall=(parse_ts(tsn[-1]) - parse_ts(tsn[0])) if tsn else 0,
        ))
    recs = [r for r in recs if r["S"]["rounds"]] + [r for r in recs if not r["S"]["rounds"]]
    FAIL["sessions_without_rounds"] = sum(1 for r in recs if not r["S"]["rounds"])
    FAIL["rounds_unknown_price"] = sum(r["unk"] for r in recs)
    recs_r = [r for r in recs if r["S"]["rounds"]]

    def w(name, header, rows):
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            f.write("\t".join(header) + "\n")
            for row in rows:
                f.write("\t".join(str(x) for x in row) + "\n")

    # 1 sessions-root.tsv
    rows = []
    for r in recs:
        S = r["S"]
        tsn = sorted(S["ts"])
        rows.append([S["project"], S["session"], r["main_key"], "yes" if r["exp"] else "no", r["n_deleg"],
                     len(S["rounds"]), fmt(r["cost"]), fmt(r["ci"]), fmt(r["co"]), fmt(r["ccr"]), fmt(r["ccw"]),
                     int(r["reas"]), int(statistics.median(r["ctxs"])) if r["ctxs"] else 0,
                     int(max(r["ctxs"])) if r["ctxs"] else 0, S["n_ctx_edit"],
                     tsn[0] if tsn else "", tsn[-1] if tsn else "", int(r["wall"]),
                     S["n_usage_events"], fmt(S["usage_event_cost"])])
    w("sessions-root.tsv", ["project", "session", "main_model", "has_experiment", "n_delegations", "rounds",
                            "root_cost", "cost_input", "cost_output", "cost_cacheRead", "cost_cacheWrite",
                            "reasoning_tokens", "ctx_median", "ctx_max", "context_edits", "first_ts", "last_ts",
                            "wall_s", "usage_events(not in root_cost)", "usage_events_cost"], rows)

    # 2 tool-carry.tsv / session-carry.tsv / closure.tsv
    agg = collections.defaultdict(lambda: [0, 0, 0.0])
    srows, crows = [], []
    for r in recs_r:
        S = r["S"]
        cats = set(r["carry"]) | set(S["ncalls"]) | set(S["nres"])
        for c in cats:
            a = agg[(r["main_key"], c)]
            a[0] += S["ncalls"].get(c, 0)
            a[1] += S["nres"].get(c, 0)
            a[2] += r["carry"].get(c, 0.0)
            srows.append([S["project"], S["session"], r["main_key"], c, S["ncalls"].get(c, 0), S["nres"].get(c, 0), fmt(r["carry"].get(c, 0.0), 6)])
        tc = sum(r["carry"].values())
        crows.append([S["project"], S["session"], r["main_key"], fmt(tc), fmt(r["actual_cache"]),
                      fmt(tc / r["actual_cache"], 3) if r["actual_cache"] > 0 else "NA"])
    totals = collections.defaultdict(float)
    for (m, c), a in agg.items():
        totals[m] += a[2]
    trows = []
    for (m, c), a in sorted(agg.items(), key=lambda kv: (kv[0][0], -kv[1][2])):
        trows.append([m, c, a[0], a[1], fmt(a[2]), fmt(a[2] / totals[m], 4) if totals[m] else "NA"])
    w("tool-carry.tsv", ["main_model", "category", "calls", "result_chars", "carry_usd", "share_of_model_carry"], trows)
    w("session-carry.tsv", ["project", "session", "main_model", "category", "calls", "result_chars", "carry_usd"], srows)
    w("closure.tsv", ["project", "session", "main_model", "carry_total", "actual_cacheRead_plus_cacheWrite", "ratio"], crows)

    # 3 reprice.tsv
    w("reprice.tsv", ["project", "session", "main_model", "actual_root_cost", "opus_price", "sonnet_price", "dsflash_price"],
      [[r["S"]["project"], r["S"]["session"], r["main_key"], fmt(r["cost"]), fmt(r["rep"]["opus"]), fmt(r["rep"]["sonnet"]), fmt(r["rep"]["dsflash"])] for r in recs])

    # reference check
    ref = 0.0
    ref_diffs = []
    mine_by = {(r["S"]["project"], r["S"]["session"]): r["cost"] for r in recs}
    with open(SESS_REF, encoding="utf-8") as f:
        h = f.readline().rstrip("\n").split("\t")
        i = h.index("root_cost_usd")
        for line in f:
            ws = line.rstrip("\n").split("\t")
            ref += float(ws[i] or 0)
            k = (ws[0], ws[1])
            if abs(mine_by.get(k, 0.0) - float(ws[i] or 0)) > 0.005:
                ref_diffs.append("%s now $%.4f vs reference $%.4f" % (ws[1][:40], mine_by.get(k, 0.0), float(ws[i] or 0)))
    mine = sum(r["cost"] for r in recs)

    # 4 phase1-numbers.md
    def is_op(r): return "opus" in r["main_model"]
    def is_so(r): return "sonnet" in r["main_model"]
    groups = [
        ("Opus Root: all", [r for r in recs_r if is_op(r)]),
        ("Opus Root: with delegation (no experiment)", [r for r in recs_r if is_op(r) and not r["exp"] and r["n_deleg"] > 0]),
        ("Opus Root: no delegation", [r for r in recs_r if is_op(r) and not r["exp"] and r["n_deleg"] == 0]),
        ("Opus Root: with experiment delegation", [r for r in recs_r if is_op(r) and r["exp"]]),
        ("Sonnet Root: all", [r for r in recs_r if is_so(r)]),
    ]
    L = []
    L.append("# Phase 1 numbers (Root cost breakdown)\n")
    L.append("Generated by root_cost.py. Numbers only.\n")
    L.append("## Global\n")
    L.append("- Root sessions parsed: %d (with >=1 assistant round: %d)" % (len(recs), len(recs_r)))
    L.append("- Root total cost (assistant message usage.cost.total): $%.4f; reference sessions.tsv root_cost_usd sum: $%.4f; diff %.3f%%" % (mine, ref, (mine - ref) / ref * 100 if ref else 0))
    L.append("- Sessions differing from reference by >$0.005: %d %s" % (len(ref_diffs), "; ".join(ref_diffs)))
    L.append("- Rounds with unknown price by provider/model: " + ", ".join("%s=%d" % kv for kv in UNK_MODELS.most_common()))
    L.append("- Main-model counts: " + ", ".join("%s=%d" % kv for kv in collections.Counter(r["main_key"] for r in recs_r).most_common()))
    L.append("- `usage` events (cache_warm etc., not in Root total): %d events, $%.4f" % (sum(r["S"]["n_usage_events"] for r in recs), sum(r["S"]["usage_event_cost"] for r in recs)))
    L.append("")
    segs = [("<50k", 0, 50e3), ("50-100k", 50e3, 100e3), ("100-200k", 100e3, 200e3), (">200k", 200e3, 1e18)]
    for gname, g in groups:
        L.append("## %s\n" % gname)
        if not g:
            L.append("(no sessions)\n")
            continue
        rs = [x for r in g for x in r["S"]["rounds"]]
        tc = sum(r["cost"] for r in g)
        L.append("- Sessions: %d; Root total: $%.4f; per-session median $%.4f, max $%.4f" % (len(g), tc, statistics.median(r["cost"] for r in g), max(r["cost"] for r in g)))
        L.append("- Cost split: input %.1f%%, output %.1f%%, cacheRead %.1f%%, cacheWrite %.1f%%" % tuple(100 * sum(r[k] for r in g) / tc for k in ("ci", "co", "ccr", "ccw")))
        nr = [len(r["S"]["rounds"]) for r in g]
        L.append("- Rounds per session: median %.0f, P90 %.0f, max %d; total rounds %d" % (q(nr, .5), q(nr, .9), max(nr), sum(nr)))
        L.append("- Cost per round: median $%.5f, P90 $%.5f" % (q([x["ct"] for x in rs], .5), q([x["ct"] for x in rs], .9)))
        cx = [x["ctx"] for x in rs]
        L.append("- Round context tokens: median %.0f, P90 %.0f, max %.0f" % (q(cx, .5), q(cx, .9), max(cx)))
        L.append("- Reasoning tokens (inside output): %d" % sum(r["reas"] for r in g))
        L.append("")
        L.append("| context segment | rounds | share of rounds | cost | share of cost |")
        L.append("|---|---|---|---|---|")
        for sn, lo, hi in segs:
            sel = [x for x in rs if lo <= x["ctx"] < hi]
            c = sum(x["ct"] for x in sel)
            L.append("| %s | %d | %.1f%% | $%.4f | %.1f%% |" % (sn, len(sel), 100 * len(sel) / len(rs), c, 100 * c / tc if tc else 0))
        L.append("")
        cc = collections.defaultdict(lambda: [0, 0, 0.0])
        for r in g:
            for c in set(r["carry"]) | set(r["S"]["ncalls"]) | set(r["S"]["nres"]):
                a = cc[c]
                a[0] += r["S"]["ncalls"].get(c, 0)
                a[1] += r["S"]["nres"].get(c, 0)
                a[2] += r["carry"].get(c, 0.0)
        ct = sum(a[2] for a in cc.values())
        L.append("| category | calls (user/root-text: messages) | result chars | carry $ | carry share |")
        L.append("|---|---|---|---|---|")
        for c, a in sorted(cc.items(), key=lambda kv: -kv[1][2]):
            L.append("| %s | %d | %d | %.4f | %.1f%% |" % (c, a[0], a[1], a[2], 100 * a[2] / ct if ct else 0))
        L.append("- Carry total $%.4f vs actual cacheRead+cacheWrite $%.4f: ratio %.3f" % (ct, sum(r["actual_cache"] for r in g), ct / sum(r["actual_cache"] for r in g)))
        L.append("")
        L.append("Top 10 sessions by Root cost:\n")
        L.append("| session | cost | rounds | max ctx | top-3 carry categories (share of session carry) |")
        L.append("|---|---|---|---|---|")
        for r in sorted(g, key=lambda r: -r["cost"])[:10]:
            st = sum(r["carry"].values()) or 1
            top = sorted(r["carry"].items(), key=lambda kv: -kv[1])[:3]
            L.append("| %s | $%.4f | %d | %d | %s |" % (r["S"]["session"][:40], r["cost"], len(r["S"]["rounds"]), max(r["ctxs"]),
                                                      "; ".join("%s %.0f%%" % (k, 100 * v / st) for k, v in top)))
        L.append("")
        ro = sum(r["rep"]["opus"] for r in g)
        L.append("Reprice (same tokens): Opus $%.4f; Sonnet $%.4f = %.1f%% of Opus; DeepSeek Flash $%.4f = %.1f%% of Opus. (Actual Root cost $%.4f)\n" % (
            ro, sum(r["rep"]["sonnet"] for r in g), 100 * sum(r["rep"]["sonnet"] for r in g) / ro,
            sum(r["rep"]["dsflash"] for r in g), 100 * sum(r["rep"]["dsflash"] for r in g) / ro, tc))
    L.append("## Token conversion and carry closure\n")
    L.append("- chars per token (sum chars / sum context growth over %d round pairs): %.3f" % (len(ratios), cpt))
    L.append("- Per-pair chars/growth distribution: P10 %.2f, P25 %.2f, median %.2f, P75 %.2f, P90 %.2f" % tuple(q(ratios, p) for p in (.1, .25, .5, .75, .9)))
    cl = [(r["S"]["session"], sum(r["carry"].values()) / r["actual_cache"], r) for r in recs_r if r["actual_cache"] > 0]
    rv = [x[1] for x in cl]
    L.append("- Per-session closure ratio (carry total / actual cacheRead+cacheWrite), %d sessions: P10 %.3f, P25 %.3f, median %.3f, P75 %.3f, P90 %.3f, min %.3f, max %.3f" % ((len(rv),) + tuple(q(rv, p) for p in (.1, .25, .5, .75, .9)) + (min(rv), max(rv))))
    L.append("- Sessions with ratio outside 0.8-1.2: %d of %d" % (sum(1 for x in rv if x < .8 or x > 1.2), len(rv)))
    tcarry, tact = sum(sum(r["carry"].values()) for r in recs_r), sum(r["actual_cache"] for r in recs_r)
    L.append("- All sessions: carry $%.4f vs actual cache $%.4f: ratio %.3f" % (tcarry, tact, tcarry / tact))
    tb = sum(r["base"] for r in recs_r)
    L.append("- First-round context (not an item) re-read every round, priced at cacheRead: $%.4f; (carry + first-round) / actual = %.3f" % (tb, (tcarry + tb) / tact))
    L.append("- Context not attributed to any item (system prompt/tools, first-round context, uncounted images) shows up as ratio < 1; thinking/tool args not re-sent shows up as > 1.")
    L.append("")
    L.append("## Parse failures and anomalies\n")
    for k in ("bad_json_line", "bad_number", "sessions_without_rounds", "rounds_unknown_price", "calib_pairs"):
        L.append("- %s: %d" % (k, FAIL.get(k, 0)))
    L.append("- context_edit events: %d" % sum(r["S"]["n_ctx_edit"] for r in recs))
    L.append("- sessions where n_delegations (own count of delegate toolCalls) != delegations.tsv count: %d" % sum(1 for r in recs if r["n_deleg"] != r["n_deleg_tsv"]))
    L.append("")
    with open(os.path.join(HERE, "phase1-numbers.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("sessions=%d root_total=%.4f ref=%.4f cpt=%.3f carry/actual=%.3f" % (len(recs), mine, ref, cpt, tcarry / tact))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Metrics + isolation check for one Root run (lite mode).

usage: metrics.py <run.jsonl> [--run-id R1-opus-1]
Accepts both `pi --mode json` event streams (message_end / tool_execution_end) and
pi session files (type=message entries, toolResult messages). Cost parsing mirrors
bench/summarize.py (lite): child cost comes only from `delegate` tool-result details.usage;
if any launched child lacks usage/priced model, child_cost is null (never 0).
Root tool classes come from ../../root-model-compare-20261007/root_cost.py classify_call.
Child transcripts: in lite mode children run inside pi-subagents; the Root stream carries only
usage summaries, so child transcripts are checked only when details contain a *.jsonl path
that exists (reported in child_transcripts_checked).
"""
import importlib.util, json, math, re, shlex, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAIN = HERE.parents[2]
MAIN_STR = "/home/tcuni-claw/pi/pi-planner-only"
sys.path.insert(0, str(MAIN / "bench"))
from native_results import model_key  # noqa: E402

PRICES = json.loads((MAIN / "bench/prices.json").read_text())["models"]
FIELDS = ("input", "output", "cacheRead", "cacheWrite")
SHORT = ("in", "out", "cacheRead", "cacheWrite")
_spec = importlib.util.spec_from_file_location("root_cost", MAIN / ".scratch/root-model-compare-20261007/root_cost.py")
root_cost = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(root_cost)


def price(u, p):
    return sum(u[k] * p[s] for k, s in zip(FIELDS, SHORT)) / 1e6


def valid_usage(u):
    return isinstance(u, dict) and all(isinstance(u.get(k), (int, float)) and not isinstance(u[k], bool) and math.isfinite(u[k]) and u[k] >= 0 for k in FIELDS)


def text_of(content):
    if isinstance(content, str):
        return content
    return "".join(x.get("text", "") for x in content or [] if isinstance(x, dict) and x.get("type") == "text")


# Paths are flagged only where a tool could read them (read/bash/grep/find/ls ...). A delegate
# task is instructions to a child: forwarding "do not read X" or naming the project
# ("pi-planner-only Lite extension") is not a read, so only answer/hidden markers count there.
READ_TOOLS_SKIP = {"delegate"}
LEAK_MARKERS = ("plugin-b44aa00", "r1/hidden", "check_r1", "f2fe050")
MAIN_PATH_RE = re.compile(r"/home/tcuni-claw/pi/pi-planner-only(?![\w-])|\.pi/agent/git/github\.com/bioShaun/pi-planner-only|bioShaun/pi-planner-only")


def isolation_flags(name, args, run_id):
    flags = []
    s = json.dumps(args, ensure_ascii=False)
    for pat in LEAK_MARKERS:
        if pat in s:
            flags.append((pat, name, s[:120]))
    if name not in READ_TOOLS_SKIP:
        m = MAIN_PATH_RE.search(s)
        if m:
            flags.append(("pi-planner-only", name, s[max(0, m.start() - 40):m.end() + 60]))
        if re.search(r"node_modules/\.\.", s):
            flags.append(("node_modules/..", name, s[:120]))
        for m in re.finditer(r"/project/tmp/root-model-compare(/[\w.-]+)*", s):
            path = m.group(0)
            ok = re.match(r"/project/tmp/root-model-compare/r1/(runs|tmp)/" + re.escape(run_id) + r"(-dryrun)?(/|$)", path) or re.match(r"/project/tmp/root-model-compare/deps(/|$)", path)
            if not ok:
                flags.append(("other-experiment-path", name, path))
    target = home_pi_write_target(name, args if isinstance(args, dict) else {})
    if target:
        flags.append(("write-to-~/.pi", name, target[:200]))
    return flags


# Writes into ~/.pi are judged by the write target, not by mentions: file content, heredoc bodies,
# and read-only commands may name ~/.pi freely (2026-10-08 false positives in 4 R1 runs).
HOME_PI_RE = re.compile(r"^(?:~|\$HOME|\$\{HOME\}|/home/tcuni-claw)/\.pi(?:/|$)")
HOME_PI_ANY = r"(?:~|\$HOME|\$\{HOME\}|/home/tcuni-claw)/\.pi\b"
SEPARATORS = {";", "&&", "||", "|", "&", "\n", "|&", ";;"}
REDIRECTS = {">", ">>", "&>", "&>>", ">|", "<>", ">&"}
ANY_ARG_WRITERS = {"tee", "mv", "rm", "rmdir", "touch", "mkdir", "truncate", "chmod", "chown", "unlink", "shred"}
LAST_ARG_WRITERS = {"cp", "install", "ln", "rsync", "scp"}
PREFIX_WORDS = {"sudo", "env", "command", "nohup", "time", "xargs"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
WRITE_HINT_RE = re.compile(r"<>|>|\btee\b|\bsed\b|\bcp\b|\bmv\b|\brm\b|\bln\b|\binstall\b|\brsync\b|\btouch\b|\bmkdir\b|\btruncate\b")


def _text(v):
    return v if isinstance(v, str) else ""


def home_pi_write_target(name, args):
    if name in ("write", "edit"):
        for key in ("path", "file_path"):
            p = _text(args.get(key))
            if HOME_PI_RE.match(p.strip()):
                return p
        return None
    if name == "apply_patch":
        text = _text(args.get("input")) or _text(args.get("patch"))
        for m in re.finditer(r"^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(\S+)", text, re.M):
            if HOME_PI_RE.match(m.group(1)):
                return m.group(1)
        return None
    if name == "bash":
        return bash_home_pi_write(_text(args.get("command")))
    return None


def strip_heredoc_bodies(cmd):
    """Drop heredoc bodies; the command line holding `<<WORD` (and its redirects) stays."""
    lines, out, i = cmd.split("\n"), [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        code = re.sub(r"(^|\s)#.*$", r"\1", line)  # `<<EOF` inside a comment opens no heredoc
        words = re.findall(r"<<-?\s*['\"]?([A-Za-z_][\w-]*)['\"]?", code)
        i += 1
        for w in words:
            while i < len(lines) and lines[i].strip() != w:
                i += 1
            i += 1
    return "\n".join(out)


def bash_home_pi_write(cmd):
    if not re.search(HOME_PI_ANY, cmd):
        return None
    body = strip_heredoc_bodies(cmd)
    try:
        lex = shlex.shlex(body, posix=True, punctuation_chars=";&|<>\n")
        lex.whitespace = " \t\r"
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        # Unparseable (unbalanced quotes): fail closed - any write hint plus a ~/.pi mention flags.
        if WRITE_HINT_RE.search(body) and re.search(HOME_PI_ANY, body):
            return "unparseable: " + body.strip()
        return None
    segs, cur = [], []
    for t in tokens:
        if t in SEPARATORS or (t and set(t) <= set(";&|\n") and t not in REDIRECTS):
            segs.append(cur)
            cur = []
        else:
            cur.append(t)
    segs.append(cur)
    for seg in segs:
        hit = segment_home_pi_write(seg)
        if hit:
            return hit
    return None


def segment_home_pi_write(seg):
    args, redirect_targets, i = [], [], 0
    while i < len(seg):
        t = seg[i]
        if t in REDIRECTS or (t.endswith(">") and set(t) <= set("&>|")):
            if i + 1 < len(seg):
                redirect_targets.append(seg[i + 1])
            i += 2
            continue
        if t in ("<", "<<", "<<<", "<<-"):
            i += 2
            continue
        args.append(t)
        i += 1
    for r in redirect_targets:
        if HOME_PI_RE.match(r):
            return r
    while args and (re.match(r"^[A-Za-z_]\w*=", args[0]) or args[0] in PREFIX_WORDS):
        args = args[1:]
        while args and args[0].startswith("-"):  # wrapper options such as `command --`, `env -i`
            args = args[1:]
    if not args:
        return None
    prog = args[0].rsplit("/", 1)[-1]
    operands = [a for a in args[1:] if not a.startswith("-")]
    if prog in SHELLS:
        for j, a in enumerate(args[1:-1], start=1):
            if re.match(r"^-[a-zA-Z]*c[a-zA-Z]*$", a):
                return bash_home_pi_write(args[j + 1])
        return None
    if prog == "sed":
        if any(a == "--in-place" or a.startswith("--in-place=") or re.match(r"^-[a-zA-Z]*i", a) for a in args[1:]):
            for a in operands:
                if HOME_PI_RE.match(a):
                    return a
        return None
    if prog in ANY_ARG_WRITERS:
        for a in operands:
            if HOME_PI_RE.match(a):
                return a
        return None
    if prog in LAST_ARG_WRITERS:
        dest = None
        for j, a in enumerate(args[1:] if prog in ("cp", "install", "ln") else []):  # rsync/scp -t is not a target
            if a in ("-t", "--target-directory") and j + 2 < len(args):
                dest = args[j + 2]
            elif a.startswith("--target-directory="):
                dest = a.split("=", 1)[1]
            elif a.startswith("-t") and len(a) > 2:
                dest = a[2:]
        if dest is None and operands:
            dest = operands[-1]
        if dest and HOME_PI_RE.match(dest):
            return dest
    return None


def walk_tool_calls(o):
    """Yield (name, args) for toolCall-like dicts anywhere in a child transcript line."""
    if isinstance(o, dict):
        if o.get("type") == "toolCall" and isinstance(o.get("arguments"), dict):
            yield o.get("name"), o["arguments"]
        elif isinstance(o.get("toolName"), str) and isinstance(o.get("args"), dict):
            yield o["toolName"], o["args"]
        for v in o.values():
            yield from walk_tool_calls(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk_tool_calls(v)


def scan_children(children_dir, run_id):
    flags, checked = [], []
    for tp in sorted(Path(children_dir).glob("*.jsonl")) if children_dir and Path(children_dir).is_dir() else []:
        for line in open(tp, encoding="utf-8", errors="replace"):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            for name, args in walk_tool_calls(e):
                flags += [(k, "child:" + tp.name + ":" + str(w), d) for k, w, d in isolation_flags(name, args, run_id)]
        checked.append(str(tp))
    return flags, checked


def analyse(path, run_id, children_dir=None):
    root = {k: 0 for k in FIELDS}
    per_turn, calls, results, ts = [], {}, {}, []
    final_text = ""
    root_models, bad_root_turns = set(), 0
    compaction, compaction_missing = [], 0
    delegate_starts = set()
    reasons = []
    child_cost, child_ok, child_reasons = 0.0, True, []
    delegates, by_role, refused = 0, {}, 0
    transcripts = []
    flags = []
    worker_models, worker_thinking = [], []
    for line in open(path, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        msg = e.get("message") if t in ("message_end", "message") else None
        if isinstance(msg, dict):
            if isinstance(msg.get("timestamp"), (int, float)):
                ts.append(msg["timestamp"] / 1000)
            if msg.get("role") == "assistant":
                u = msg.get("usage") or {}
                if not valid_usage(u):
                    bad_root_turns += 1
                else:
                    for k in FIELDS:
                        root[k] += u[k]
                    per_turn.append({k: u[k] for k in FIELDS})
                if msg.get("model"):
                    root_models.add(msg.get("provider", "") + "/" + msg["model"])
                tx = text_of(msg.get("content"))
                if tx.strip():
                    final_text = tx
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        cid = c.get("id") or len(calls)
                        calls[cid] = (c.get("name"), c.get("arguments") or {})
                        if c.get("name") == "delegate":
                            delegate_starts.add(cid)
            elif msg.get("role") == "toolResult":
                results.setdefault(msg.get("toolCallId"), (msg.get("toolName"), text_of(msg.get("content")), msg.get("details") or {}))
        elif t == "tool_execution_start":
            if e.get("toolName") == "delegate":
                delegate_starts.add(e.get("toolCallId"))
            if e.get("toolCallId") not in calls:
                calls[e.get("toolCallId")] = (e.get("toolName"), e.get("args") or {})
        elif t == "tool_execution_end":
            r = e.get("result") or {}
            results[e.get("toolCallId")] = (e.get("toolName"), text_of(r.get("content")), r.get("details") or {})
        elif t == "compaction_end" and not e.get("aborted") and isinstance(e.get("result"), dict):
            cu = e["result"].get("usage")
            if valid_usage(cu):
                compaction.append({k: cu[k] for k in FIELDS})
            else:
                compaction_missing += 1
    # tool classification and isolation
    tools = {}
    for cid, (name, args) in calls.items():
        cls = root_cost.classify_call(name or "other", args)
        d = tools.setdefault(cls, {"calls": 0, "result_chars": 0})
        d["calls"] += 1
        d["result_chars"] += len(results.get(cid, (None, "", {}))[1])
        flags += isolation_flags(name, args, run_id)
    delegate_ends = {cid for cid, (name, _, _) in results.items() if name == "delegate"}
    unfinished = sorted(str(c) for c in delegate_starts - delegate_ends)
    if unfinished:
        reasons.append(f"delegate started without result: {', '.join(unfinished)}")
    for cid, (name, txt, d) in results.items():
        if name != "delegate":
            continue
        if "still running" in txt:
            refused += 1
        if d.get("status") == "refused" and not d.get("usage"):
            continue
        delegates += 1
        role = (calls.get(cid, (None, {}))[1] or {}).get("role") or d.get("role") or "unknown"
        by_role[role] = by_role.get(role, 0) + 1
        if role == "worker":
            wm = d.get("model"); wt = d.get("thinking") or d.get("thinkingLevel")
            if isinstance(wm, str) and ":" in wm and wt is None:
                wm, wt = wm.rsplit(":", 1)
            worker_models.append(wm)
            worker_thinking.append(wt)
        key = model_key(d.get("model"))
        if key and valid_usage(d.get("usage")):
            child_cost += price(d["usage"], PRICES[key])
        else:
            child_ok = False
            child_reasons.append(f"{role}: usage missing or model unpriced ({d.get('model')})")
        for v in json.dumps(d).split('"'):
            if v.endswith(".jsonl") and v.startswith("/") and Path(v).exists():
                transcripts.append(v)
    for tp in sorted(set(transcripts)):
        for line in open(tp, encoding="utf-8", errors="replace"):
            for m in re.finditer(r"/project/tmp/root-model-compare[^\s\"'\\]*|f2fe050|r1/hidden|check_r1|plugin-b44aa00", line):
                flags.append(("child-transcript", tp, m.group(0)[:100]))
    cdir = children_dir or str(Path(path).with_suffix("")) + ".children"
    cflags, checked = scan_children(cdir, run_id)
    flags += cflags
    checked = sorted(set(checked) | set(transcripts))
    rk = None
    for m in root_models:
        rk = model_key(m) or rk
    root_known = price(root, PRICES[rk]) if rk else 0.0
    compaction_known = sum(price(c, PRICES[rk]) for c in compaction) if rk else 0.0
    if not per_turn:
        reasons.append("no Root turn with usage")
    if bad_root_turns:
        reasons.append(f"{bad_root_turns} Root assistant message(s) without valid usage")
    if not rk:
        reasons.append(f"Root model unpriced: {sorted(root_models)}")
    if compaction_missing:
        reasons.append(f"{compaction_missing} compaction_end without usage")
    if not child_ok:
        reasons.append("child cost unavailable: " + "; ".join(child_reasons))
    complete = not reasons
    root_cost_v = root_known + compaction_known if rk and not bad_root_turns and not compaction_missing and per_turn else None
    child_v = child_cost if child_ok else None
    known_lb = root_known + compaction_known + child_cost
    total = known_lb if complete else None
    if worker_models:
        ok_w = all(isinstance(m, str) and m.endswith("claude-sonnet-5-5") for m in worker_models)
        if any(m is None for m in worker_models):
            wid = "unknown"
        elif not ok_w:
            wid = "mismatch"
        elif any(x is not None and x != "medium" for x in worker_thinking):
            wid = "mismatch"
        else:
            wid = "ok" if all(x == "medium" for x in worker_thinking) else "unknown"
    else:
        wid = "unknown"
    wall = None
    wf = Path(path).with_suffix(".wall")
    if wf.exists():
        try:
            wall = int(wf.read_text().strip())
        except ValueError:
            pass
    if wall is None and len(ts) > 1:
        wall = round(max(ts) - min(ts))
    ctx = max((u["input"] + u["cacheRead"] + u["cacheWrite"] for u in per_turn), default=0)
    uniq = []
    for f in flags:
        if f not in uniq:
            uniq.append(f)
    return {
        "root_turns": len(per_turn), "root_models": sorted(root_models), "root_usage": root, "root_usage_per_turn": per_turn,
        "root_cost": root_cost_v, "max_context_tokens": ctx,
        "compaction_events": len(compaction) + compaction_missing, "compaction_cost": compaction_known,
        "child_cost": child_v, "child_cost_known_lower_bound": child_cost, "child_cost_unavailable_reason": None if child_ok else "; ".join(child_reasons),
        "delegates": delegates, "delegates_by_role": by_role, "refused_delegates": refused,
        "delegate_started": len(delegate_starts), "delegate_finished": len(delegate_ends & delegate_starts),
        "worker_models": worker_models, "worker_thinking": worker_thinking, "worker_identity": wid,
        "cost_complete": complete, "cost_incomplete_reasons": reasons, "known_cost_lower_bound": known_lb,
        "total_cost": total, "root_tools": tools, "wall_seconds": wall,
        "final_text": final_text[:4000], "final_text_chars": len(final_text),
        "isolation_flags": [{"kind": a, "where": b, "detail": c} for a, b, c in uniq],
        "child_transcripts_checked": checked,
        "child_transcript_note": "children copied by run_one.sh into <attempt>.children/ are scanned; whether pi-subagents writes lite child transcripts there is unverified (no live run done)",
    }


def health_summary(path):
    """Parse a `pi --mode json -p 'reply OK'` stream: final assistant text OK? and its usage cost."""
    m = analyse(Path(path), "health")
    ok = bool(re.search(r"\bok\b", m["final_text"], re.I))
    return {"file": str(path), "ok": ok, "model": m["root_models"], "cost": m["known_cost_lower_bound"],
            "cost_complete": m["cost_complete"], "reasons": m["cost_incomplete_reasons"]}


def main():
    a = sys.argv[1:]
    if a[:1] == ["--health-merge"]:
        out, files = a[1], a[2:]
        checks = [health_summary(f) for f in files]
        res = {"checks": checks, "ok": bool(checks) and all(c["ok"] for c in checks),
               "cost": sum(c["cost"] for c in checks), "cost_complete": bool(checks) and all(c["cost_complete"] for c in checks)}
        Path(out).write_text(json.dumps(res, indent=2))
        return 0
    if not a:
        print("usage: metrics.py <run.jsonl> [--run-id ID] [--children-dir DIR] | --health-merge OUT files...", file=sys.stderr); return 2
    p = Path(a[0])
    rid = a[a.index("--run-id") + 1] if "--run-id" in a else p.stem
    cd = a[a.index("--children-dir") + 1] if "--children-dir" in a else None
    print(json.dumps(analyse(p, rid, cd), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Read-only extraction of delegate calls from local pi Root sessions. No classification."""
import collections
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SESS = os.path.expanduser("~/.pi/agent/sessions")
RAW = os.path.join(HERE, "raw")
ITEMS = os.path.join(RAW, "items")
EDIT_TOOLS = {"edit", "write", "apply_patch"}
FIX_RE = re.compile(r"修|上次|仍|还是|没有按|遗漏|返工|fix|again|still|missing|P1|P2", re.I)
TOK_RE = re.compile(r"^([\d.,]+)\s*([kKmM]?)\s*tok$")


def flat(s, n=None):
    s = re.sub(r"[\t\r\n]+", " ", s or "")
    return s[:n] if n else s


def parse_header(text):
    """Return dict of parsed fields; missing fields stay ''."""
    out = dict(role_agent="", status="", child_model="", thinking="", tokens="", cost="", turns="", seconds="")
    first = (text or "").split("\n", 1)[0]
    m = re.match(r"^\[([^\]]*)\]\s*(.*)$", first)
    if not m:
        return out, False
    out["role_agent"] = m.group(1)
    parts = [p.strip() for p in m.group(2).split("·")]
    ok = bool(parts and parts[0])
    if parts:
        out["status"] = parts[0]
    for p in parts[1:]:
        t = TOK_RE.match(p)
        if t:
            v = float(t.group(1).replace(",", ""))
            v *= {"": 1, "k": 1e3, "m": 1e6}[t.group(2).lower()]
            out["tokens"] = str(int(round(v)))
        elif p.startswith("$"):
            out["cost"] = p[1:]
        elif re.match(r"^\d+\s*turns?$", p):
            out["turns"] = p.split()[0]
        elif re.match(r"^\d+(\.\d+)?s$", p):
            out["seconds"] = p[:-1]
        elif "/" in p or ":" in p:
            if ":" in p:
                mm, th = p.rsplit(":", 1)
                out["child_model"], out["thinking"] = mm, th
            else:
                out["child_model"] = p
    return out, ok


def result_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    return "".join(x.get("text", "") for x in c or [] if isinstance(x, dict) and x.get("type") == "text")


def short_args(args, n):
    return flat(json.dumps(args, ensure_ascii=False), n)


def load_session(path):
    ev = []
    cwd = ""
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "session":
            cwd = d.get("cwd", cwd)
        ev.append(d)
    return ev, cwd


def main():
    sessions = []
    for p in glob.glob(os.path.join(SESS, "*", "*.jsonl")):
        ev, cwd = load_session(p)
        ts = [d.get("timestamp", "") for d in ev if d.get("timestamp")]
        sessions.append((min(ts) if ts else "", p, ev, cwd))
    sessions.sort(key=lambda s: (s[0], s[1]))

    rows, srows = [], []
    contexts = {}
    fail = collections.Counter()
    n = 0
    for first_ts, path, ev, scwd in sessions:
        project = os.path.basename(os.path.dirname(path))
        sname = os.path.basename(path)
        msgs = [(i, d) for i, d in enumerate(ev) if d.get("type") == "message" and isinstance(d.get("message"), dict)]
        calls = []  # dict per delegate call
        results = {}  # toolCallId -> (idx, text)
        root_models = []
        root_cost = 0.0
        user_idx = []
        for k, (i, d) in enumerate(msgs):
            m = d["message"]
            role = m.get("role")
            if role == "user":
                user_idx.append(k)
            elif role == "assistant":
                mod = m.get("model")
                if mod and mod not in root_models:
                    root_models.append(mod)
                try:
                    root_cost += float(((m.get("usage") or {}).get("cost") or {}).get("total") or 0)
                except (TypeError, ValueError):
                    fail["root_cost"] += 1
                if isinstance(m.get("content"), list):
                    for x in m["content"]:
                        if isinstance(x, dict) and x.get("type") == "toolCall" and x.get("name") == "delegate":
                            a = x.get("arguments") or {}
                            calls.append(dict(k=k, call_id=x.get("id", ""), args=a, ts=d.get("timestamp", ""), model=mod or ""))
            elif role == "toolResult" and m.get("toolName") == "delegate":
                results[m.get("toolCallId")] = (k, result_text(m))
        for c in calls:
            n += 1
            c["id"] = "d%03d" % n
        by_callid = {c["call_id"]: c for c in calls}
        for c in calls:
            r = results.get(c["call_id"])
            c["res_k"] = r[0] if r else None
            c["res_text"] = r[1] if r else ""
            c["hdr"], c["hdr_ok"] = parse_header(c["res_text"]) if r else (parse_header("")[0], False)
            if not r:
                fail["no_result"] += 1
            elif not c["hdr_ok"]:
                fail["header_unparsed"] += 1
            else:
                for f in ("status", "child_model", "thinking", "tokens", "cost", "turns", "seconds"):
                    if not c["hdr"][f]:
                        fail["missing_" + f] += 1
            c["cwd_eff"] = c["args"].get("cwd") or scwd
        child_cost = 0.0
        for c in calls:
            if c["hdr"]["cost"]:
                try:
                    child_cost += float(c["hdr"]["cost"])
                except ValueError:
                    fail["cost_float"] += 1
        for c in calls:
            a = c["args"]
            role = a.get("role", "")
            task = a.get("task", "") or ""
            h = c["hdr"]
            start = c["res_k"] if c["res_k"] is not None else c["k"]
            end = next((u for u in user_idx if u > start), len(msgs))
            interval = msgs[start + 1:end] if c["res_k"] is not None else []
            # mechanical signals
            later = [x for x in calls if x is not c and start < x["k"] < end]
            nxt = next((x for x in later if x["args"].get("role") == "worker" and x["cwd_eff"] == c["cwd_eff"]), None)
            nxt_id = nxt["id"] if nxt else ""
            nxt_kw = ("1" if FIX_RE.search(nxt["args"].get("task", "") or "") else "0") if nxt else ""
            edits = []
            for _, d in interval:
                m = d["message"]
                if m.get("role") == "assistant" and isinstance(m.get("content"), list):
                    for x in m["content"]:
                        if isinstance(x, dict) and x.get("type") == "toolCall" and x.get("name") in EDIT_TOOLS and x["name"] not in edits:
                            edits.append(x["name"])
            rev = next((x for x in later if x["args"].get("role") == "reviewer"), None)
            rev_id = rev["id"] if rev else ""
            rev_p = ""
            if rev:
                txt = rev["res_text"]
                rev_p = "P1:%d;P2:%d" % (len(re.findall(r"P1", txt)), len(re.findall(r"P2", txt)))
            cw = a.get("cwd") or ""
            excl = ""
            # Root decision 2026-10-07: only the controlled replay child runs (cwd under
            # /project/tmp/worker-tiers-*) and this study's own delegations are excluded;
            # bench/audit/video/worktree work under /project/tmp is ordinary Root-authored work.
            if "worker-tiers" in cw.lower():
                excl = "experiment:cwd contains worker-tiers"
            elif "worker-tiers-real-share" in task.lower():
                excl = "self:this study"
            c["row"] = [
                c["id"], project, sname, c["ts"], role, cw or scwd, h["status"], h["child_model"], h["thinking"],
                h["tokens"], h["cost"], h["turns"], h["seconds"], str(len(task)), flat(task, 200), c["model"],
                nxt_id, nxt_kw, ";".join(edits), rev_id, rev_p, excl,
            ]
            rows.append(c["row"])
            if role == "worker":
                contexts[c["id"]] = (c, task, scwd, interval, by_callid)
        roles = [c["args"].get("role", "") for c in calls]
        tss = [d.get("timestamp", "") for _, d in msgs if d.get("timestamp")]
        srows.append([project, sname, ";".join(root_models), "%.4f" % root_cost, "%.4f" % child_cost,
                      str(len(calls)), str(roles.count("worker")), min(tss) if tss else "", max(tss) if tss else ""])

    header = ["id", "project", "session", "ts", "role", "cwd", "status", "child_model", "thinking", "tokens", "cost_usd",
             "turns", "seconds", "task_chars", "task_excerpt", "root_model", "next_same_cwd_worker", "next_task_fix_kw",
             "root_edit_before_user", "reviewer_after", "reviewer_p_findings", "exclude"]
    with open(os.path.join(HERE, "delegations.tsv"), "w", encoding="utf-8") as f:
        f.write("\t".join(header) + "\n")
        for r in rows:
            f.write("\t".join(flat(x) for x in r) + "\n")
    with open(os.path.join(HERE, "sessions.tsv"), "w", encoding="utf-8") as f:
        f.write("\t".join(["project", "session", "root_model", "root_cost_usd", "child_cost_usd", "n_delegations",
                           "n_worker", "first_ts", "last_ts"]) + "\n")
        for r in srows:
            f.write("\t".join(r) + "\n")

    # raw items
    import shutil
    if os.path.isdir(ITEMS):
        shutil.rmtree(ITEMS)
    os.makedirs(os.path.join(RAW, "tmp"), exist_ok=True)
    for cid, (c, task, scwd, interval, by_callid) in contexts.items():
        d = os.path.join(ITEMS, cid)
        os.makedirs(d)
        with open(os.path.join(d, "task.md"), "w", encoding="utf-8") as f:
            f.write("cwd: %s\n\ntask:\n%s" % (c["args"].get("cwd") or scwd, c["args"].get("task", "") or ""))
        text = c["res_text"]
        first, _, rest = text.partition("\n")
        _, _, report = rest.partition("Child report:")
        report = report.strip() if rest else ""
        if "Child report:" not in rest:
            report = rest.strip()
        if len(report) > 6000:
            report = report[:6000] + "\n[... report truncated at 6000 of %d chars]" % len(report)
        acts = []
        for _, dd in interval:
            m = dd["message"]
            r = m.get("role")
            if r == "assistant":
                cont = m.get("content")
                if isinstance(cont, str):
                    cont = [{"type": "text", "text": cont}]
                for x in cont or []:
                    if not isinstance(x, dict):
                        continue
                    if x.get("type") == "text" and x.get("text", "").strip():
                        acts.append("assistant: " + flat(x["text"], 500))
                    elif x.get("type") == "toolCall":
                        if x.get("name") == "delegate":
                            cc = by_callid.get(x.get("id"))
                            a = x.get("arguments") or {}
                            acts.append("delegate %s role=%s: %s" % (cc["id"] if cc else "?", a.get("role", ""), flat(a.get("task", ""), 500)))
                        else:
                            acts.append("tool %s: %s" % (x.get("name"), short_args(x.get("arguments"), 300)))
        body = ""
        total = 0
        for a_ in acts:
            if total + len(a_) > 1500 + max(0, 6000 - len(report)) + 500:
                body += "[... further actions truncated]\n"
                break
            body += "- " + a_ + "\n"
            total += len(a_) + 3
        if not acts:
            body = "(none before next user message or end of session)\n"
        with open(os.path.join(d, "context.md"), "w", encoding="utf-8") as f:
            f.write("%s\n\nChild report:\n%s\n\nRoot actions until next user message:\n%s" % (first, report, body))

    write_summary(rows, srows, fail, n)
    print("delegations=%d workers=%d sessions=%d" % (len(rows), sum(1 for r in rows if r[4] == "worker"), len(srows)))


def dist(counter):
    return "\n".join("- %s: %d" % (k or "(empty)", v) for k, v in sorted(counter.items(), key=lambda kv: -kv[1])) or "- (none)"


def write_summary(rows, srows, fail, n):
    I = {k: i for i, k in enumerate(["id", "project", "session", "ts", "role", "cwd", "status", "child_model", "thinking",
                                     "tokens", "cost_usd", "turns", "seconds", "task_chars", "task_excerpt", "root_model",
                                     "nsw", "fixkw", "edit", "rev", "revp", "exclude"])}
    W = [r for r in rows if r[I["role"]] == "worker"]
    ex = [r for r in rows if r[I["exclude"]]]
    rc = sum(float(s[3]) for s in srows)
    cc = sum(float(s[4]) for s in srows)
    anomalies = []
    if fail:
        anomalies.append("parse failures: " + json.dumps(dict(fail)))
    nostat = sum(1 for r in rows if not r[I["status"]])
    if nostat:
        anomalies.append("%d delegations without parsed status (no toolResult or unparsable header)" % nostat)
    odd = collections.Counter(r[I["status"]] for r in rows if r[I["status"]] not in ("completed", ""))
    cost_mismatch = None
    s = "# extract-summary\n\n"
    s += "Total delegations: %d; workers: %d; Root sessions: %d\n\n" % (len(rows), len(W), len(srows))
    s += "## By role\n" + dist(collections.Counter(r[I["role"]] for r in rows)) + "\n\n"
    s += "## By project (all roles / worker)\n"
    pa, pw = collections.Counter(r[I["project"]] for r in rows), collections.Counter(r[I["project"]] for r in W)
    s += "\n".join("- %s: %d / %d" % (k, v, pw.get(k, 0)) for k, v in sorted(pa.items(), key=lambda kv: -kv[1])) + "\n\n"
    s += "## Worker status\n" + dist(collections.Counter(r[I["status"]] for r in W)) + "\n\n"
    s += "## Worker child_model (model:thinking)\n" + dist(collections.Counter((r[I["child_model"]] + ":" + r[I["thinking"]]) if r[I["child_model"]] else "" for r in W)) + "\n\n"
    s += "## Parse failures\n" + (dist(fail) if fail else "- none") + "\n\n"
    s += "## Exclude (%d rows, %d workers)\n" % (len(ex), sum(1 for r in ex if r[I["role"]] == "worker"))
    s += dist(collections.Counter(r[I["exclude"]] for r in ex)) + "\n\n"
    s += "## Cost (USD)\n- Root (sum of assistant usage.cost.total): %.4f\n- Child (sum of delegation header costs): %.4f\n\n" % (rc, cc)
    s += "## Anomalies\n" + ("\n".join("- " + a for a in anomalies) if anomalies else "- none detected by script") + "\n"
    with open(os.path.join(HERE, "extract-summary.md"), "w", encoding="utf-8") as f:
        f.write(s)


if __name__ == "__main__":
    main()

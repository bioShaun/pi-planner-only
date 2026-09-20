"""Pure acceptance checks for observations from the real PTY/TUI process."""
def inspect_rows(rows, scenario="plain"):
    requests = [(i, e) for i, e in enumerate(rows)
                if e.get("kind") == "launcher" and e.get("event") == "request"]
    if not requests:
        return {"ready": False, "afterClosureCalls": 0}
    request_index, request = requests[0]
    initial = next((s.get("id") for s in request.get("requests", []) if s.get("id")), None)
    identity_keys = ("requestId", "ownerRunId", "nodeId")
    def matches(e):
        return all(request.get(k) and e.get(k) == request[k] for k in identity_keys)
    def state(e):
        return next((s for s in e.get("requests", []) if s.get("id") == initial), {})
    closure_index = next((i for i, e in enumerate(rows) if i >= request_index and state(e).get("closedReason")), None)
    after = [] if closure_index is None else rows[closure_index:]
    # Count by chronology, including events whose state incorrectly reopened.
    counts = {
        "modelHooks": sum(e.get("hook") == "before_provider_request" for e in after),
        "toolCalls": sum(e.get("hook") == "tool_call" for e in after),
        "requests": sum(e.get("kind") == "launcher" and e.get("event") == "request" for e in after),
    }
    cancel = any(e.get("event") == "cancel" and matches(e) for e in after)
    terminal = any(e.get("event") == "response" and e.get("status") == "cancelled" and matches(e) for e in after)
    states = [s for e in rows[request_index:] for s in e.get("requests", [])]
    unchanged = bool(initial) and bool(states) and all(s.get("id") == initial for s in states)
    latest = next((state(e) for e in reversed(rows) if state(e)), {})
    settled = any(e.get("hook") == "agent_settled" for e in after) and latest.get("settled") is True and latest.get("rootStop") == "confirmed"
    queued = closure_index is not None and any(
        e.get("hook") == "input" and e.get("marker") == "queued" and e.get("source") == "interactive"
        and e.get("streamingBehavior") == "followUp" and not state(e).get("closedReason")
        for e in rows[request_index:closure_index])
    timer_index = next((i for i, e in enumerate(rows) if e.get("kind") == "injection"
                        and e.get("event") == "timer_fired" and state(e).get("closedReason")
                        and state(e).get("settled") is True), None)
    input_index = None if timer_index is None else next(
        (i for i, e in enumerate(rows) if i > timer_index and e.get("hook") == "input"
         and e.get("marker") == "scheduled" and e.get("source") == "extension"
         and state(e).get("closedReason")), None)
    start_index = None if input_index is None else next(
        (i for i, e in enumerate(rows) if i > input_index and e.get("hook") == "agent_start"
         and state(e).get("closedReason")), None)
    scheduled = start_index is not None and any(e.get("hook") == "agent_settled"
        and state(e).get("closedReason") and state(e).get("settled") is True for e in rows[start_index+1:])
    injected = (scenario not in ("queued", "combined") or queued) and (scenario not in ("scheduled", "combined") or scheduled)
    has_ui = any(e.get("hasUI") is True for e in rows)
    ready = all((has_ui, closure_index is not None, cancel, terminal, settled, unchanged, injected)) and sum(counts.values()) == 0
    return dict(ready=ready, hasUI=has_ui, closureObserved=closure_index is not None,
                cancelObserved=cancel, cancelledTerminal=terminal, settled=settled,
                originalRequestId=initial, requestUnchanged=unchanged, queuedInputObserved=queued,
                scheduledInputObserved=scheduled, afterClosure=counts, afterClosureCalls=sum(counts.values()),
                lastEventMs=max((e["t"] for e in rows), default=0))

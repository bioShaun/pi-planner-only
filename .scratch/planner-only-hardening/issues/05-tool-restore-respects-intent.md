# 05: Tool on/off restore keeps user and environment intent

**What to build:** Turning planner-only off then on must only undo tool-set changes this extension made, and only when that restore is still safe. Tools the operator or another extension disabled in between stay disabled. Tools this extension added are cleaned up symmetrically unless the operator explicitly kept them. If the environment variable forces the extension off, an `on` command must say the mode is still off — it must not report enabled. Headless status must be readable without a UI toast.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] on → off → on restores only tools this extension suppressed that are still registered; it does not re-enable a safe tool the operator had disabled before first on.
- [ ] While on, another extension (or the operator) disables a tool; a later off/on does not unconditionally restore that tool.
- [ ] Environment-forced off: executing on reports that the effective state remains off and names the environment source.
- [ ] Status output includes effective on/off and source (environment, persisted mark, or session) in a form that works without UI.

## Comments

Parent: hardening FR-06 / T02–T04. Default intersection filter is already in place (T01).

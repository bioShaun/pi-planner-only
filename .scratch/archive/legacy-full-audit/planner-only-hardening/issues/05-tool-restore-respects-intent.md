# 05: Tool on/off restore keeps user and environment intent

**What to build:** Turning planner-only off then on must only undo tool-set changes this extension made, and only when that restore is still safe. Tools the operator or another extension disabled in between stay disabled. Tools this extension added are cleaned up symmetrically unless the operator explicitly kept them. If the environment variable forces the extension off, an `on` command must say the mode is still off — it must not report enabled. Headless status must be readable without a UI toast.

**Blocked by:** None (can start immediately).

**Status:** done (implemented in 00adf70)

- [x] on → off → on restores only tools this extension suppressed that are still registered; it does not re-enable a safe tool the operator had disabled before first on.
- [x] While on, another extension (or the operator) disables a tool; a later off/on does not unconditionally restore that tool.
- [x] Environment-forced off: executing on reports that the effective state remains off and names the environment source.
- [x] Status output includes effective on/off and source (environment, persisted mark, or session) in a form that works without UI.

## Comments

Parent: hardening FR-06 / T02–T04. Default intersection filter is already in place (T01).

- Implemented in 00adf70; acceptance criteria covered by the suite described in the commit message.

## Implementation notes

- Known limitation, recorded per FR-06 §9.2: the host exposes no tool-change source, so a suppressed tool the operator explicitly re-disables mid-`on` cannot be distinguished from our own suppression and is restored at `off`. Tools the extension never suppressed are never touched.

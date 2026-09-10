# 01: Pasteable TaskSpec JSON and non-aliasing sentinel

**What to build:** Policy parent-tool refusals and Orchestration invalid-TaskSpec refusals share one example-JSON renderer owned next to TaskSpec validation. The JSON always passes TaskSpec validation. The documented `taskId` sentinel `T-pending` is always replaced by a generated canonical id and is never stored as an alias, so a second paste starts a new Task. PolicyInput gains `cwd` so the example can name the adapter workspace. Composite-workflow refusal is unchanged and does not gain this JSON.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Renderer (next to TaskSpec validation) emits an object that `validateTaskSpec` accepts. Tests parse the fenced JSON out of the reason; they do not snapshot the reason or the helper name.
- [ ] Per-tool fill: inspect path → constraints + Explorer; bash command → objective + Explorer; write/edit → Worker; other → placeholder objective + Explorer. Invalid `validation` (array, non-boolean `required`, non-string-array `commands`) becomes `{ required: false }` with commands omitted. Submitted valid fields are preserved except the sentinel `taskId`. No invented budget, Evidence, extra worktree roots, or test commands.
- [ ] Policy refused `write`/`bash` (and later Idle gather tools) append that fenced JSON plus "embed this in the subagent task". First lines of the existing block reason remain. PolicyInput includes `cwd`; adapter passes `ctx.cwd || process.cwd()` even before Idle gather ships.
- [ ] Orchestration begin-Delegation on characteristic-but-invalid TaskSpec still creates no Task and starts no child; the block reason includes the same validating JSON.
- [ ] First Delegation with `taskId: "T-pending"` gets a generated canonical id; `T-pending` is not in `aliases`; `store.get("T-pending")` does not return that Task. Second Delegation still using `T-pending` creates a different Task (including when the first Task is already completed).
- [ ] CHANGELOG Unreleased notes the sentinel-alias fix (or this bullet lands together with ticket 02's Idle gather entry). Composite-workflow refusal still has no example JSON.

## Comments

Parent: `.scratch/root-idle-phase/spec.md` (stories 20–31, 42–44, 46; implementation decisions on the renderer and sentinel). P1 arbitration.

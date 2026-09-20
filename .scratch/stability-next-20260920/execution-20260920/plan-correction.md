# Corrections based on actual host evidence

- User approved report-submit-only capability instead of hard:0/block:* after real 0.69.0 blocked both write and structured_output. Original failed run: ../report-only-run-xMGYAr/. Raw denial excerpts: zero-budget-tool-results.json. No textual report fallback and no system package edits.
- First queued TUI run ../study-run-MPl9z4/ proves queued input plus zero post-close calls, but verdict stays NOT_PROVEN: Pi restored queued text into its editor and Ctrl-D did not exit. Driver now clears the editor with Ctrl-C after the full quiet/settled proof, then uses Ctrl-D for normal exit; no signals before that proof.
# Root model change (2026-09-20 09:12 UTC)

The final queued TUI rerun `study-run-nXFeoe` received Kimi 403 (five-hour usage limit), before any child REQUEST. It is retained as NOT_PROVEN, not a product regression or a P3 row. The user explicitly selected `tcuni-ds/deepseek/deepseek-v4.1-flash` as replacement Root. Luna child and low thinking stay fixed. All three P3 arms and the final TUI matrix use the replacement model; earlier Kimi runs remain historical evidence.

At 09:13 UTC the user superseded that choice with `tcuni-agy/gemini-3.8-flash-high`, stating DeepSeek quota was also exhausted. The DeepSeek TUI `study-run-n8HtMM` recorded upstream 502 errors and no child REQUEST; its own driver was interrupted and cleaned up, so the result remains NOT_PROVEN. Gemini is the final selected Root for the complete matrix and P3, with Luna child / low unchanged. The initial successful report-only probe invokes no Root model and remains valid for its Luna child capability claim.

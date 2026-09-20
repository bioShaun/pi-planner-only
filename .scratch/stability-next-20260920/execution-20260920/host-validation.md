# Independent ordinary host-evidence validation

Validator: native `astra_validator_complex` (`host_evidence_validation`), separate from implementation. Read-only evidence inspection; no tests, writes, provider calls or children. This is ordinary evidence validation, not the strict review gate.

Phase 2 and its combined-scenario supplement returned PASS for these bounded claims:

| Claim | Raw evidence | Independently checked |
|---|---|---|
| Closed report-submission capability | `../report-only-run-3zZ7ry/` | Production `tools:[]` definition plus observation-only extension; actual child tools exactly `structured_output`; one successful submission; matched identity and completed terminal; unchanged workspace; Pi and wrapper exit 0 |
| Full normal-terminal release | `../release-run-ysqfcU/` | `npm run test:release`, 09:10:25–09:11:20 UTC, exit 0; source/harness hashes and repository status unchanged; expected injected fault diagnostics occur within passing tests |
| Queued real TUI | `../study-run-vsHbSx/` | Interactive followUp before closure; matching REQUEST/CANCEL/cancelled RESPONSE; confirmed settled; chronological post-close model/tool/REQUEST 0/0/0; no sentinel/change; natural exit 0 |
| Scheduled real TUI | `../study-run-TupxIs/` | Timer fired 251 ms after arming on confirmed settlement; extension input and another agent cycle; no provider/tool/REQUEST activity; settled again; natural exit 0 |
| Combined real TUI | `../study-run-2VtAyF/` | Queued input index 9, closure 12, first confirmed settlement 18; timer fired 249 ms after arming, scheduled input 21; final settlement; post-close counts 0/0/0; natural exit 0 |

All TUI rows have real `hasUI:true` / `mode:tui`, stable Request identity, a matched cancellation tuple, three seconds of quiet before normal editor-clear/exit keys, and `forcedCleanup:false`. Actual models are Gemini Root / Luna child, low. These three scenarios do not establish universal stop support in every host mode.

The probe preceded the final three-line immutable-origin correction; independent patch inspection confirms that correction did not change the exported capability definition. Release followed the correction.

Retained failures: zero-budget `report-only-run-xMGYAr` blocked both write and structured_output (inner Pi exit 0, outer wrapper exit 1); `study-run-MPl9z4` required cleanup because queued text was restored into the editor; `study-run-nXFeoe` failed before REQUEST on Kimi 403 quota; `study-run-n8HtMM` failed before REQUEST on DeepSeek 502/503 and was interrupted after the user changed models. None counts as a passing TUI or P3 row.

This validation does not cover P3 or constitute an independent code review. Final P3 validation and strict gate have separate records.

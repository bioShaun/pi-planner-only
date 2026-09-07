# Oracle suite on `/planner-only status`

**Status:** ready-for-agent

One-ticket probe: operators should see which oracle suite the plugin will request without reading source or env docs.

## Problem

`/planner-only status` reports on/off source and the usage log path. It does not say whether the next Validator will be asked for a bounded check (`HEAD` / `git status` / named tests exist) or a full suite (`PI_PLANNER_ONLY_ORACLE=full`).

## Solution

Status prints one extra line from `oracleSuiteMode()` in `roles.ts`: `Oracle suite: bounded` or `Oracle suite: full`.

## Out of scope

Do not change default oracle behavior, Worker contracts, Reviewer packets, or usage accounting.

```json
{
  "version": 1,
  "taskId": "oracle-status-line-01",
  "status": "completed",
  "summary": "Added 'Oracle suite: bounded|full' line to /planner-only status output using oracleSuiteMode() from roles.ts. Extended index.test.mjs to assert the line for default (bounded) and PI_PLANNER_ONLY_ORACLE=full (full). All existing tests pass.",
  "changedFiles": ["index.ts", "index.test.mjs"],
  "validation": [
    {
      "command": "npm test",
      "type": "test",
      "status": "passed",
      "exitCode": 0,
      "summary": "All 14 test suites passed, including the updated status assertions."
    }
  ],
  "evidence": {
    "cwd": "/Users/guilixuan/test/pi/pi-planner-only-kimi-probe",
    "head": "1b103f6c6bff29c5a9a80e073e3921ddccadb72a",
    "commitHash": "1b103f6c6bff29c5a9a80e073e3921ddccadb72a",
    "taskId": "oracle-status-line-01"
  },
  "risks": [],
  "unresolved": []
}
```
# timesheet

A tiny time-sheet report tool: reads a CSV of `project,task,duration` rows and prints totals per group.

## Usage

```
node bin/timesheet.mjs <file.csv> [--group project|task] [--sort total|key] [--format table|json]
```

Example: `node bin/timesheet.mjs hours.csv --group task --format json`

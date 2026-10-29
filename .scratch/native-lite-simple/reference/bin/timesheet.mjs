#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/csv.mjs";
import { buildReport } from "../src/report.mjs";
import { formatDuration } from "../src/duration.mjs";

const USAGE = "usage: timesheet <file.csv> [--group project|task] [--sort total|key] [--format table|json]";
const ALLOWED = { "--group": ["project", "task"], "--sort": ["total", "key"], "--format": ["table", "json"] };
const fail = (code, msg) => { process.stderr.write(`${msg}\n`); process.exit(code); };

function main(argv) {
  const opts = { "--group": "project", "--sort": "total", "--format": "table" };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { files.push(a); continue; }
    if (!(a in ALLOWED)) fail(2, `unknown option: ${a}\n${USAGE}`);
    const v = argv[++i];
    if (!ALLOWED[a].includes(v)) fail(2, `invalid value for ${a}: ${v}\n${USAGE}`);
    opts[a] = v;
  }
  if (files.length !== 1) fail(2, `expected exactly one CSV file\n${USAGE}`);
  let text, table;
  try { text = readFileSync(files[0], "utf8"); } catch (e) { fail(1, `cannot read ${files[0]}: ${e.message}`); }
  try { table = parseCsv(text); } catch (e) { fail(1, `invalid csv: ${e.message}`); }
  const header = table[0] ?? [];
  const cols = ["project", "task", "duration"];
  for (const name of cols) if (!header.includes(name)) fail(2, `missing column: ${name}`);
  const idx = Object.fromEntries(cols.map((n) => [n, header.indexOf(n)]));
  const rows = table.slice(1).map((r) => Object.fromEntries(cols.map((n) => [n, r[idx[n]] ?? ""])));
  let groups;
  try { groups = buildReport(rows, { groupBy: opts["--group"], sort: opts["--sort"] }); } catch (e) { fail(1, e.message); }
  const out = groups.map((g) => ({ key: g.key, count: g.count, total: formatDuration(g.totalMs) }));
  if (opts["--format"] === "json") process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else process.stdout.write(["key\tcount\ttotal", ...out.map((g) => `${g.key}\t${g.count}\t${g.total}`)].map((l) => `${l}\n`).join(""));
}

main(process.argv.slice(2));

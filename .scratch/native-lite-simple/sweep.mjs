#!/usr/bin/env node
// Usage: node sweep.mjs RUN_DIR PGID START_EPOCH_SEC
// SIGKILLs leftover processes started after START that belong to process group/session PGID
// or whose cwd or cmdline is under RUN_DIR. Prints the number killed.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

const [run, pgArg, startArg] = process.argv.slice(2);
const pgid = Number(pgArg), start = Number(startArg);
const ticks = Number(process.env.CLK_TCK || 100);
const btime = Number(readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m)[1]);
const stat = (pid) => readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^[^]*\) /, "").split(" ");
const ancestors = new Set();
for (let p = process.pid; p > 1;) { ancestors.add(p); try { p = Number(stat(p)[1]); } catch { break; } }

const killed = new Set();
for (let pass = 0; pass < 5; pass++) {
  let n = 0;
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d) || ancestors.has(Number(d)) || killed.has(d)) continue;
    let st, cwd = "", cmd = "";
    try { st = stat(d); } catch { continue; }
    // Only processes started at/after the run began, so an older shell parked in RUN_DIR is spared.
    if (st[0] === "Z" || btime + Number(st[19]) / ticks < start - 1) continue;
    try { cwd = readlinkSync(`/proc/${d}/cwd`); } catch {}
    try { cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").replaceAll("\0", " "); } catch {}
    const inGroup = pgid > 1 && (Number(st[2]) === pgid || Number(st[3]) === pgid);
    if (!inGroup && cwd !== run && !cwd.startsWith(`${run}/`) && !cmd.includes(`${run}/`) && !cmd.includes(`${run} `)) continue;
    try { process.kill(Number(d), "SIGKILL"); killed.add(d); n++; } catch {}
  }
  if (!n) break;
  await new Promise((r) => setTimeout(r, 300));
}
console.log(killed.size);

const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const target = process.env.MONITOR_STOP_FAULT_TARGET;
const started = process.env.MONITOR_STOP_FAULT_STARTED;
const marker = process.env.MONITOR_STOP_FAULT_MARKER;
const originalStatSync = fs.statSync;
const originalStat = fs.promises.stat;
function inject(path) {
  if (path !== target || !fs.existsSync(started)) return;
  fs.appendFileSync(marker, `${path}\n`);
  const error = new Error("injected monitor stop EIO");
  error.code = "EIO";
  throw error;
}
fs.statSync = function(path, ...args) { inject(path); return originalStatSync.call(this, path, ...args); };
fs.promises.stat = async function(path, ...args) { inject(path); return originalStat.call(this, path, ...args); };
syncBuiltinESMExports();

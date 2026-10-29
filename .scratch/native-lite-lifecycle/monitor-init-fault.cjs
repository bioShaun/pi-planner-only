const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const write = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  if (process.env.MONITOR_INIT_FAULT && path.basename(String(file)) === "initialized" && args[1]?.flag === "wx") {
    write(process.env.MONITOR_FAULT_MARKER, String(file));
    if (process.env.MONITOR_INIT_FAULT === "io-error") {
      const error = new Error("injected monitor initialization I/O failure");
      error.code = "EIO";
      throw error;
    }
    write(path.join(path.dirname(String(file)), "observations.json"), process.env.MONITOR_INIT_FAULT === "existing" ? '{"version":1,"records":[]}' : "corrupt state", { flag:"wx" });
    write(file, "1", { flag:"wx" });
  }
  return write.call(this, file, ...args);
};
syncBuiltinESMExports();

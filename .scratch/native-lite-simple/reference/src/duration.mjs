const UNITS = [["d", 86400000], ["h", 3600000], ["m", 60000], ["s", 1000], ["ms", 1]];

export function parseDuration(str) {
  if (typeof str !== "string") throw new TypeError("duration must be a string");
  const s = str.trim();
  if (!s) throw new Error("invalid duration: empty");
  const part = /(\d+)(ms|d|h|m|s)\s*/y;
  let pos = 0, last = -1, total = 0;
  while (pos < s.length) {
    part.lastIndex = pos;
    const m = part.exec(s);
    if (!m) throw new Error(`invalid duration: ${str}`);
    const idx = UNITS.findIndex(([u]) => u === m[2]);
    if (idx <= last) throw new Error(`invalid duration: ${str}`);
    last = idx;
    total += Number(m[1]) * UNITS[idx][1];
    pos = part.lastIndex;
  }
  return total;
}

export function formatDuration(ms) {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError("ms must be a non-negative integer");
  if (ms === 0) return "0s";
  let out = "", rest = ms;
  for (const [unit, size] of UNITS) {
    const q = Math.floor(rest / size);
    if (q) { out += `${q}${unit}`; rest -= q * size; }
  }
  return out;
}

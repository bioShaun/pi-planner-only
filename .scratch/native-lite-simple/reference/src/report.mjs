import { parseDuration } from "./duration.mjs";
import { slugify } from "./slugify.mjs";

export function buildReport(rows, options = {}) {
  const { groupBy = "project", sort = "total" } = options;
  if (groupBy !== "project" && groupBy !== "task") throw new Error(`invalid option groupBy: ${groupBy}`);
  if (sort !== "total" && sort !== "key") throw new Error(`invalid option sort: ${sort}`);
  const groups = new Map();
  rows.forEach((row, i) => {
    let ms;
    try { ms = parseDuration(row.duration); } catch (e) { throw new Error(`row ${i + 1}: ${e.message}`); }
    const key = slugify(row[groupBy]);
    const g = groups.get(key) ?? { key, count: 0, totalMs: 0 };
    g.count++; g.totalMs += ms;
    groups.set(key, g);
  });
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return [...groups.values()].sort(sort === "key" ? byKey : (a, b) => b.totalMs - a.totalMs || byKey(a, b));
}

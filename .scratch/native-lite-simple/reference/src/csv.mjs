export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  if (text === "") return rows;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    const eol = c === "\n" ? 1 : c === "\r" && text[i + 1] === "\n" ? 2 : 0;
    if (eol) {
      row.push(field); rows.push(row); row = []; field = ""; i += eol;
      if (i === text.length) return rows;
      continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error("unterminated quote");
  row.push(field); rows.push(row);
  return rows;
}

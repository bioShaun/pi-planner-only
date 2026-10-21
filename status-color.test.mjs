import assert from "node:assert/strict";
import { heatColor, hostColorToRgb } from "./status-color.ts";

const rgb = (color) => ({ kind: "rgb", r: color.r, g: color.g, b: color.b });
const text = (color) => `${color.r},${color.g},${color.b}`;

// The grok-open theme stops the fixtures below were computed with.
const COOL = { kind: "rgb", r: 122, g: 162, b: 247 };
const MID = { kind: "rgb", r: 224, g: 175, b: 104 };
const HOT = { kind: "rgb", r: 247, g: 118, b: 142 };

// Host colors convert in all three shapes, matching pi-tui's own color math.
assert.deepEqual(hostColorToRgb({ kind: "rgb", r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
assert.deepEqual(hostColorToRgb({ kind: "indexed", index: 1 }), { r: 128, g: 0, b: 0 });
assert.deepEqual(hostColorToRgb({ kind: "indexed", index: 16 }), { r: 0, g: 0, b: 0 });
assert.deepEqual(hostColorToRgb({ kind: "indexed", index: 232 }), { r: 8, g: 8, b: 8 });
assert.deepEqual(hostColorToRgb({ kind: "indexed", index: 255 }), { r: 238, g: 238, b: 238 });
assert.deepEqual(hostColorToRgb({ kind: "oklch", l: 1, c: 0, h: 0 }), { r: 255, g: 255, b: 255 });
assert.deepEqual(hostColorToRgb({ kind: "oklch", l: 0.5, c: 0, h: 250 }), { r: 99, g: 99, b: 99 });
// Out of gamut: hue and lightness are kept and chroma is reduced until the color fits.
assert.deepEqual(hostColorToRgb({ kind: "oklch", l: 0.5, c: 0.4, h: 150 }), { r: 0, g: 120, b: 53 });

// The ramp is exact at its stops and returns a color the host's theme.style accepts.
assert.deepEqual(heatColor(0, COOL, MID, HOT), rgb(COOL));
assert.deepEqual(heatColor(0.5, COOL, MID, HOT), rgb(MID));
assert.deepEqual(heatColor(1, COOL, MID, HOT), rgb(HOT));
assert.equal(heatColor(0.25, COOL, MID, HOT).kind, "rgb");

// Fixed points pin the interpolation: teal-green below the midpoint, orange above it.
assert.equal(text(heatColor(0.2, COOL, MID, HOT)), "42,197,187");
assert.equal(text(heatColor(0.75, COOL, MID, HOT)), "244,145,104");

// Fractions clamp, and a non-finite one falls back to the cool end.
assert.deepEqual(heatColor(-1, COOL, MID, HOT), rgb(COOL));
assert.deepEqual(heatColor(2, COOL, MID, HOT), rgb(HOT));
assert.deepEqual(heatColor(NaN, COOL, MID, HOT), rgb(COOL));

// Heating up travels blue → cyan → green → yellow; a shortest-hue mix would
// detour through magenta, where red and blue both outweigh green.
for (let i = 0; i <= 10; i++) {
	const t = i / 20;
	const { r, g, b } = heatColor(t, COOL, MID, HOT);
	assert.ok(!(r > g && b > g), `t=${t} stays out of magenta (got ${r},${g},${b})`);
}
assert.equal(text(heatColor(0.25, COOL, MID, HOT)), "81,199,163");

// An achromatic stop borrows the other stop's hue: gray warms into amber, with no magenta or cyan detour.
assert.equal(text(heatColor(0.25, { kind: "rgb", r: 136, g: 136, b: 136 }, MID, HOT)), "180,156,124");

// Indexed stops work the same way (the terminal palette is resolved to sRGB).
assert.equal(text(heatColor(0, { kind: "indexed", index: 12 }, MID, HOT)), "0,0,255");

console.log("status-color.test: ok");

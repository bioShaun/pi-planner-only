/**
 * Status-line color: Root context heat taken from the theme's own palette.
 *
 * Colors are read and built structurally in the host's pi-tui `Color` shapes,
 * so this module imports nothing from `@earendil-works/pi-tui`: hosts before
 * pi 0.99 do not export its color helpers, and a named import would fail the
 * whole plugin load there. The OKLCH conversion mirrors pi-tui's
 * `colors.ts`/`oklab.js` (Oklab and OKHSL are Björn Ottosson's color spaces,
 * MIT), so the ramp matches the colors the host's own helpers would produce.
 */

/** Structural pi-tui `Color`: an ANSI index, sRGB, or OKLCH. */
export type HostColor =
	| { kind: "indexed"; index: number }
	| { kind: "rgb"; r: number; g: number; b: number }
	| { kind: "oklch"; l: number; c: number; h: number };

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

const BASIC_COLORS: Rgb[] = [
	{ r: 0, g: 0, b: 0 },
	{ r: 128, g: 0, b: 0 },
	{ r: 0, g: 128, b: 0 },
	{ r: 128, g: 128, b: 0 },
	{ r: 0, g: 0, b: 128 },
	{ r: 128, g: 0, b: 128 },
	{ r: 0, g: 128, b: 128 },
	{ r: 192, g: 192, b: 192 },
	{ r: 128, g: 128, b: 128 },
	{ r: 255, g: 0, b: 0 },
	{ r: 0, g: 255, b: 0 },
	{ r: 255, g: 255, b: 0 },
	{ r: 0, g: 0, b: 255 },
	{ r: 255, g: 0, b: 255 },
	{ r: 0, g: 255, b: 255 },
	{ r: 255, g: 255, b: 255 },
];
const CUBE_VALUES = [0, 95, 135, 175, 215, 255];

/** sRGB (0-255) for any host color; an ANSI index uses the xterm palette, as pi-tui does. */
export function hostColorToRgb(color: HostColor): Rgb {
	if (color.kind === "rgb") return { r: color.r, g: color.g, b: color.b };
	if (color.kind === "oklch") return oklchToRgb(color);
	const index = color.index;
	if (index < 16) return { ...BASIC_COLORS[index] };
	if (index < 232) {
		const cube = index - 16;
		return {
			r: CUBE_VALUES[Math.floor(cube / 36)],
			g: CUBE_VALUES[Math.floor((cube % 36) / 6)],
			b: CUBE_VALUES[cube % 6],
		};
	}
	const gray = 8 + (index - 232) * 10;
	return { r: gray, g: gray, b: gray };
}

const srgbToLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (value: number) => (value > 0.0031308 ? 1.055 * value ** (1 / 2.4) - 0.055 : 12.92 * value);

const LINEAR_SRGB_TO_LMS = [
	[0.4122214694707629, 0.5363325372617349, 0.0514459932675022],
	[0.2119034958178251, 0.6806995506452344, 0.1073969535369405],
	[0.0883024591900564, 0.2817188391361215, 0.6299787016738222],
];
const LMS_TO_LAB = [
	[0.210454268309314, 0.793617774702305, -0.0040720430116193],
	[1.9779985324311684, -2.42859224204858, 0.450593709617411],
	[0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LAB_TO_LMS = [
	[1, 0.3963377773761749, 0.2158037573099136],
	[1, -0.1055613458156586, -0.0638541728258133],
	[1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_LINEAR_SRGB = [
	[4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
	[-1.2684379732850315, 2.6097573492876882, -0.341319376002657],
	[-0.0041960761386756, -0.7034186179359362, 1.7076146940746117],
];

const multiply = (m: number[][], [x, y, z]: number[]) => m.map((row) => row[0] * x + row[1] * y + row[2] * z);
const labToLinearSrgb = (lab: number[]) => multiply(LMS_TO_LINEAR_SRGB, multiply(LAB_TO_LMS, lab).map((value) => value ** 3));

/** RGB (0-255) to OKLCH. */
function rgbToOklch({ r, g, b }: Rgb): { l: number; c: number; h: number } {
	const [l, a, bb] = multiply(LMS_TO_LAB, multiply(LINEAR_SRGB_TO_LMS, [r / 255, g / 255, b / 255].map(srgbToLinear)).map(Math.cbrt));
	return { l, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

/**
 * OKLCH to sRGB (0-255). An out-of-gamut color keeps its hue and lightness and
 * loses chroma until it fits, as pi-tui does; the achromatic color always fits,
 * so the search cannot fail.
 */
function oklchToRgb({ l, c, h }: { l: number; c: number; h: number }): Rgb {
	const radians = (h * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const atChroma = (chroma: number) => labToLinearSrgb([l, chroma * cos, chroma * sin]);
	const inGamut = (linear: number[]) => linear.every((value) => value >= -1e-7 && value <= 1 + 1e-7);
	const toRgb = (linear: number[]): Rgb => {
		const [r, g, b] = linear.map((value) => Math.round(Math.min(1, Math.max(0, linearToSrgb(value))) * 255));
		return { r, g, b };
	};
	const direct = atChroma(c);
	if (inGamut(direct)) return toRgb(direct);
	let linear = atChroma(0);
	let low = 0;
	let high = c;
	for (let index = 0; index < 20; index++) {
		const chroma = (low + high) / 2;
		const candidate = atChroma(chroma);
		if (inGamut(candidate)) {
			low = chroma;
			linear = candidate;
		} else {
			high = chroma;
		}
	}
	return toRgb(linear);
}

/**
 * Status color for Root context heat: `fraction` 0 gives `cool`, 0.5 gives
 * `mid`, and 1 gives `hot`, linear in OKLCH between the stops. Hue always
 * travels downward (blue → cyan → green → yellow → red), the direction that
 * reads as heating up; the shortest-hue path would detour through magenta.
 */
export function heatColor(fraction: number, cool: HostColor, mid: HostColor, hot: HostColor): HostColor {
	const t = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
	const stops = [cool, mid, hot].map((color) => rgbToOklch(hostColorToRgb(color)));
	const [from, to] = t <= 0.5 ? stops : stops.slice(1);
	const leg = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
	// An achromatic stop has no hue of its own; it borrows the other stop's, as pi-tui's mixes do.
	const fromHue = from.c < 1e-7 ? to.h : from.h;
	const toHue = to.c < 1e-7 ? fromHue : to.h;
	const downward = ((toHue - fromHue) % 360 + 360) % 360;
	const hue = ((fromHue + (downward === 0 ? 0 : downward - 360) * leg) % 360 + 360) % 360;
	return {
		kind: "rgb",
		...oklchToRgb({ l: from.l + (to.l - from.l) * leg, c: from.c + (to.c - from.c) * leg, h: hue }),
	};
}

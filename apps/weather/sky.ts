/**
 * The sky ramp — the single highest-value thing this app does.
 *
 * The gradient is driven by where the sun actually is at the configured
 * coordinates, interpolating between four keyed palettes across the day.
 * That is why the panel tells you the weather before you read a digit: at a
 * glance the colour is the time of day and the mood is the conditions.
 */

import type { Scene } from "./types";

export type Stops = [string, string, string];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const NIGHT: Rgb[] = [
  { r: 5, g: 6, b: 16 },
  { r: 10, g: 14, b: 34 },
  { r: 22, g: 28, b: 58 },
];
const DAWN: Rgb[] = [
  { r: 24, g: 20, b: 62 },
  { r: 116, g: 56, b: 84 },
  { r: 236, g: 142, b: 78 },
];
const DAY: Rgb[] = [
  { r: 27, g: 78, b: 150 },
  { r: 78, g: 134, b: 190 },
  { r: 156, g: 196, b: 224 },
];
const DUSK: Rgb[] = [
  { r: 26, g: 20, b: 64 },
  { r: 132, g: 58, b: 78 },
  { r: 244, g: 146, b: 74 },
];

const hex2 = (v: number): string => {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  const d = "0123456789ABCDEF";
  return d[Math.floor(n / 16)] + d[n % 16];
};

const toHex = (c: Rgb): string => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

const blend = (a: Rgb[], b: Rgb[], t: number): Rgb[] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** Pull a palette toward grey — how overcast reads as a colour. */
function desaturate(stops: Rgb[], amount: number): Rgb[] {
  return stops.map((c) => {
    const l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
    return mix(c, { r: l, g: l, b: l }, amount);
  });
}

/** Scale toward black — how a storm reads as a colour. */
function darken(stops: Rgb[], amount: number): Rgb[] {
  return stops.map((c) => ({ r: c.r * amount, g: c.g * amount, b: c.b * amount }));
}

/**
 * Blend the four keyed palettes across the day. Twilight gets a wide window
 * either side of the horizon crossing because that is when the sky is most
 * obviously changing, and a panel that tracks it feels alive.
 */
function timeOfDay(nowSec: number, sunriseSec: number, sunsetSec: number): Rgb[] {
  if (!sunriseSec || !sunsetSec || sunsetSec <= sunriseSec) {
    return DAY;
  }
  const TWILIGHT = 3600;
  const SETTLE = 1800;

  if (nowSec < sunriseSec - TWILIGHT) return NIGHT;
  if (nowSec < sunriseSec) {
    return blend(NIGHT, DAWN, (nowSec - (sunriseSec - TWILIGHT)) / TWILIGHT);
  }
  if (nowSec < sunriseSec + SETTLE) {
    return blend(DAWN, DAY, (nowSec - sunriseSec) / SETTLE);
  }
  if (nowSec < sunsetSec - SETTLE) return DAY;
  if (nowSec < sunsetSec) {
    return blend(DAY, DUSK, (nowSec - (sunsetSec - SETTLE)) / SETTLE);
  }
  if (nowSec < sunsetSec + TWILIGHT) {
    return blend(DUSK, NIGHT, (nowSec - sunsetSec) / TWILIGHT);
  }
  return NIGHT;
}

export function skyStops(
  nowSec: number,
  sunriseSec: number,
  sunsetSec: number,
  scene: Scene,
): Stops {
  let stops = timeOfDay(nowSec, sunriseSec, sunsetSec);
  if (scene === "cloudy" || scene === "fog") stops = desaturate(stops, 0.55);
  if (scene === "rain" || scene === "sleet") stops = darken(desaturate(stops, 0.4), 0.62);
  if (scene === "snow") stops = desaturate(stops, 0.5);
  if (scene === "thunder") stops = darken(desaturate(stops, 0.5), 0.42);
  return [toHex(stops[0]), toHex(stops[1]), toHex(stops[2])];
}

/** True when the celestial body drawn should be the moon. */
export function isNight(nowSec: number, sunriseSec: number, sunsetSec: number): boolean {
  if (!sunriseSec || !sunsetSec) return false;
  return nowSec < sunriseSec || nowSec > sunsetSec;
}

/**
 * Where the sun or moon sits, as a fraction across its own arc. Used to
 * place the disc, so it is low at dawn and dusk and high at midday.
 */
export function arcPosition(nowSec: number, sunriseSec: number, sunsetSec: number): number {
  const night = isNight(nowSec, sunriseSec, sunsetSec);
  if (!sunriseSec || !sunsetSec) return 0.5;
  if (!night) {
    return Math.max(0, Math.min(1, (nowSec - sunriseSec) / (sunsetSec - sunriseSec)));
  }
  const dayLen = sunsetSec - sunriseSec;
  const nightLen = 86400 - dayLen;
  const since = nowSec > sunsetSec ? nowSec - sunsetSec : nowSec + 86400 - sunsetSec;
  return Math.max(0, Math.min(1, since / nightLen));
}

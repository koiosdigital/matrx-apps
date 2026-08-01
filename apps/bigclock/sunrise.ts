/**
 * Sunrise/sunset calculation — replaces pixlet's `sunrise` module.
 * The standard sunrise-equation formulation (as popularized by suncalc):
 * solar-cycle based, so the returned instants are absolute epoch ms for the
 * solar day containing `ms`, correct at any longitude (no UTC-midnight
 * wraparound). Pure math, deterministic for fixed inputs.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
/** Obliquity of the Earth. */
const E = RAD * 23.4397;
/** "Official" sunrise/sunset altitude (refraction + solar disc radius). */
const H0 = RAD * -0.833;

function toJulian(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970;
}

function fromJulian(j: number): number {
  return (j + 0.5 - J1970) * DAY_MS;
}

function solarMeanAnomaly(ds: number): number {
  return RAD * (357.5291 + 0.98560028 * ds);
}

function eclipticLongitude(m: number): number {
  const center = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const perihelion = RAD * 102.9372;
  return m + center + perihelion + Math.PI;
}

function solarTransitJ(ds: number, m: number, l: number): number {
  return J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
}

/** Sunrise and sunset for the solar day containing `ms`, as epoch ms.
 * Either is null during polar day/night. */
export function sunTimes(lat: number, lng: number, ms: number): { rise: number | null; set: number | null } {
  const lw = RAD * -lng;
  const phi = RAD * lat;

  const d = toJulian(ms) - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;

  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = Math.asin(Math.sin(l) * Math.sin(E));

  const cosW = (Math.sin(H0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW > 1 || cosW < -1) return { rise: null, set: null }; // polar day/night

  const w = Math.acos(cosW);
  const jNoon = solarTransitJ(ds, m, l);
  const jSet = solarTransitJ(0.0009 + (w + lw) / (2 * Math.PI) + n, m, l);
  const jRise = jNoon - (jSet - jNoon);

  return { rise: fromJulian(jRise), set: fromJulian(jSet) };
}

export function sunrise(lat: number, lng: number, ms: number): number | null {
  return sunTimes(lat, lng, ms).rise;
}

export function sunset(lat: number, lng: number, ms: number): number | null {
  return sunTimes(lat, lng, ms).set;
}

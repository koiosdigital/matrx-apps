/**
 * WeatherKit REST client.
 *
 * Auth is a short-lived ES256 JWT. `apps/flights/signing.ts` already proves
 * `crypto.subtle` is available inside the render isolate and that
 * `secret.decrypt` is the right custody mechanism for a baked key; this
 * swaps HMAC-SHA256 for ECDSA P-256 and adds the `id` header claim Apple
 * requires.
 *
 * To bake the credentials:
 *
 *     npx matrx secret encrypt weather "$(cat AuthKey_XXXXXXXXXX.p8)"
 *
 * and paste the resulting `MTX1:` string into ENCRYPTED_PRIVATE_KEY, then
 * fill in KEY_ID / TEAM_ID / SERVICE_ID below (those three are identifiers,
 * not secrets — only the .p8 needs encrypting).
 *
 * The signed token is cached for 40 minutes against a 60-minute expiry, so
 * the ECDSA sign runs about once an hour per installation rather than on
 * every render.
 */

import { cache, http, secret, time } from "@koiosdigital/matrx-sdk/stdlib";

import type { Conditions, Scene } from "./types";

const API = "https://weatherkit.apple.com/api/v1/weather";

const ENCRYPTED_PRIVATE_KEY = "MTX1:BF5P60qbTfhykefr+gBJHafAhyXtUkbHSKsKd0Z5z83fUAGbIMXlQwrtVBR2ZQRlgppXdl6UEF7q3/pD8+fkDhdvPc1HwlFVX2KsNpETldRrozk6/PFpK60hgOvxjEpXqa45kDv8M1Sldhj3Sq7lFU3te2TFRnO6co54nBBlOU9TEMG2PTA5XH9dsngPWs8mxD8BeETyleS1a6Vxc4m19wafrLchwV+tecAxg9Ms6r2fFQVbrB/Bp0Qju+yUSD2izR76VE7lGXvtAFdD3VZB/FKczxfrYvhALOzkEwS87m8bQdXNkBvRQzIdH3O0Ug2FRr3A1bjfGQNsQnqI0rmCQL5fjyfS9bTIKqi4yCDfLgthv1y5UFAG3gA787eTZzuHpxCAJtYXYanexrStiqgBPiPM2zmeIOegcapNAGWIAoUXQP9xzbO7GzCtArVvdRuIOp2ih5TM3cdp5U85qLE=";
const KEY_ID = "BYLT76638Y";
const TEAM_ID = "9R8RREG67J";
const SERVICE_ID = "net.koiosdigital.matrx-weatherkit";

const TOKEN_TTL = 3600;
const TOKEN_CACHE_TTL = 2400;
const DATA_TTL = 600;
const LAST_GOOD_TTL = 21600;

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlText(text: string): string {
  return b64url(new Uint8Array(encoder.encode(text)));
}

/** PEM (PKCS#8) → raw DER bytes. Explicit buffer type so it satisfies
 *  `BufferSource` — the same annotation `flights/signing.ts` needs. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Mint (or reuse) a WeatherKit bearer token. `iat` is quantised to the
 * render bucket, so within a bucket every device produces the same token
 * and the cache actually hits.
 */
async function bearerToken(nowSec: number): Promise<string | null> {
  const cached = await cache.get("wk:jwt");
  if (cached) return cached;

  let pem: string | null = null;
  try {
    pem = await secret.decrypt(ENCRYPTED_PRIVATE_KEY);
  } catch {
    pem = null;
  }
  if (!pem) return null;

  const header = { alg: "ES256", kid: KEY_ID, id: `${TEAM_ID}.${SERVICE_ID}`, typ: "JWT" };
  const claims = {
    iss: TEAM_ID,
    sub: SERVICE_ID,
    iat: nowSec,
    exp: nowSec + TOKEN_TTL,
  };
  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto emits the raw r||s pair ES256 wants — no DER unwrapping.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new Uint8Array(encoder.encode(signingInput)),
  );
  const token = `${signingInput}.${b64url(new Uint8Array(sig))}`;
  await cache.set("wk:jwt", token, TOKEN_CACHE_TTL);
  return token;
}

/* ------------------------------------------------------------------ */

const RAIN = [
  "Drizzle",
  "Rain",
  "HeavyRain",
  "Showers",
  "ScatteredShowers",
  "FreezingRain",
  "FreezingDrizzle",
  "SunShowers",
];
const SNOW = [
  "Flurries",
  "Snow",
  "HeavySnow",
  "SnowShowers",
  "ScatteredSnowShowers",
  "Blizzard",
  "BlowingSnow",
  "SunFlurries",
  "Frigid",
];
const SLEET = [
  "Sleet",
  "Hail",
  "MixedRainAndSleet",
  "MixedRainAndSnow",
  "MixedSnowAndSleet",
  "MixedRainfallAndHail",
  "MixedRainfall",
];
const THUNDER = [
  "IsolatedThunderstorms",
  "ScatteredThunderstorms",
  "Thunderstorms",
  "SevereThunderstorm",
  "Thunderstorm",
  "StrongStorms",
];
const WIND = ["Breezy", "Windy", "Hurricane", "TropicalStorm", "Tornado"];
const FOG = ["Foggy", "Fog", "Haze", "Smoke", "Dust", "Smoky"];
const CLOUDY = ["Cloudy", "MostlyCloudy"];

/** ~40 WeatherKit condition codes collapse into nine drawable scenes. */
export function sceneOf(code: string): Scene {
  if (THUNDER.includes(code)) return "thunder";
  if (SLEET.includes(code)) return "sleet";
  if (SNOW.includes(code)) return "snow";
  if (RAIN.includes(code)) return "rain";
  if (FOG.includes(code)) return "fog";
  if (WIND.includes(code)) return "wind";
  if (CLOUDY.includes(code)) return "cloudy";
  if (code === "PartlyCloudy") return "partly";
  if (code === "Clear" || code === "MostlyClear" || code === "Hot") return "clear";
  return "partly";
}

interface WkResponse {
  currentWeather?: {
    conditionCode?: string;
    daylight?: boolean;
    temperature?: number;
    temperatureApparent?: number;
    windSpeed?: number;
  };
  forecastDaily?: {
    days?: {
      temperatureMax?: number;
      temperatureMin?: number;
      precipitationChance?: number;
      sunrise?: string;
      sunset?: string;
    }[];
  };
  forecastHourly?: { hours?: { temperature?: number }[] };
  weatherAlerts?: { alerts?: { description?: string }[] };
}

const CACHE_KEY = (lat: number, lng: number) => `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;

export async function fetchConditions(
  lat: number,
  lng: number,
  timezone: string,
  nowSec: number,
): Promise<Conditions> {
  const token = await bearerToken(nowSec);
  if (!token) return demoConditions(nowSec, timezone);

  let parsed: Conditions | null = null;
  try {
    const res = await http.get(`${API}/en/${lat.toFixed(4)}/${lng.toFixed(4)}`, {
      params: {
        dataSets: "currentWeather,forecastDaily,forecastHourly,weatherAlerts",
        timezone,
      },
      headers: { Authorization: `Bearer ${token}` },
      ttlSeconds: DATA_TTL,
    });
    if (res.status === 200) parsed = flatten(res.json() as WkResponse);
  } catch {
    parsed = null;
  }

  if (parsed) {
    await cache.set(
      CACHE_KEY(lat, lng),
      JSON.stringify({ at: nowSec, data: parsed }),
      LAST_GOOD_TTL,
    );
    return parsed;
  }

  // An hour-old sky is still broadly true; a blank panel never is.
  const raw = await cache.get(CACHE_KEY(lat, lng));
  if (raw) {
    try {
      const saved = JSON.parse(raw) as { at: number; data: Conditions };
      return { ...saved.data, ageSeconds: Math.max(0, nowSec - saved.at) };
    } catch {
      /* fall through to the example payload */
    }
  }
  return demoConditions(nowSec, timezone);
}

function flatten(body: WkResponse): Conditions | null {
  const cur = body.currentWeather;
  if (!cur || cur.temperature === undefined) return null;
  const day = body.forecastDaily?.days?.[0];
  const hours = (body.forecastHourly?.hours ?? [])
    .slice(0, 12)
    .map((h) => h.temperature ?? cur.temperature ?? 0);

  const parseSec = (iso: string | undefined): number => {
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  };

  return {
    scene: sceneOf(cur.conditionCode ?? ""),
    daylight: cur.daylight !== false,
    tempC: cur.temperature,
    feelsC: cur.temperatureApparent ?? cur.temperature,
    highC: day?.temperatureMax ?? cur.temperature,
    lowC: day?.temperatureMin ?? cur.temperature,
    precipChance: day?.precipitationChance ?? 0,
    windKph: cur.windSpeed ?? 0,
    sunriseSec: parseSec(day?.sunrise),
    sunsetSec: parseSec(day?.sunset),
    hourlyC: hours.length > 1 ? hours : [cur.temperature, cur.temperature],
    alert: body.weatherAlerts?.alerts?.[0]?.description ?? "",
    ageSeconds: 0,
    demo: false,
  };
}

/**
 * Example payload for an unconfigured install and for the gallery preview.
 * Deterministic, and shaped to exercise the layout rather than flatter it.
 */
export function demoConditions(nowSec: number, timezone: string): Conditions {
  // Sun times are built from local midnight, not UTC midnight, so the
  // preview reads correctly wherever it is shown.
  const local = time.fromUnix(nowSec).inLocation(timezone);
  const at = (hour: number, minute: number): number =>
    time.time({ year: local.year, month: local.month, day: local.day, hour, minute, location: timezone }).unix;
  return {
    scene: "partly",
    daylight: true,
    tempC: 22.2,
    feelsC: 20.6,
    highC: 27.2,
    lowC: 14.4,
    precipChance: 0.2,
    windKph: 13,
    sunriseSec: at(6, 41),
    sunsetSec: at(19, 49),
    hourlyC: [22.2, 22.8, 23.9, 25.0, 26.1, 27.2, 26.7, 25.6, 24.4, 22.8, 21.1, 19.4],
    alert: "",
    ageSeconds: 0,
    demo: true,
  };
}

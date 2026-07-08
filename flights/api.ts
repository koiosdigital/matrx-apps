/**
 * Data fetching + processing, ported from the Starlark `#MARK: Data Fetching`
 * section.
 *
 * Differences forced by the SDK surface:
 *  - `cache` is async here (host-injected), so `pickFlight` is async.
 *  - The Starlark weighted pick seeded its PRNG from `time.now().nanosecond`;
 *    the SDK has no sub-ms field and blesses `Math.random()` as deterministic
 *    and quantized inside the render isolate (§8), so we seed from that.
 *  - `http` is text-only, so the airline logo is fetched with raw `fetch()`
 *    and handed to Image as bytes; matrx-render decodes it (PNG/GIF/WebP/JPEG).
 */

import { cache, http } from "@koiosdigital/matrx-sdk/stdlib";

import { computeSignature } from "./signing";
import type { FlightDetail, NearbyFlight } from "./types";

const AERONAV_API = "https://flights-api.koiosdigital.net";

/**
 * Build a URL under the API base with the given query params. Insertion order
 * is preserved so the signed `pathname + search` matches the wire request (the
 * http wrapper and the server both serialize via `new URL().toString()`).
 */
function buildUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(AERONAV_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function getNearbyFlights(
  geojsonStr: string,
  unit: string,
  speedUnit: string,
): Promise<NearbyFlight[] | null> {
  const url = buildUrl("/flights/nearby", { unit, speed_unit: speedUnit });
  const signature = await computeSignature("POST", url.pathname + url.search, geojsonStr);
  const res = await http.post(url.toString(), {
    headers: { "Content-Type": "application/json", "X-Request-Signature": signature },
    body: geojsonStr,
    ttlSeconds: 60,
  });
  if (res.status !== 200) return null;
  return res.json() as NearbyFlight[];
}

export async function getFlightDetail(
  flightId: string,
  lat: number,
  lng: number,
  unit: string,
  speedUnit: string,
): Promise<FlightDetail | null> {
  const params: Record<string, string> = { unit, speed_unit: speedUnit };
  if (lat !== 0.0 || lng !== 0.0) {
    params.lat = String(lat);
    params.lng = String(lng);
  }
  const url = buildUrl(`/flights/${flightId}`, params);
  const signature = await computeSignature("GET", url.pathname + url.search, "");
  const res = await http.get(url.toString(), {
    headers: { "X-Request-Signature": signature },
    ttlSeconds: 120,
  });
  if (res.status !== 200) return null;
  return res.json() as FlightDetail;
}

export async function pickFlight(
  flights: NearbyFlight[],
): Promise<NearbyFlight | null> {
  if (!flights || flights.length === 0) return null;
  if (flights.length === 1) return flights[0];

  // Weight by inverse distance: closer flights get higher weight.
  const weights: number[] = [];
  for (const f of flights) {
    let d = f.distance ?? 999999.0;
    if (d <= 0) d = 0.1;
    weights.push(1.0 / d);
  }

  // Reduce weight of the last-shown flight to encourage variety.
  const lastId = await cache.get("last_flight_id");
  if (lastId) {
    for (let i = 0; i < flights.length; i++) {
      if (flights[i].id === lastId && flights.length > 1) {
        weights[i] = weights[i] * 0.15;
      }
    }
  }

  // Weighted random selection (Math.random is deterministic in-isolate).
  let total = 0.0;
  for (const w of weights) total += w;
  const target = Math.random() * total;
  let cumulative = 0.0;
  let picked = flights[0];
  for (let i = 0; i < flights.length; i++) {
    cumulative += weights[i];
    if (cumulative >= target) {
      picked = flights[i];
      break;
    }
  }

  const pickedId = picked.id ?? "";
  if (pickedId) await cache.set("last_flight_id", pickedId, 300);
  return picked;
}

export async function fetchLogo(url: string | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  // Fetch the airline logo directly (24h TTL); Image scales it to logo size.
  const res = await fetch(url, { headers: { "x-matrx-ttl": "86400" } });
  if (res.status !== 200) return null;
  return new Uint8Array(await res.arrayBuffer());
}

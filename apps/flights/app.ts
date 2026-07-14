/**
 * Flights — hand port of `flights/flights.star` from koiosdigital/matrx-apps,
 * kept structurally faithful: same layouts, colors, fonts, subscreen cycling
 * and weighted flight selection. Split across modules (format / api / animation
 * / screens / schema) for readability; the entry re-exports the schema and its
 * generated-field handler so the host can find them as named exports.
 *
 * Differences from the Starlark original, forced by the SDK surface:
 *  - `return []` ("skip this render" in pixlet) becomes `return null` — the
 *    runtime emits zero frames and the device skips the slot (see spotify port).
 *  - `cache` is async, so the weighted picker (api.ts) is async and awaited.
 *  - The airline logo is fetched directly (api.ts) — matrx-render decodes it.
 *  - `main_align="left"/"top"` (pixlet-lenient) → `"start"` (SDK MainAlign).
 *
 * Faithful quirk preserved: like the original, `main` computes `delay` in
 * renderFlight but does not pass it to Root.
 */

import {
  Config,
  Padding,
  Root,
  type RootSpec,
} from "@koiosdigital/matrx-sdk";

import {
  getFlightDetail,
  getNearbyFlights,
  fetchLogo,
  pickFlight,
  searchFlights,
} from "./api";
import { pad } from "./format";
import { renderFlight } from "./screens";
import type { AnimConfig, FlightData, FlightDetail, NearbyFlight } from "./types";

const DEFAULT_LOCATION =
  '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"role":"point"},"geometry":{"type":"Point","coordinates":[-86.92,40.42]}},{"type":"Feature","properties":{"role":"polygon"},"geometry":{"type":"Polygon","coordinates":[[[-87.42,40.92],[-86.42,40.92],[-86.42,39.92],[-87.42,39.92],[-87.42,40.92]]]}}]}';

interface LocationGeoJSON {
  features: Array<{
    properties: { role?: string };
    geometry: { coordinates: number[] };
  }>;
}

/**
 * Weighted-pick a nearby flight and fetch its detail. When `skipArrived` is set,
 * re-pick past already-arrived flights (and detail misses) up to a few times,
 * returning null if every attempt is arrived so the render is skipped.
 */
async function pickFlightDetail(
  flights: NearbyFlight[],
  lat: number,
  lng: number,
  unit: string,
  speed: string,
  skipArrived: boolean,
): Promise<FlightDetail | null> {
  const remaining = [...flights];
  const maxAttempts = skipArrived ? 4 : 1;
  for (let attempt = 0; attempt < maxAttempts && remaining.length > 0; attempt++) {
    const picked = await pickFlight(remaining);
    if (!picked) break;
    const idx = remaining.findIndex((f) => f.id === picked.id);
    if (idx >= 0) remaining.splice(idx, 1);
    const detail = await getFlightDetail(picked.id, lat, lng, unit, speed);
    if (!detail) continue;
    if (skipArrived && detail.status?.arrived) continue;
    return detail;
  }
  return null;
}

export default async function render(config: Config): Promise<RootSpec | null> {
  const width = config.width();
  const height = config.height();
  const metric = config.bool("metric");
  const unit = metric ? "km" : "mi";

  // Animation config.
  const animStyle = config.get("anim_style") || "slide_up";
  const displayDuration = config.int("display_duration", 3);
  const holdFrames = displayDuration * 10; // at 100ms per frame

  const showTiming = config.get("show_timing");
  const showTelemetry = config.get("show_telemetry");
  const showAirports = config.get("show_airports");
  const showStatus = config.get("show_status");

  const animConfig: AnimConfig = {
    style: animStyle,
    holdFrames,
    transitionFrames: 10,
    showTiming: showTiming !== undefined ? showTiming !== "false" : true,
    showTelemetry: showTelemetry !== undefined ? showTelemetry !== "false" : true,
    showAirports: showAirports !== undefined ? showAirports === "true" : false,
    showStatus: showStatus !== undefined ? showStatus !== "false" : true,
    metric,
    callsignColor: config.get("callsign_color") || "#0af",
    routeCode: config.get("route_code") || "iata",
    expandedCallsign: config.bool("expanded_callsign", true),
  };

  const unitParam = metric ? "metric" : "imperial";
  const speedParam = metric ? "kilometers" : "knots";
  const trackSpecific = config.get("track_specific_flight") === "true";
  const specificFlight = (config.get("specific_flight") || "").trim();
  const skipArrived = config.get("skip_arrived") === "true";

  let centerLat = 0.0;
  let centerLng = 0.0;
  let detail: FlightDetail | null = null;

  if (trackSpecific && specificFlight) {
    // Specific-flight mode: resolve the stored callsign to the live instance
    // (its FR24 id changes per flight), then fetch its detail. No observer
    // location in this mode, so distance is omitted.
    const matches = await searchFlights(specificFlight);
    if (matches.length === 0) return null;
    detail = await getFlightDetail(matches[0].id, 0, 0, unitParam, speedParam);
    if (!detail) return null;
    if (skipArrived && detail.status?.arrived) return null;
  } else {
    const locStr = config.get("location") || DEFAULT_LOCATION;

    // Extract observer coordinates from GeoJSON.
    const loc = JSON.parse(locStr) as LocationGeoJSON;
    for (const feat of loc.features) {
      if (feat.properties.role === "point") {
        const coords = feat.geometry.coordinates;
        centerLng = coords[0];
        centerLat = coords[1];
      }
    }

    // Find nearby flights via API.
    const flights = await getNearbyFlights(locStr, unitParam, speedParam);
    if (!flights || flights.length === 0) return null;

    detail = await pickFlightDetail(flights, centerLat, centerLng, unitParam, speedParam, skipArrived);
    if (!detail) return null;
  }

  const ident = detail.identification ?? {};
  const aircraftInfo = detail.aircraft ?? {};
  const routeInfo = detail.route ?? {};
  const telemetry = detail.telemetry ?? {};
  const observer = detail.observer ?? {};
  const timing = detail.timing ?? {};
  const units = detail.units ?? {};

  // Carrier display name.
  const carrier = animConfig.expandedCallsign
    ? ident.displayName || ident.callsign || ""
    : ident.callsign || ident.displayName || "";

  // Route.
  let originIata = "";
  let destIata = "";
  let originIcao = "";
  let destIcao = "";
  let originName: string | null = null;
  let destName: string | null = null;
  if (routeInfo.origin) {
    originIata = routeInfo.origin.iata || "";
    originIcao = routeInfo.origin.icao || "";
    originName = routeInfo.origin.name ?? null;
  }
  if (routeInfo.destination) {
    destIata = routeInfo.destination.iata || "";
    destIcao = routeInfo.destination.icao || "";
    destName = routeInfo.destination.name ?? null;
  }
  const routeCode = animConfig.routeCode || "iata";
  let originCode: string;
  let destCode: string;
  if (routeCode === "icao") {
    originCode = originIcao || originIata;
    destCode = destIcao || destIata;
  } else {
    originCode = originIata || originIcao;
    destCode = destIata || destIcao;
  }
  const route = `${originCode || "___"} - ${destCode || "___"}`;

  // Aircraft.
  const aircraftModel = aircraftInfo.model || aircraftInfo.typeCode || "";
  const aircraftReg = aircraftInfo.registration || "";

  // Logo.
  const airlineInfo = ident.airline ?? {};
  const logo = await fetchLogo(airlineInfo.logoUrl);

  // Timing.
  const actual = timing.actual ?? {};
  const estimated = timing.estimated ?? {};
  const scheduled = timing.scheduled ?? {};
  const depTime = actual.departure || scheduled.departure || null;
  const arrTime = estimated.arrival || scheduled.arrival || null;
  const schedDep = scheduled.departure;
  const actualDep = actual.departure || estimated.departure;
  const delaySeconds =
    schedDep && actualDep && actualDep > schedDep ? Math.trunc(actualDep - schedDep) : 0;

  // Distance.
  let distText = "";
  if (observer.distance != null) {
    distText = `${Math.trunc(observer.distance)} ${units.distance || unit}`;
  }

  const flightData: FlightData = {
    carrier,
    route,
    aircraftModel,
    aircraftReg,
    logo,
    depTime,
    arrTime,
    distance: distText,
    cardinal: observer.cardinalDirection || "",
    speed: telemetry.groundSpeed,
    altitude: telemetry.altitude,
    speedUnit: units.speed || (metric ? "km/h" : "kn"),
    altUnit: units.altitude || (metric ? "m" : "ft"),
    verticalSpeed: telemetry.verticalSpeed ?? null,
    vspeedUnit: units.verticalSpeed || (metric ? "m/min" : "ft/min"),
    originName,
    destName,
    phaseLabel: detail.phase?.label ?? null,
    onGround: telemetry.onGround,
    delaySeconds,
  };

  const [content] = renderFlight(flightData, width, height, animConfig);
  return Root({ child: Padding({ pad: pad(1, 1, 1, 1), child: content }) });
}

export { getSchema, handlerTrackSpecificFlight, handlerFlightSearch } from "./schema";

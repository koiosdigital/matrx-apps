/**
 * Config schema, ported from the Starlark `#MARK: Schema` section.
 *
 * `handlerTrackSpecificFlight` is the generated-field handler (named export,
 * invoked by the host): when "Track Specific Flight" is on it swaps the
 * location picker for a searchable flight-number typeahead; otherwise it emits
 * the GeoJSON location picker.
 *
 * `handlerFlightSearch` backs that typeahead — the host calls it with whatever
 * the user has typed and it queries the flights API for live matches.
 */

import { schema, type Schema, type SchemaField, type SchemaOption } from "@koiosdigital/matrx-sdk";

import { searchFlights } from "./api";

/** Parse the stored typeahead selection the host echoes back (`{display,value}`). */
function parseStoredOption(input: string): { display: string; value: string } | null {
  const s = input.trim();
  if (!s.startsWith("{")) return null;
  try {
    const o = JSON.parse(s) as { display?: unknown; text?: unknown; value?: unknown };
    if (typeof o.value === "string") {
      const display = typeof o.display === "string" ? o.display
        : typeof o.text === "string" ? o.text
          : o.value;
      return { display, value: o.value };
    }
  } catch {
    // not JSON
  }
  return null;
}

export function handlerTrackSpecificFlight(
  trackSpecificFlight: string,
): SchemaField[] {
  if (trackSpecificFlight === "true") {
    return [
      schema.typeahead({
        id: "specific_flight",
        name: "Flight Number",
        desc: "Search a live flight by number (e.g. 'UA962' or 'UAL962') and pick it to track. Overrides the location-based search.",
        icon: "planeDeparture",
        handler: "handlerFlightSearch",
      }),
    ];
  }

  return [
    schema.geoJson({
      id: "location",
      name: "Location",
      desc: "Your location for finding nearby flights.",
      icon: "locationDot",
      collectPoint: true,
    }),
  ];
}

/** Typeahead handler: return live flights matching the typed query. */
export async function handlerFlightSearch(pattern: string): Promise<SchemaOption[]> {
  const results = await searchFlights(pattern);
  const options = results.map((r) => schema.option({ display: r.display, value: r.value }));

  // When the host echoes back a stored selection whose flight is no longer live
  // (search returns nothing for it), keep showing the choice so it isn't lost.
  const stored = parseStoredOption(pattern);
  if (stored && !options.some((o) => o.value === stored.value)) {
    options.unshift(schema.option({ display: stored.display, value: stored.value }));
  }
  return options;
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.toggle({
        id: "track_specific_flight",
        name: "Track Specific Flight",
        desc: "If enabled, you may enter a specific flight number (e.g. 'AA100') in the location field to track that flight instead of nearby flights.",
        icon: "question",
        default: false,
      }),
      schema.generated({
        id: "specific_flight",
        source: "track_specific_flight",
        handler: "handlerTrackSpecificFlight",
      }),
      schema.toggle({
        id: "metric",
        name: "Metric Units",
        desc: "Show distance in kilometers instead of miles.",
        icon: "ruler",
        default: false,
      }),
      schema.toggle({
        id: "expanded_callsign",
        name: "Expanded Callsign",
        desc: "Show friendly name (e.g. 'American 100') instead of raw callsign (e.g. 'AAL100').",
        icon: "tag",
        default: true,
      }),
      schema.color({
        id: "callsign_color",
        name: "Callsign Color",
        desc: "Color for the flight callsign text.",
        icon: "brush",
        default: "#0af",
        palette: ["#0af", "#0f0", "#ff0", "#f80", "#f00", "#f0f", "#fff"],
      }),
      schema.dropdown({
        id: "route_code",
        name: "Route Code",
        desc: "Airport code format for the route display.",
        icon: "route",
        default: "iata",
        options: [
          schema.option({ display: "IATA (LAX)", value: "iata" }),
          schema.option({ display: "ICAO (KLAX)", value: "icao" }),
        ],
      }),
      schema.dropdown({
        id: "anim_style",
        name: "Animation Style",
        desc: "How subscreens transition in the lower section.",
        icon: "film",
        default: "slide_up",
        options: [
          schema.option({ display: "Slide Up", value: "slide_up" }),
          schema.option({ display: "Slide Down", value: "slide_down" }),
          schema.option({ display: "Crossfade", value: "crossfade" }),
          schema.option({ display: "None (instant)", value: "none" }),
        ],
      }),
      schema.dropdown({
        id: "display_duration",
        name: "Display Duration",
        desc: "How long each subscreen is shown before transitioning.",
        icon: "clock",
        default: "3",
        options: [
          schema.option({ display: "2 seconds", value: "2" }),
          schema.option({ display: "3 seconds", value: "3" }),
          schema.option({ display: "5 seconds", value: "5" }),
          schema.option({ display: "10 seconds", value: "10" }),
        ],
      }),
      schema.toggle({
        id: "show_timing",
        name: "Show Timing",
        desc: "Show departure and arrival time info.",
        icon: "clock",
        default: true,
      }),
      schema.toggle({
        id: "show_telemetry",
        name: "Show Telemetry",
        desc: "Show speed, distance, altitude, and vertical speed.",
        icon: "gaugeHigh",
        default: true,
      }),
      schema.toggle({
        id: "show_airports",
        name: "Show Airport Names",
        desc: "Show full departure and arrival airport names.",
        icon: "planeDeparture",
        default: false,
      }),
      schema.toggle({
        id: "show_status",
        name: "Show Flight Status",
        desc: "Show current flight phase (e.g. Cruising, Climbing, Taxiing).",
        icon: "circleInfo",
        default: true,
      }),
      schema.toggle({
        id: "skip_arrived",
        name: "Skip Arrived Flights",
        desc: "Don't show flights that have already arrived at their destination.",
        icon: "planeArrival",
        default: false,
      }),
    ],
  });
}

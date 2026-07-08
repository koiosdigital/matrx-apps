/**
 * Config schema, ported from the Starlark `#MARK: Schema` section.
 *
 * `handlerTrackSpecificFlight` is the generated-field handler (named export,
 * invoked by the host): when "Track Specific Flight" is on it swaps the
 * location picker for a free-text flight-number field; otherwise it emits the
 * GeoJSON location picker.
 */

import { schema, type Schema, type SchemaField } from "@koiosdigital/matrx-sdk";

export function handlerTrackSpecificFlight(
  trackSpecificFlight: string,
): SchemaField[] {
  if (trackSpecificFlight === "true") {
    return [
      schema.text({
        id: "specific_flight",
        name: "Flight Number",
        desc: "Enter a specific flight number to track (e.g. 'AA100'). This will override the location-based search and show the specified flight if it's currently in the air.",
        icon: "planeDeparture",
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
    ],
  });
}

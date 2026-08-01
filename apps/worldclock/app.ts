/**
 * World Clock — hand port of `worldclock/world_clock.star` (by Elliot
 * Bentley), kept structurally line-for-line: same rows, dividers, blink
 * cadence and day/night name coloring.
 *
 * Differences from the Starlark original:
 *  - No `sunrise` module: replaced by ./sunrise.ts (suncalc algorithm,
 *    shared with bigclock).
 *  - The default New York / London entries had lat/lng 0 (sunrise for the
 *    Gulf of Guinea); they now carry real coordinates.
 *  - Screen sizes: column widths derive from the canvas, and 128-wide
 *    panels step up from tom-thumb to the tb-8 font.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Marquee,
  Padding,
  Root,
  Row,
  Text,
  schema,
  type Insets,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import { sunTimes } from "./sunrise";

interface ClockLocation {
  timezone: string;
  locality: string;
  lat: number | string;
  lng: number | string;
}

const DEFAULT_LOCATIONS: ClockLocation[] = [
  { timezone: "America/New_York", locality: "New York", lat: 40.7128, lng: -74.006 },
  { timezone: "Europe/London", locality: "London", lat: 51.5074, lng: -0.1278 },
  { timezone: "Asia/Tokyo", locality: "Tokyo", lat: 35.703286, lng: 139.748475 },
  { timezone: "America/Sao_Paulo", locality: "São Paulo", lat: -23.55, lng: -46.633333 },
];

function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

export default function render(config: Config): RootSpec {
  let locations: ClockLocation[];
  const location1 = config.get("location_1");
  if (location1) {
    locations = [];
    for (let i = 1; i <= 4; i++) {
      const raw = config.get(`location_${i}`);
      if (raw) {
        try {
          locations.push(JSON.parse(raw) as ClockLocation);
        } catch {
          // skip malformed entries
        }
      }
    }
  } else {
    locations = DEFAULT_LOCATIONS;
  }

  const locationCount = parseInt(config.get("location_count") || "3", 10);
  locations = locations.slice(0, locationCount);

  const width = config.width();
  const useMeridianTime = config.bool("time_format");
  const colorByDaylight = config.get("color_by_daylight") !== "false";
  const blink = config.get("blink", "true") === "true";

  // tb-8 on wide panels; tom-thumb otherwise (the original's only mode).
  const big = width >= 128;
  const font = big ? "tb-8" : "tom-thumb";
  const rowH = big ? 9 : 7;
  const timeW = big ? (useMeridianTime ? 42 : 28) : useMeridianTime ? 30 : 23;
  const nameW = width - timeW;

  const horizontalRule = Box({ height: 1, color: "#555" });

  const rows: WidgetSpec[] = [];
  locations.forEach((location, index) => {
    const i = index + 1;
    const timezone = location.timezone;
    const locality = config.get(`location_${i}_label`) || location.locality;

    const now = time.now().inLocation(timezone);

    const lat = parseFloat(String(location.lat));
    const lng = parseFloat(String(location.lng));
    const { rise, set } = sunTimes(lat, lng, now.ms);
    const isDaytime = rise !== null && set !== null && now.ms > rise && now.ms < set;

    let timeColor = "#bbbbbb";
    if (colorByDaylight) {
      timeColor = isDaytime ? "#ffe9ad" : "#94a0ff";
    }

    const locationName = Box({
      height: rowH,
      width: nameW,
      child: Padding({
        pad: pad(4, 1, 0, 0),
        child: Marquee({
          width: nameW - 4,
          child: Text({ content: locality, font, color: timeColor, offset: 0 }),
        }),
      }),
    });

    const locationTime = Box({
      width: timeW,
      height: rowH,
      child: Padding({
        pad: pad(0, 1, 0, 1),
        child: Row({
          children: [
            Text({
              content: useMeridianTime ? now.format("03") : now.format("15"),
              font,
              color: "#ffffff",
            }),
            Box({
              width: 2,
              child: Animation({
                children: [
                  Text({ content: ":", font: "CG-pixel-3x5-mono", color: "#777777", offset: 0 }),
                  blink && Text({ content: " ", font: "CG-pixel-3x5-mono" }),
                ],
              }),
            }),
            Text({
              content: useMeridianTime ? now.format("04PM") : now.format("04"),
              font,
              color: "#ffffff",
            }),
          ],
        }),
      }),
    });

    rows.push(Row({ mainAlign: "start", children: [locationName, locationTime] }));
    if (i < locations.length) {
      rows.push(horizontalRule);
    }
  });

  return Root({
    delay: 500,
    maxAge: 120,
    child: Column({
      children: rows,
      mainAlign: "space_around",
      expanded: true,
    }),
  });
}

export function getSchema(): Schema {
  const locationFields = [1, 2, 3, 4].flatMap((i) => [
    schema.location({
      id: `location_${i}`,
      name: `Location ${i}`,
      desc: "Location for which to display time.",
      icon: "locationDot",
    }),
    schema.text({
      id: `location_${i}_label`,
      name: `Location ${i} label`,
      desc: "Custom label (optional)",
      icon: "tag",
      default: "",
    }),
  ]);

  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "location_count",
        name: "Number of clocks",
        desc: "How many locations to display onscreen.",
        icon: "list",
        default: "3",
        options: [
          schema.option({ display: "2", value: "2" }),
          schema.option({ display: "3", value: "3" }),
          schema.option({ display: "4", value: "4" }),
        ],
      }),
      ...locationFields,
      schema.toggle({
        id: "time_format",
        name: "Time Format",
        desc: "Format time as 12H clock instead of 24H",
        icon: "clock",
        default: false,
      }),
      schema.toggle({
        id: "color_by_daylight",
        name: "Color by daylight",
        desc: "Adjust location name color based on time of day.",
        icon: "sun",
        default: true,
      }),
      schema.toggle({
        id: "blink",
        name: "Blinking separator",
        desc: "Blink the colon between hours and minutes.",
        icon: "clock",
        default: true,
      }),
    ],
  });
}

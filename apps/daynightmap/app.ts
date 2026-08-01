/**
 * Day Night Map — hand port of `daynightmap/day_night_map.star` (by Henry
 * So, Jr., MIT-licensed; map: "Equirectangular (0°)" by Tobias Jung,
 * CC BY-SA 4.0), kept structurally line-for-line: same declination table,
 * sunrise-equation terminator, custom digit overlay and shadowed date.
 *
 * Differences from the Starlark original:
 *  - The 1x1 half-transparent PNG used for night shading became
 *    Box(color: "#00000080") columns.
 *  - Screen sizes: the 2:1 map letterboxes vertically on 64x64 and scales
 *    2x on 128x64 (nearest neighbor); the terminator is computed per screen
 *    column, and the clock overlay doubles on wide panels.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Image,
  Padding,
  Root,
  Row,
  Stack,
  Text,
  schema,
  type Child,
  type Insets,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time, type Time } from "@koiosdigital/matrx-sdk/stdlib";

import MAP from "./map.png";
import CHAR_0 from "./char0.png";
import CHAR_1 from "./char1.png";
import CHAR_2 from "./char2.png";
import CHAR_3 from "./char3.png";
import CHAR_4 from "./char4.png";
import CHAR_5 from "./char5.png";
import CHAR_6 from "./char6.png";
import CHAR_7 from "./char7.png";
import CHAR_8 from "./char8.png";
import CHAR_9 from "./char9.png";
import COLON from "./colon.png";
import AM from "./am.png";
import PM from "./pm.png";

const NIGHT_COLOR = "#00000080";
const DATE_H = 7;
const CHAR_W = 9;
const SEP_W = 3;
const DEFAULT_TIMEZONE = "America/New_York";

const CHARS: Record<string, Uint8Array> = {
  "0": CHAR_0,
  "1": CHAR_1,
  "2": CHAR_2,
  "3": CHAR_3,
  "4": CHAR_4,
  "5": CHAR_5,
  "6": CHAR_6,
  "7": CHAR_7,
  "8": CHAR_8,
  "9": CHAR_9,
  ":": COLON,
};

/** [solid layout, blink layout, show AM/PM] */
const TIME_FORMATS: Record<string, [string, string, boolean] | null> = {
  omit: null,
  "12-hour": ["3:04", "3 04", true],
  "24-hour": ["15:04", "15 04", false],
};

const DEG = Math.PI / 180;
const COEF = 360 / 365.24;

// Pre-compute the tangent of the sun's declination per day of year.
// See https://en.wikipedia.org/wiki/Position_of_the_Sun
const TAN_DEC: number[] = [];
for (let d = 0; d < 366; d++) {
  const dec = Math.asin(
    Math.sin(-23.44 * DEG) *
      Math.cos((COEF * (d + 10) + (360 / Math.PI) * 0.0167 * Math.sin(COEF * (d - 2) * DEG)) * DEG),
  );
  TAN_DEC.push(Math.tan(dec));
}

function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

/**
 * For each screen column, the terminator y within the map band (0..mapH)
 * via the sunrise equation, plus whether night is above the curve.
 */
function sunrisePlot(tm: Time, width: number, mapH: number): { nightAbove: boolean; ys: number[] } {
  const utc = tm.inLocation("UTC");
  const anchor = time.time({ year: utc.year, month: 1, day: 1, location: "UTC" });
  const days = Math.floor(utc.sub(anchor).hours / 24);

  const tanDec = TAN_DEC[days];
  const tau = 15 * (utc.hour + utc.minute / 60) - 180;

  const halfH = mapH / 2;
  const hdiv = 360 / width;
  const ys: number[] = [];
  for (let x = 0; x < width; x++) {
    const lon = (x - width / 2) * hdiv + hdiv / 2;
    const lat = Math.atan(-Math.cos((lon + tau) * DEG) / tanDec) / DEG;
    ys.push(Math.round(halfH - (lat * halfH) / 90));
  }
  return { nightAbove: tanDec > 0, ys };
}

/** The big digit overlay ("3:04"-style) built from the 10x16 char images. */
function renderTime(tm: Time, format: string, s: number): WidgetSpec {
  const formatted = tm.format(format);
  const offset = 5 - formatted.length;
  const padOf = (i: number): number => {
    if (i > 2) return (i - 1) * CHAR_W + SEP_W;
    if (i > 0) return i * CHAR_W;
    return 0;
  };
  const offsetPad = padOf(offset);
  const children: Child[] = [];
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted[i];
    if (c === " ") continue;
    const img = CHARS[c];
    children.push(
      Padding({
        pad: pad((padOf(i + offset) - offsetPad) * s, 0, 0, 0),
        child: Image({ src: img, width: (c === ":" ? 4 : 10) * s, height: 16 * s }),
      }),
    );
  }
  return Stack({ children });
}

export default function render(config: Config): RootSpec {
  const width = config.width();
  const height = config.height();
  // Keep the 2:1 map aspect: letterbox on square panels, 2x on 128x64.
  const mapH = Math.min(height, Math.floor(width / 2));
  const mapY = Math.floor((height - mapH) / 2);
  const s = width >= 128 ? 2 : 1;

  const locationRaw = config.get("location");
  let location: { timezone?: string; lng?: string | number } = {};
  if (locationRaw) {
    try {
      location = JSON.parse(locationRaw);
    } catch {
      location = {};
    }
  }
  const timeFormat = TIME_FORMATS[config.get("time_format") ?? "omit"] ?? null;
  const blinkTime = config.bool("blink_time");
  const showDate = config.bool("show_date");

  const tz = location.timezone ?? config.get("$tz", DEFAULT_TIMEZONE)!;

  const forced = config.get("force_time");
  const tm = forced ? time.parseTime(forced).inLocation(tz) : time.now().inLocation(tz);

  let mapOffset = 0;
  if (config.bool("center_location")) {
    mapOffset = -Math.round((parseFloat(String(location.lng ?? "0")) * (width / 2)) / 180);
  }

  const formattedDate = tm.format("Mon 2 Jan 2006");
  const dateShadow = Row({
    mainAlign: "center",
    expanded: true,
    children: [Text({ content: formattedDate, font: "tom-thumb", color: "#000" })],
  });

  const { nightAbove, ys } = sunrisePlot(tm, width, mapH);

  const mapImage = (offsetX: number): WidgetSpec =>
    Padding({
      pad: pad(offsetX, mapY, 0, 0),
      child: Image({ src: MAP, width, height: mapH }),
    });

  return Root({
    delay: 1000,
    child: Stack({
      children: [
        mapImage(mapOffset),
        mapOffset !== 0 && mapImage(mapOffset + (mapOffset > 0 ? -width : width)),
        // Night shading: one column per pixel of screen width.
        Row({
          children: ys.map((_, i) => {
            const y = ys[(((i - mapOffset) % width) + width) % width];
            const columnH = nightAbove ? mapH - y : y;
            return Padding({
              pad: pad(0, mapY + (nightAbove ? y : 0), 0, 0),
              child: Box({ width: 1, height: Math.max(0, columnH), color: NIGHT_COLOR }),
            });
          }),
        }),
        timeFormat &&
          Column({
            mainAlign: "center",
            expanded: true,
            children: [
              Row({
                mainAlign: "center",
                expanded: true,
                children: [
                  Animation({
                    children: [
                      renderTime(tm, timeFormat[0], s),
                      blinkTime && renderTime(tm, timeFormat[1], s),
                    ],
                  }),
                  timeFormat[2] &&
                    Padding({
                      pad: pad(1 * s, 9 * s, 0, 0),
                      child: Image({ src: tm.hour < 12 ? AM : PM, width: 12 * s, height: 7 * s }),
                    }),
                ],
              }),
              showDate && Box({ width, height: 3 }),
            ],
          }),
        showDate &&
          Padding({
            pad: pad(0, height - DATE_H, 0, 0),
            child: Stack({
              children: [
                Padding({ pad: pad(-1, 1, 0, 0), child: dateShadow }),
                Padding({ pad: pad(2, 1, 0, 0), child: dateShadow }),
                Padding({ pad: pad(0, 0, 0, 0), child: dateShadow }),
                Padding({ pad: pad(0, 2, 0, 0), child: dateShadow }),
                Padding({
                  pad: pad(0, 1, 0, 0),
                  child: Row({
                    mainAlign: "center",
                    expanded: true,
                    children: [Text({ content: formattedDate, font: "tom-thumb", color: "#ff0" })],
                  }),
                }),
              ],
            }),
          }),
      ],
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Location for the display of date/time.",
        icon: "locationDot",
      }),
      schema.toggle({
        id: "center_location",
        name: "Center On Location",
        desc: "Whether to center the map on the location.",
        icon: "compress",
        default: false,
      }),
      schema.dropdown({
        id: "time_format",
        name: "Time Format",
        desc: "The format used for the time.",
        icon: "clock",
        default: "omit",
        options: Object.keys(TIME_FORMATS).map((format) =>
          schema.option({ display: format, value: format }),
        ),
      }),
      schema.toggle({
        id: "blink_time",
        name: "Blinking Time Separator",
        desc: "Whether to blink the colon between hours and minutes.",
        icon: "asterisk",
        default: false,
      }),
      schema.toggle({
        id: "show_date",
        name: "Date Overlay",
        desc: "Whether the date overlay should be shown.",
        icon: "calendarCheck",
        default: false,
      }),
    ],
  });
}

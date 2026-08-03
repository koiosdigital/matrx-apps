/**
 * Moon Phase — hand port of `moonphase/moon_phase.star` (by Chris Wyman,
 * MIT-licensed; moon image from NASA SVS, retouched by the author), kept
 * structurally line-for-line: same lunation constants, orthographic
 * projection shading and latitude-rotated crescents.
 *
 * Differences from the Starlark original:
 *  - The 16 1x1 mask PNGs (opaque→transparent black) became alpha-graded
 *    Boxes, run-length encoded per row.
 *  - Screen sizes: the 32x32 moon renders 2x on 64x64 (full-screen) and on
 *    128x64 (with the clock beside it); the optional clock overlays the
 *    bottom when there's no horizontal room.
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
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import MOON_IMG from "./moon.png";

const DEFAULT_LOCATION = `{
  "lat": 47.606,
  "lng": -122.332,
  "locality": "Seattle, WA, USA",
  "timezone": "America/Los_Angeles"
}`;

/** [solid layout, blink layout, is 12-hour] */
const TIME_FORMATS: Record<string, [string, string, boolean] | null> = {
  None: null,
  "12 hour": ["3:04", "3 04", true],
  "24 hour": ["15:04", "15 04", false],
};

const MOONIMG_SIZE = 32;
const X_C = MOONIMG_SIZE / 2.0 - 0.5;
const Y_C = MOONIMG_SIZE / 2.0 - 0.5;
// radius in pixel coordinates; -2 because of the 1px margin around the disc
const R = (MOONIMG_SIZE - 2) / 2.0;

/** Lunar cycle in seconds (29 days 12 hours 44 minutes 3 seconds). */
const LUNATION = 2551443;
/** Reference new moon: 30-Apr-2022 20:28:00 UTC. */
const REF_NEWMOON = Date.UTC(2022, 3, 30, 20, 28, 0) / 1000;

const SHADOW_LEVEL = 0.15;
const FADE_LNG = Math.PI / 6; // 30 degrees of moon longitude, non-linear fade
const FONT = "tom-thumb";

/**
 * Percent illumination of an image pixel given the moon phase and the
 * viewer's (earth) latitude — orthographic projection of lunar longitude,
 * crescents rotated to match the latitude (vertical at poles, horizontal at
 * the equator).
 */
function percentIlluminated(x: number, y: number, phase: number, latitude: number): number {
  // Offset so (0, 0) is the center of the moon.
  x -= X_C;
  y -= Y_C;

  const rot = Math.PI / 2 - (latitude * Math.PI) / 180;
  const xr = x * Math.cos(rot) - y * Math.sin(rot);
  const yr = x * Math.sin(rot) + y * Math.cos(rot);

  const lambda0 = phase; // lunar longitude offset; 0 = new, pi = full

  const rho = Math.sqrt(xr * xr + yr * yr);
  const c = Math.asin(Math.min(1, rho / R));
  const moonLng = lambda0 + Math.atan2(xr * Math.sin(c), rho * Math.cos(c));

  // New moon side stays fully in shadow (crisp new moon); the lit side
  // fades in over FADE_LNG with a 4th-root curve (crisp terminator, soft
  // approach to full brightness).
  if (moonLng < Math.PI / 2 || moonLng > (3 * Math.PI) / 2) {
    return SHADOW_LEVEL;
  } else if (moonLng - Math.PI / 2 > 0 && moonLng - Math.PI / 2 <= FADE_LNG) {
    return SHADOW_LEVEL + Math.sqrt(Math.sqrt(1 - SHADOW_LEVEL) * ((moonLng - Math.PI / 2) / FADE_LNG));
  } else if ((3 * Math.PI) / 2 - moonLng > 0 && (3 * Math.PI) / 2 - moonLng <= FADE_LNG) {
    return SHADOW_LEVEL + Math.sqrt(Math.sqrt(1 - SHADOW_LEVEL) * (((3 * Math.PI) / 2 - moonLng) / FADE_LNG));
  } else if (moonLng > Math.PI / 2 + FADE_LNG || moonLng < (3 * Math.PI) / 2 - FADE_LNG) {
    return 1.0;
  }
  return 0.0;
}

/** Illumination → mask index 0 (opaque black) .. 15 (clear). */
function selectMaskIndex(illuminationPercent: number): number {
  return Math.min(15, Math.floor(Math.round(illuminationPercent * 16)));
}

/** Mask index → shadow color (black with graded alpha). */
function maskColor(index: number): string {
  const alpha = Math.round((255 * (15 - index)) / 15);
  return "#000000" + alpha.toString(16).toUpperCase().padStart(2, "0");
}

/** The moon disc with its per-pixel shadow mask (RLE rows), at scale s. */
function moonWidget(phase: number, latitude: number, s: number): WidgetSpec {
  const rows: WidgetSpec[] = [];
  for (let y = 0; y < MOONIMG_SIZE; y++) {
    const row: WidgetSpec[] = [];
    let runIdx = selectMaskIndex(percentIlluminated(0, y, phase, latitude));
    let runLength = 1;
    for (let x = 1; x < MOONIMG_SIZE; x++) {
      const idx = selectMaskIndex(percentIlluminated(x, y, phase, latitude));
      if (idx !== runIdx) {
        row.push(Box({ width: runLength * s, height: s, color: maskColor(runIdx) }));
        runIdx = idx;
        runLength = 0;
      }
      runLength += 1;
    }
    row.push(Box({ width: runLength * s, height: s, color: maskColor(runIdx) }));
    rows.push(Row({ children: row }));
  }

  return Stack({
    children: [
      Image({ src: MOON_IMG, width: MOONIMG_SIZE * s, height: MOONIMG_SIZE * s }),
      Column({ children: rows }),
    ],
  });
}

/** Shadowed clock text (same 5-layer stack as the original). */
function clockStack(dispTime: string): WidgetSpec {
  const layer = (left: number, top: number, color: string): WidgetSpec =>
    Padding({
      pad: { left, top, right: 0, bottom: 0 },
      child: Text({ content: dispTime, font: FONT, color }),
    });
  return Stack({
    children: [
      layer(3, 0, "#000"),
      layer(1, 0, "#222"),
      layer(0, 1, "#222"),
      layer(1, 1, "#444"),
      layer(0, 0, "#AAA"),
    ],
  });
}

export default function render(config: Config): RootSpec {
  const location = JSON.parse(config.get("location", DEFAULT_LOCATION)!) as {
    lat?: number | string;
    timezone?: string;
  };
  const latitude = parseFloat(String(location.lat ?? 47.606));
  const tz = location.timezone ?? config.get("$tz", "America/Los_Angeles")!;

  const currtime = time.now();
  const currSecOfMoonCycle = (((currtime.unix - REF_NEWMOON) % LUNATION) + LUNATION) % LUNATION;
  const moonPhase = (currSecOfMoonCycle / LUNATION) * 2 * Math.PI;

  const timeFormat = TIME_FORMATS[config.get("time_format") ?? "None"] ?? null;
  const blinkTime = config.bool("blink_time");

  const width = config.width();
  const height = config.height();
  const s = Math.min(width, height) >= 64 ? 2 : 1;
  const moonSize = MOONIMG_SIZE * s;

  const moon = moonWidget(moonPhase, latitude, s);

  if (!timeFormat) {
    return Root({
      delay: 1000,
      child: Row({ expanded: true, mainAlign: "space_evenly", children: [moon] }),
    });
  }

  const dispTime = time.now().inLocation(tz).format(timeFormat[0]);
  const dispTimeBlink = time.now().inLocation(tz).format(timeFormat[1]);
  const clockFrames: Child[] = [clockStack(dispTime), blinkTime && clockStack(dispTimeBlink)];

  if (width - moonSize >= 28) {
    // Clock beside the moon (original 64x32 layout).
    const clockPadTop = moonSize - 8;
    return Root({
      delay: 1000,
      child: Row({
        expanded: true,
        mainAlign: "space_evenly",
        children: [
          moon,
          Animation({
            children: clockFrames.map(
              (frame) =>
                frame &&
                Padding({ pad: { left: 0, top: clockPadTop, right: 0, bottom: 0 }, child: frame }),
            ),
          }),
        ],
      }),
    });
  }

  // No horizontal room (64x64): overlay the clock at the bottom of the moon.
  return Root({
    delay: 1000,
    child: Stack({
      children: [
        Row({ expanded: true, mainAlign: "space_evenly", children: [moon] }),
        Column({
          expanded: true,
          mainAlign: "end",
          children: [
            Row({ expanded: true, mainAlign: "center", children: [Animation({ children: clockFrames })] }),
          ],
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
      schema.dropdown({
        id: "time_format",
        name: "Time Format",
        desc: "The format used for the time.",
        icon: "clock",
        default: "None",
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
    ],
  });
}

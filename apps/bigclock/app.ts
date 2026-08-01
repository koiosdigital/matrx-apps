/**
 * Big Clock — hand port of `bigclock/big_clock.star` (by Joey Hoer), kept
 * structurally line-for-line: same digit images, colors, flashing-separator
 * cadence and day/night color switching.
 *
 * Differences from the Starlark original, forced by the SDK surface:
 *  - No `sunrise` module: replaced by ./sunrise.ts (same Almanac algorithm).
 *  - Screen sizes: the digit images are 13x32 (designed for 64x32). On
 *    64x64 the outer Box centers the clock vertically; on 128x64 everything
 *    is scaled 2x (nearest-neighbor, so the retro pixels stay crisp).
 *
 * The digit PNGs have a black background and a transparent foreground, drawn
 * over a colored Box — that's how the color changes dynamically.
 */

import {
  Animation,
  Box,
  Config,
  Image,
  Root,
  Row,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time, type Time } from "@koiosdigital/matrx-sdk/stdlib";

import { sunrise, sunset } from "./sunrise";

import DIGIT_0 from "./digit0.png";
import DIGIT_1 from "./digit1.png";
import DIGIT_2 from "./digit2.png";
import DIGIT_3 from "./digit3.png";
import DIGIT_4 from "./digit4.png";
import DIGIT_5 from "./digit5.png";
import DIGIT_6 from "./digit6.png";
import DIGIT_7 from "./digit7.png";
import DIGIT_8 from "./digit8.png";
import DIGIT_9 from "./digit9.png";
import SEP from "./sep.png";

const NUMBER_IMGS = [
  DIGIT_0,
  DIGIT_1,
  DIGIT_2,
  DIGIT_3,
  DIGIT_4,
  DIGIT_5,
  DIGIT_6,
  DIGIT_7,
  DIGIT_8,
  DIGIT_9,
];

const DEFAULT_LOCATION = {
  lat: 37.54129,
  lng: -77.434769,
  locality: "Richmond, VA",
};
const DEFAULT_TIMEZONE = "US/Eastern";
const DEFAULT_IS_24_HOUR_FORMAT = true;
const DEFAULT_HAS_LEADING_ZERO = false;
const DEFAULT_HAS_FLASHING_SEPERATOR = true;
const DEFAULT_COLOR_DAYTIME = "#FFFFFF";
const DEFAULT_COLOR_NIGHTTIME = "#FFFFFF";

function getNumImage(num: number, color: string, s: number): WidgetSpec {
  return Box({
    width: 13 * s,
    height: 32 * s,
    color,
    child: Image({ src: NUMBER_IMGS[num], width: 13 * s, height: 32 * s }),
  });
}

function getTimeImage(
  t: Time,
  color: string,
  s: number,
  is24HourFormat: boolean,
  hasLeadingZero: boolean,
  hasSeperator: boolean,
): WidgetSpec {
  const hh = is24HourFormat ? t.format("15") : t.format("03");
  const mm = t.format("04");

  const seperator = hasSeperator
    ? Box({
        width: 4 * s,
        height: 14 * s,
        color,
        child: Image({ src: SEP, width: 4 * s, height: 14 * s }),
      })
    : Box({ width: 4 * s });

  const hh0 =
    parseInt(hh[0], 10) === 0 && !hasLeadingZero
      ? Box({ width: 13 * s })
      : getNumImage(parseInt(hh[0], 10), color, s);

  return Row({
    expanded: true,
    mainAlign: "space_between",
    crossAlign: "center",
    children: [
      hh0,
      getNumImage(parseInt(hh[1], 10), color, s),
      seperator,
      getNumImage(parseInt(mm[0], 10), color, s),
      getNumImage(parseInt(mm[1], 10), color, s),
    ],
  });
}

export default function render(config: Config): RootSpec {
  const location = config.get("location");
  let loc: { lat?: number | string; lng?: number | string; timezone?: string } = DEFAULT_LOCATION;
  if (location) {
    try {
      loc = JSON.parse(location);
    } catch {
      loc = DEFAULT_LOCATION;
    }
  }
  const timezone = loc.timezone ?? config.get("$tz", DEFAULT_TIMEZONE)!;
  const now = time.now();

  // Fetch sunrise/sunset times.
  const lat = parseFloat(String(loc.lat ?? DEFAULT_LOCATION.lat));
  const lng = parseFloat(String(loc.lng ?? DEFAULT_LOCATION.lng));
  const rise = sunrise(lat, lng, now.ms);
  const set = sunset(lat, lng, now.ms);

  const localNow = now.inLocation(timezone);

  const is24HourFormat = config.bool("is_24_hour_format", DEFAULT_IS_24_HOUR_FORMAT);
  const hasLeadingZero = config.bool("has_leading_zero", DEFAULT_HAS_LEADING_ZERO);
  const hasFlashingSeperator = config.bool("has_flashing_seperator", DEFAULT_HAS_FLASHING_SEPERATOR);

  const colorDaytime = config.get("color_daytime", DEFAULT_COLOR_DAYTIME)!;
  const colorNighttime = config.get("color_nighttime", DEFAULT_COLOR_NIGHTTIME)!;

  // 2x scale on wide panels; the 13x32 digits already fill a 64-wide panel.
  const s = config.width() >= 128 && config.height() >= 64 ? 2 : 1;

  // Set different color during day and night. No rise/set (Antarctica, north
  // pole, etc.) counts as daytime.
  let color = colorNighttime;
  if (rise === null || set === null) {
    color = colorDaytime;
  } else if (now.ms > rise && now.ms < set) {
    color = colorDaytime;
  }

  const frames: WidgetSpec[] = [
    getTimeImage(localNow, color, s, is24HourFormat, hasLeadingZero, true),
  ];
  if (hasFlashingSeperator) {
    frames.push(getTimeImage(localNow, color, s, is24HourFormat, hasLeadingZero, false));
  }

  return Root({
    delay: 500,
    maxAge: 120,
    child: Box({ child: Animation({ children: frames }) }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Location defining time to display and daytime/nighttime colors",
        icon: "locationDot",
      }),
      schema.toggle({
        id: "is_24_hour_format",
        name: "24 hour format",
        icon: "clock",
        desc: "Display the time in 24 hour format.",
        default: DEFAULT_IS_24_HOUR_FORMAT,
      }),
      schema.toggle({
        id: "has_leading_zero",
        name: "Add leading zero",
        icon: "creativeCommonsZero",
        desc: "Ensure the clock always displays with a leading zero.",
        default: DEFAULT_HAS_LEADING_ZERO,
      }),
      schema.toggle({
        id: "has_flashing_seperator",
        name: "Enable flashing separator",
        icon: "gear",
        desc: "Flash the separator between hours and minutes.",
        default: DEFAULT_HAS_FLASHING_SEPERATOR,
      }),
      schema.color({
        id: "color_daytime",
        icon: "sun",
        name: "Daytime color",
        desc: "The color to use during daytime.",
        default: DEFAULT_COLOR_DAYTIME,
        palette: ["#FFFFFF"],
      }),
      schema.color({
        id: "color_nighttime",
        icon: "moon",
        name: "Nighttime color",
        desc: "The color to use during nighttime.",
        default: DEFAULT_COLOR_NIGHTTIME,
        palette: ["#220000"],
      }),
    ],
  });
}

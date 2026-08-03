/**
 * Analog Clock — hand port of `analogclock/analog_clock.star` (by Chris
 * Jones, @IPv6Freely), kept structurally line-for-line: pre-rendered hand
 * images (5-minute resolution) over a white disc, with a month/day card.
 *
 * The hand PNGs have transparent strokes over an opaque black background,
 * so the white Circle underneath shows through (same trick as bigclock).
 *
 * Screen sizes:
 *  - 64x32: original side-by-side clock + calendar.
 *  - 64x64: clock above the calendar.
 *  - 128x64: everything at 2x with larger calendar fonts.
 */

import {
  Box,
  Circle,
  Column,
  Config,
  Image,
  Root,
  Row,
  Stack,
  Text,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import MIN_00 from "./min00.png";
import MIN_05 from "./min05.png";
import MIN_10 from "./min10.png";
import MIN_15 from "./min15.png";
import MIN_20 from "./min20.png";
import MIN_25 from "./min25.png";
import MIN_30 from "./min30.png";
import MIN_35 from "./min35.png";
import MIN_40 from "./min40.png";
import MIN_45 from "./min45.png";
import MIN_50 from "./min50.png";
import MIN_55 from "./min55.png";
import HOUR_01 from "./hour01.png";
import HOUR_02 from "./hour02.png";
import HOUR_03 from "./hour03.png";
import HOUR_04 from "./hour04.png";
import HOUR_05 from "./hour05.png";
import HOUR_06 from "./hour06.png";
import HOUR_07 from "./hour07.png";
import HOUR_08 from "./hour08.png";
import HOUR_09 from "./hour09.png";
import HOUR_10 from "./hour10.png";
import HOUR_11 from "./hour11.png";
import HOUR_12 from "./hour12.png";

const MINUTE_HANDS: Record<number, Uint8Array> = {
  0: MIN_00, 5: MIN_05, 10: MIN_10, 15: MIN_15, 20: MIN_20, 25: MIN_25,
  30: MIN_30, 35: MIN_35, 40: MIN_40, 45: MIN_45, 50: MIN_50, 55: MIN_55,
};

const HOUR_HANDS: Record<number, Uint8Array> = {
  1: HOUR_01, 2: HOUR_02, 3: HOUR_03, 4: HOUR_04, 5: HOUR_05, 6: HOUR_06,
  7: HOUR_07, 8: HOUR_08, 9: HOUR_09, 10: HOUR_10, 11: HOUR_11, 12: HOUR_12,
};

const DEFAULT_TIMEZONE = "US/Pacific";

function hand(src: Uint8Array, s: number): WidgetSpec {
  return Box({
    width: 30 * s,
    height: 30 * s,
    child: Image({ src, width: 32 * s, height: 32 * s }),
  });
}

function clockFace(hour: number, roundedMinute: number, s: number): WidgetSpec {
  return Box({
    width: 32 * s,
    height: 32 * s,
    color: "#000",
    child: Stack({
      children: [
        Circle({ diameter: 30 * s, color: "#fff" }),
        hand(MINUTE_HANDS[roundedMinute], s),
        hand(HOUR_HANDS[hour], s),
      ],
    }),
  });
}

function calendarCard(month: string, day: number, s: number): WidgetSpec {
  return Box({
    width: 32 * s,
    height: 30 * s,
    color: "#000",
    child: Column({
      children: [
        Box({
          width: 28 * s,
          height: 8 * s,
          color: "#990000",
          child: Text({ content: month, font: s === 2 ? "6x13" : "tb-8" }),
        }),
        Box({
          width: 28 * s,
          height: 18 * s,
          color: "#FFF",
          child: Text({ content: String(day), color: "#000", font: s === 2 ? "10x20" : "6x13" }),
        }),
      ],
    }),
  });
}

export default function render(config: Config): RootSpec {
  const locationRaw = config.get("location");
  let timezone = DEFAULT_TIMEZONE;
  if (locationRaw) {
    try {
      timezone = (JSON.parse(locationRaw) as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE;
    } catch {
      // keep default
    }
  }
  const now = time.now().inLocation(timezone);

  const hour = parseInt(now.format("3"), 10);
  const roundedMinute = Math.floor(((now.minute + 2) % 60) / 5) * 5;
  const day = now.day;
  const month = now.format("Jan").toUpperCase();

  const width = config.width();
  const height = config.height();
  const s = width >= 128 && height >= 64 ? 2 : 1;
  const stacked = s === 1 && height >= 64; // 64x64: clock above calendar

  const clock = clockFace(hour, roundedMinute, s);
  const calendar = calendarCard(month, day, s);

  const child = stacked
    ? Column({ mainAlign: "center", crossAlign: "center", expanded: true, children: [clock, calendar] })
    : Row({ mainAlign: "center", crossAlign: "center", expanded: true, children: [clock, calendar] });

  return Root({ maxAge: 120, child });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        icon: "locationDot",
        desc: "Location for which to display time",
      }),
    ],
  });
}

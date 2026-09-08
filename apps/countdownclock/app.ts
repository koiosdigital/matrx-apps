/**
 * Countdown Clock — redesign of the original `countdownclock` port (by
 * CubsAaron). Same config surface (event, event_time, eventColor — existing
 * installs keep working), flip-clock UI:
 *
 *  - DD / HH / MM digits sit in dark split-flap tiles with a seam line.
 *  - The event name gets a shimmer sweep in the configured color.
 *  - Urgency coloring (toggleable): digits go amber inside a week, red
 *    inside a day.
 *  - 64-tall panels add the event date; 128-wide adds a remaining-days dot
 *    strip (one dot per day, up to the row).
 *  - When the event arrives: confetti rain around a pulsing "IS HERE!".
 *
 * Layouts: 64x32 is a compact three-tile board; 64x64 stacks a big days
 * tile over hours/minutes tiles; 128x64 is the full board with labels.
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
  Stack,
  Text,
  schema,
  type Child,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time, Time } from "@koiosdigital/matrx-sdk/stdlib";

const LABEL_COLOR = "#777";
const DIM_COLOR = "#555";
const URGENT_COLOR = "#f43";
const SOON_COLOR = "#fc0";
const CALM_COLOR = "#fff";
const TILE_BG = "#1a1e28";
const TILE_SEAM = "#00000088";

/** Frames in the shimmer/confetti loop. */
const LOOP_FRAMES = 24;
const FRAME_MS = 100;

/** Preview target when no event is configured: 42d 7h 15m out. */
const PREVIEW_OFFSET_MS = ((42 * 24 + 7) * 60 + 15) * 60 * 1000;

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  totalMs: number;
}

function remainingUntil(future: Time, now: Time): Remaining {
  const totalMs = Math.max(0, future.ms - now.ms);
  const totalMinutes = Math.floor(totalMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes - days * 24 * 60 - hours * 60;
  return { days, hours, minutes, totalMs };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function digitColor(r: Remaining, byUrgency: boolean): string {
  if (!byUrgency) return CALM_COLOR;
  if (r.totalMs <= 24 * 3600 * 1000) return URGENT_COLOR;
  if (r.totalMs <= 7 * 24 * 3600 * 1000) return SOON_COLOR;
  return CALM_COLOR;
}

/** Parse #RGB/#RRGGBB to [r, g, b]. */
function parseHex(color: string): [number, number, number] {
  let hex = color.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const v = parseInt(hex.slice(0, 6), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Blend `color` toward white by t (0..1). */
function toWhite(color: string, t: number): string {
  const [r, g, b] = parseHex(color);
  const mix = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/**
 * Event name with a highlight sweeping across the characters. Falls back to
 * a marquee when the name can't fit (every animation frame carries the same
 * marquee, so it scrolls normally).
 */
function shimmerName(
  name: string,
  color: string,
  font: string,
  charW: number,
  width: number,
  frame: number,
): WidgetSpec {
  if (name.length * charW > width) {
    return Marquee({ width, align: "center", child: Text({ content: name, font, color }) });
  }
  // The bright spot sweeps once, then rests until the loop restarts.
  const sweep = Math.floor(frame * ((name.length + 6) / LOOP_FRAMES)) - 2;
  const chars: WidgetSpec[] = [];
  for (let i = 0; i < name.length; i++) {
    const d = Math.abs(i - sweep);
    const t = d === 0 ? 0.9 : d === 1 ? 0.45 : 0;
    chars.push(Text({ content: name[i], font, color: t > 0 ? toWhite(color, t) : color }));
  }
  return Row({ expanded: true, mainAlign: "center", children: chars });
}

/** A flip-clock tile: dark box, centered digits, seam line across. */
function tile(value: string, w: number, h: number, font: string, color: string): WidgetSpec {
  return Stack({
    children: [
      Box({ width: w, height: h, color: TILE_BG, child: Text({ content: value, font, color }) }),
      Padding({
        pad: { left: 0, top: Math.floor(h / 2), right: 0, bottom: 0 },
        child: Box({ width: w, height: 1, color: TILE_SEAM }),
      }),
    ],
  });
}

/** Tile with a dim label underneath. */
function labeledTile(
  value: string,
  label: string,
  w: number,
  h: number,
  font: string,
  color: string,
): WidgetSpec {
  return Column({
    crossAlign: "center",
    children: [
      tile(value, w, h, font, color),
      Padding({
        pad: { left: 0, top: 1, right: 0, bottom: 0 },
        child: Text({ content: label, font: "tom-thumb", color: LABEL_COLOR }),
      }),
    ],
  });
}

function gap(w: number): WidgetSpec {
  return Box({ width: w, height: 1 });
}

/** One dot per remaining day, capped to the row. */
function dayDots(days: number, color: string, width: number): WidgetSpec {
  const capacity = Math.floor((width - 8) / 3);
  const count = Math.max(1, Math.min(days, capacity));
  const dots: WidgetSpec[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) dots.push(gap(1));
    dots.push(Box({ width: 2, height: 2, color }));
  }
  return Row({ mainAlign: "center", crossAlign: "center", children: dots });
}

/** 64x32: name + compact DD/HH/MM tile board. */
function smallLayout(
  name: string,
  nameColor: string,
  r: Remaining,
  color: string,
  width: number,
  frame: number,
): WidgetSpec {
  const daysStr = String(r.days);
  const daysW = Math.max(19, daysStr.length * 6 + 7);
  return Column({
    expanded: true,
    mainAlign: "space_evenly",
    crossAlign: "center",
    children: [
      shimmerName(name, nameColor, "tb-8", 5, width, frame),
      Row({
        mainAlign: "center",
        crossAlign: "start",
        children: [
          labeledTile(daysStr, "DAYS", daysW, 15, "6x13", color),
          gap(2),
          labeledTile(pad2(r.hours), "HRS", 19, 15, "6x13", color),
          gap(2),
          labeledTile(pad2(r.minutes), "MIN", 19, 15, "6x13", color),
        ],
      }),
    ],
  });
}

/** 64x64: name, big days tile, HH/MM tiles, date. */
function mediumLayout(
  name: string,
  nameColor: string,
  r: Remaining,
  color: string,
  width: number,
  eventDate: string,
  frame: number,
): WidgetSpec {
  const daysStr = String(r.days);
  const bigW = Math.max(28, daysStr.length * 10 + 8);
  return Column({
    expanded: true,
    mainAlign: "space_evenly",
    crossAlign: "center",
    children: [
      shimmerName(name, nameColor, "tb-8", 5, width, frame),
      labeledTile(daysStr, "DAYS", bigW, 24, "10x20", color),
      Row({
        mainAlign: "center",
        crossAlign: "start",
        children: [
          labeledTile(pad2(r.hours), "HRS", 19, 13, "6x13", color),
          gap(3),
          labeledTile(pad2(r.minutes), "MIN", 19, 13, "6x13", color),
        ],
      }),
      Text({ content: eventDate, font: "tom-thumb", color: DIM_COLOR }),
    ],
  });
}

/** 128x64: full flip-clock board with the day-dot strip. */
function wideLayout(
  name: string,
  nameColor: string,
  r: Remaining,
  color: string,
  width: number,
  eventDate: string,
  frame: number,
): WidgetSpec {
  const daysStr = String(r.days);
  const daysW = Math.max(26, daysStr.length * 10 + 6);
  return Column({
    expanded: true,
    mainAlign: "space_evenly",
    crossAlign: "center",
    children: [
      shimmerName(name, nameColor, "6x13", 6, width, frame),
      Row({
        mainAlign: "center",
        crossAlign: "start",
        children: [
          labeledTile(daysStr, "DAYS", daysW, 26, "10x20", color),
          gap(5),
          labeledTile(pad2(r.hours), "HOURS", 26, 26, "10x20", color),
          gap(5),
          labeledTile(pad2(r.minutes), "MINS", 26, 26, "10x20", color),
        ],
      }),
      Row({
        expanded: true,
        mainAlign: "center",
        crossAlign: "center",
        children: [
          dayDots(r.days, nameColor, width - 44),
          gap(4),
          Text({ content: eventDate, font: "tom-thumb", color: DIM_COLOR }),
        ],
      }),
    ],
  });
}

interface Confetto {
  x: number;
  phase: number;
  speed: number;
  color: string;
}

/** Celebration: confetti rain around the pulsing "IS HERE!". */
function celebration(
  name: string,
  eventColor: string,
  eventDate: string,
  width: number,
  height: number,
): WidgetSpec[] {
  const palette = [eventColor, "#fff", "#fc0", "#0cf", "#f4f", "#4f6"];
  const confetti: Confetto[] = [];
  for (let i = 0; i < Math.floor(width / 3); i++) {
    confetti.push({
      x: Math.floor(Math.random() * width),
      phase: Math.floor(Math.random() * height),
      speed: 1 + Math.floor(Math.random() * 2),
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }

  const hereFont = height >= 64 ? "10x20" : "6x13";
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < LOOP_FRAMES; f++) {
    const pulse = 0.5 + 0.5 * Math.sin((f / LOOP_FRAMES) * 2 * Math.PI);
    frames.push(
      Stack({
        children: [
          ...confetti.map((c) =>
            Padding({
              pad: { left: c.x, top: (c.phase + f * c.speed) % height, right: 0, bottom: 0 },
              child: Box({ width: 1, height: 1, color: c.color }),
            }),
          ),
          Column({
            expanded: true,
            mainAlign: "space_evenly",
            crossAlign: "center",
            children: [
              Row({
                expanded: true,
                mainAlign: "center",
                children: [Text({ content: name, font: "tb-8", color: eventColor })],
              }),
              Text({ content: "IS HERE!", font: hereFont, color: toWhite(eventColor, pulse) }),
              height >= 64 && Text({ content: eventDate, font: "tom-thumb", color: DIM_COLOR }),
            ] as Child[],
          }),
        ],
      }),
    );
  }
  return frames;
}

export default function render(config: Config): RootSpec {
  const timezone = config.get("$tz", "America/Chicago")!;
  const now = time.now().inLocation(timezone);

  const configured = config.get("event_time");
  const future = configured
    ? time.parseTime(configured).inLocation(timezone)
    : new Time(now.ms + PREVIEW_OFFSET_MS, timezone);

  const name = config.str("event", "Event").toUpperCase();
  const eventColor = config.str("eventColor", "#008000");
  const byUrgency = config.bool("color_by_urgency", true);

  const width = config.width();
  const height = config.height();
  const eventDate = future.format("Jan 2").toUpperCase();

  if (!now.before(future)) {
    return Root({
      delay: FRAME_MS,
      maxAge: 300,
      child: Animation({ children: celebration(name, eventColor, eventDate, width, height) }),
    });
  }

  const r = remainingUntil(future, now);
  const color = digitColor(r, byUrgency);

  const frames: WidgetSpec[] = [];
  for (let f = 0; f < LOOP_FRAMES; f++) {
    if (width >= 128 && height >= 64) {
      frames.push(wideLayout(name, eventColor, r, color, width, eventDate, f));
    } else if (height >= 64) {
      frames.push(mediumLayout(name, eventColor, r, color, width, eventDate, f));
    } else {
      frames.push(smallLayout(name, eventColor, r, color, width, f));
    }
  }

  return Root({
    delay: FRAME_MS,
    maxAge: 60,
    child: Animation({ children: frames }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "event",
        name: "Event",
        desc: "The event text to display.",
        icon: "gear",
      }),
      schema.dateTime({
        id: "event_time",
        name: "Event Time",
        desc: "The time of the event.",
        icon: "gear",
      }),
      schema.color({
        id: "eventColor",
        name: "Event Color",
        desc: "The color of the event text.",
        icon: "brush",
        default: "#008000",
        palette: ["#008000", "#FF0000", "#FFA500", "#FFFF00", "#0000FF", "#EE82EE", "#FFFFFF"],
      }),
      schema.toggle({
        id: "color_by_urgency",
        name: "Color by Urgency",
        desc: "Countdown digits turn amber inside a week and red inside a day.",
        icon: "clock",
        default: true,
      }),
    ],
  });
}

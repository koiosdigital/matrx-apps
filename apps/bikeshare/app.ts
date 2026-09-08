/**
 * Bike Share — how many bikes are free, right now, at one station.
 *
 * The station name is context you already chose; the number is the thing
 * you glance at from across the room. So the count gets the panel and the
 * name gets a single line, scrolling only when it has to.
 *
 * Loop is 150 frames at 100ms. The count rolls up over the first 18, the
 * capacity bar fills over the first 24, and the name marquee — when there
 * is one — is sized so its own cycle divides 150 exactly, using the
 * frame-count formula documented in apps/flights/animation.ts.
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
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

import { SYSTEMS, demoStatus, fetchStatus, searchStations, systemById, type Status } from "./gbfs";

const FRAMES = 150;
const FRAME_DELAY_MS = 100;
const MAX_AGE = 120;

const ROLL_FRAMES = 18;
const BAR_FRAMES = 24;

/** Marquee wrap gap the renderer inserts in loop mode. */
const LOOP_GAP = 10;
/** tom-thumb is monospace at 4px advance. */
const CHAR_W = 4;

const GROUND = "#04060A";
const INK = "#E6ECF4";
const INK2 = "#8E9AAC";
const INK3 = "#4E5768";
const GOOD = "#3DE0A0";
const WARN = "#E0AE5C";
const BAD = "#FF6E7E";
const EBIKE = "#8FD3FF";

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();

  const system = systemById(config.str("system", "nyc"));
  // The picker stores "<station_id>|<name>" so render never has to fetch
  // the station directory just to recover a string the user already chose.
  const picked = config.str("station", "");
  const sep = picked.indexOf("|");
  const stationId = sep >= 0 ? picked.slice(0, sep) : picked;
  const stationName = sep >= 0 ? picked.slice(sep + 1) : "";

  let status: Status | null = null;
  if (stationId) {
    try {
      status = await fetchStatus(system.discovery, stationId);
    } catch {
      status = null;
    }
  }
  const demo = status === null;
  const st = status ?? demoStatus();
  const name = (stationName || (demo ? "EXAMPLE STATION" : "STATION")).toUpperCase();

  return Root({
    delay: FRAME_DELAY_MS,
    maxAge: MAX_AGE,
    child: Stack({
      children: [Box({ color: GROUND }), body(st, name, demo, width, height)],
    }),
  });
}

function body(
  st: Status,
  name: string,
  demo: boolean,
  width: number,
  height: number,
): WidgetSpec {
  const bikeColor = !st.renting || !st.installed ? BAD : st.bikes === 0 ? BAD : st.bikes < 4 ? WARN : GOOD;
  const bigFont = height >= 64 ? "10x20" : "6x13";

  const block = Column({
    children: [
      nameLine(name, width, demo),
      Box({ width, height: 1, color: "#161C26" }),
      Box({ height: 1 }),
      Padding({
        pad: { left: 2, top: 0, right: 2, bottom: 0 },
        child: Row({
          expanded: true,
          crossAlign: "center",
          mainAlign: "space_between",
          children: [
            roll(st.bikes, bigFont, bikeColor),
            Column({
              crossAlign: "end",
              children: [
                Text({ content: plural(st.bikes, "BIKE"), font: "tom-thumb", color: INK2 }),
                Box({ height: 1 }),
                st.ebikes > 0
                  ? Text({
                      content: `${st.ebikes} ${plural(st.ebikes, "E-BIKE")}`,
                      font: "tom-thumb",
                      color: EBIKE,
                    })
                  : Text({ content: "", font: "tom-thumb", color: INK3 }),
              ],
            }),
          ],
        }),
      }),
      Box({ height: 1 }),
      Padding({
        pad: { left: 2, top: 0, right: 2, bottom: 0 },
        child: Row({
          expanded: true,
          mainAlign: "space_between",
          children: [
            Text({ content: `${st.docks} ${plural(st.docks, "DOCK")}`, font: "tom-thumb", color: INK2 }),
            Text({
              content: !st.renting ? "CLOSED" : demo ? "EXAMPLE" : "",
              font: "tom-thumb",
              color: demo ? WARN : BAD,
            }),
          ],
        }),
      }),
      Box({ height: 1 }),
      capacityBar(st, width, bikeColor),
    ],
  });
  // A tall panel would otherwise leave everything hugging the top edge.
  return height < 64 ? block : Column({ expanded: true, mainAlign: "center", children: [block] });
}

/**
 * The station name. Scrolls only when it overflows, and when it does the
 * marquee's frame count is forced to divide the loop: the renderer's
 * loop-mode count is `delay + childWidth + LOOP_GAP + 1 + endDelay`, so
 * solving for `delay` against a target that divides FRAMES keeps frame
 * N-1 landing exactly where frame 0 begins.
 */
function nameLine(name: string, width: number, demo: boolean): WidgetSpec {
  const inner = width - 4;
  const textWidth = name.length * CHAR_W;
  const label = Text({ content: name, font: "tom-thumb", color: demo ? INK2 : INK });

  if (textWidth <= inner) {
    return Padding({ pad: { left: 2, top: 1, right: 2, bottom: 0 }, child: label });
  }

  const base = textWidth + LOOP_GAP + 1;
  // Smallest divisor of FRAMES that still fits a whole scroll.
  let target = FRAMES;
  for (const candidate of [30, 50, 75, 150]) {
    if (candidate >= base) {
      target = candidate;
      break;
    }
  }
  const delay = Math.max(0, target - base);
  return Padding({
    pad: { left: 2, top: 1, right: 2, bottom: 0 },
    child: Marquee({ child: label, width: inner, loop: true, delay, scrollDirection: "horizontal" }),
  });
}

/** "1 DOCK" but "2 DOCKS" — the panel is small enough that a wrong plural
 *  is a third of the line and reads as a bug. */
function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}S`;
}

/** Count rolling up from zero — cheap, since each frame is one Text spec. */
function roll(value: number, font: string, color: string): WidgetSpec {
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = Math.min(1, (f + 1) / ROLL_FRAMES);
    const eased = 1 - Math.pow(1 - t, 3);
    frames.push(Text({ content: String(Math.round(value * eased)), font, color }));
  }
  return Animation({ children: frames });
}

/**
 * Rack occupancy: bikes, then out-of-service, then empty docks. Reads as
 * "how full is it" without needing the numbers.
 */
function capacityBar(st: Status, width: number, bikeColor: string): WidgetSpec {
  const inner = width - 4;
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = Math.min(1, (f + 1) / BAR_FRAMES);
    const eased = 1 - Math.pow(1 - t, 3);
    const bikeW = Math.round((st.bikes / st.capacity) * inner * eased);
    const deadW = Math.round((st.disabled / st.capacity) * inner * eased);
    const restW = Math.max(0, inner - bikeW - deadW);
    frames.push(
      Row({
        // Falsy children are skipped; a zero-width Box would expand to
        // the remaining bounds and swallow the whole bar.
        children: [
          bikeW > 0 && Box({ width: bikeW, height: 2, color: bikeColor }),
          deadW > 0 && Box({ width: deadW, height: 2, color: "#3A3F4A" }),
          restW > 0 && Box({ width: restW, height: 2, color: "#12161E" }),
        ],
      }),
    );
  }
  return Padding({
    pad: { left: 2, top: 0, right: 2, bottom: 0 },
    child: Animation({ children: frames }),
  });
}

/**
 * typeahead handler. The value carries the name alongside the id so the
 * render path can skip the station directory entirely — see fetchStatus.
 */
export async function stationSearch(query: string, config: Config): Promise<SchemaOption[]> {
  const system = systemById(config.str("system", "nyc"));
  const stations = await searchStations(system.discovery, query);
  return stations.map((s) =>
    schema.option({ display: s.name, value: `${s.id}|${s.name.slice(0, 40)}` }),
  );
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "system",
        name: "System",
        desc: "Which bike share network your station belongs to.",
        icon: "city",
        default: "nyc",
        options: SYSTEMS.map((s) => schema.option({ display: s.label, value: s.id })),
      }),
      schema.typeahead({
        id: "station",
        name: "Station",
        desc: "Search for your station by name.",
        icon: "bicycle",
        handler: "stationSearch",
      }),
    ],
  });
}

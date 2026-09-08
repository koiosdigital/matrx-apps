/**
 * News — one headline at a time.
 *
 * A 64x32 panel can show a headline or a list of truncated fragments, not
 * both. So each headline gets the whole panel for three seconds, wrapped
 * across three lines, and the loop brings the next one round — the same
 * argument the stocks card makes for one symbol at a time.
 *
 * Loop is `headlines x 30` frames at 100ms, capped at five headlines so
 * the cycle stays inside a device's dwell.
 */

import {
  Box,
  Column,
  Config,
  Padding,
  Root,
  Row,
  Sequence,
  Stack,
  Text,
  Transformation,
  WrappedText,
  animation,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http, time } from "@koiosdigital/matrx-sdk/stdlib";

import { SOURCES, sourceById } from "./feeds";
import { parseFeed, type Item } from "./parse";

const FRAME_DELAY_MS = 100;
const MAX_AGE = 600;
const TTL_SECONDS = 600;

const SLOT_FRAMES = 30;
const SLIDE_FRAMES = 6;
const MAX_ITEMS = 5;

const ACCENT = "#F5A15B";
const INK = "#E8EDF4";
const INK2 = "#96A2B4";
const INK3 = "#5C6678";
const GROUND = "#05070A";

const EXAMPLE: Item[] = [
  { title: "Feed unavailable - check the source in settings", published: 0 },
];

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();

  const custom = config.str("custom_url", "").trim();
  const source = sourceById(config.str("source", "npr"));
  const url = custom || source.url;
  const label = (custom ? "FEED" : source.label).toUpperCase();

  let items: Item[] = [];
  try {
    const res = await http.get(url, {
      headers: { "User-Agent": "matrx-news (koiosdigital.net)" },
      ttlSeconds: TTL_SECONDS,
    });
    if (res.status === 200) items = parseFeed(res.body(), MAX_ITEMS);
  } catch {
    items = [];
  }
  if (items.length === 0) items = EXAMPLE;

  const nowSec = time.now().unix;
  const slots = items.map((item) => headline(item, label, nowSec, width, height));

  return Root({
    delay: FRAME_DELAY_MS,
    maxAge: MAX_AGE,
    child: Stack({
      children: [Box({ color: GROUND }), cycle(slots, width, height)],
    }),
  });
}

/**
 * Slots joined end to end, each sliding up into the next. The last slides
 * into the first, so the wrap is the same motion as every other boundary
 * and the loop seam disappears.
 */
function cycle(slots: WidgetSpec[], width: number, height: number): WidgetSpec {
  if (slots.length === 1) return hold(slots[0], SLOT_FRAMES);

  const children: WidgetSpec[] = [];
  for (let i = 0; i < slots.length; i++) {
    children.push(hold(slots[i], SLOT_FRAMES - SLIDE_FRAMES));
    children.push(slide(slots[i], slots[(i + 1) % slots.length], width, height));
  }
  return Sequence({ children, duration: slots.length * SLOT_FRAMES });
}

function hold(child: WidgetSpec, frames: number): WidgetSpec {
  return Transformation({
    child,
    duration: Math.max(1, frames),
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, 0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
  });
}

function slide(from: WidgetSpec, to: WidgetSpec, width: number, height: number): WidgetSpec {
  void width;
  const leg = (child: WidgetSpec, fromY: number, toY: number): WidgetSpec =>
    Transformation({
      child,
      duration: SLIDE_FRAMES,
      keyframes: [
        animation.Keyframe({
          percentage: 0,
          transforms: [animation.Translate(0, fromY)],
          curve: "ease_in_out",
        }),
        animation.Keyframe({
          percentage: 1,
          transforms: [animation.Translate(0, toY)],
          curve: "ease_in_out",
        }),
      ],
      fillMode: "forwards",
    });
  return Stack({ children: [leg(from, 0, -height), leg(to, height, 0)] });
}


/**
 * Truncate so the renderer's own word wrap lands within `maxLines`.
 *
 * A character budget of `lines x perLine` overcounts badly: wrapping breaks
 * on words, so a line ending in a long word wastes its tail. This runs the
 * same greedy wrap the renderer does and cuts at the real boundary. Exact
 * rather than approximate because both faces used here are monospace, so a
 * character count IS the pixel width.
 */
export function fitLines(text: string, perLine: number, maxLines: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    // A word longer than the line gets hard-broken rather than dropped.
    if (word.length > perLine) {
      if (line) {
        out.push(line);
        line = "";
      }
      let rest = word;
      while (rest.length > perLine && out.length < maxLines) {
        out.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      line = rest;
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length >= maxLines) break;
  }
  if (line && out.length < maxLines) out.push(line);

  if (out.length <= maxLines && out.join(" ").length >= text.replace(/\s+/g, " ").trim().length) {
    return out.join(" ");
  }
  const kept = out.slice(0, maxLines);
  if (kept.length === 0) return "";
  const last = kept[kept.length - 1];
  kept[kept.length - 1] =
    last.length >= perLine ? `${last.slice(0, Math.max(0, perLine - 1))}…` : `${last}…`;
  return kept.join(" ");
}

/** "3M" / "2H" / "4D" since filing. */
function age(published: number, nowSec: number): string {
  if (!published) return "";
  const d = Math.max(0, nowSec - published);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}M`;
  if (d < 86400) return `${Math.round(d / 3600)}H`;
  return `${Math.round(d / 86400)}D`;
}

function headline(
  item: Item,
  label: string,
  nowSec: number,
  width: number,
  height: number,
): WidgetSpec {
  const wide = width >= 128;
  const font = wide ? "5x8" : "tom-thumb";
  const lineH = wide ? 8 : 6;
  const charW = wide ? 5 : 4;
  // Top bar (1 pad + 6 text), the rule, and the body's own top pad.
  const chrome = 9;
  // Whole lines only — a clipped half-line reads as a rendering fault.
  const lines = Math.max(1, Math.floor((height - chrome) / (lineH + 1)));
  const perLine = Math.max(4, Math.floor((width - 4) / charW));
  const title = fitLines(item.title, perLine, lines);

  const stamp = age(item.published, nowSec);

  return Column({
    children: [
      Padding({
        pad: { left: 2, top: 1, right: 2, bottom: 0 },
        child: Row({
          expanded: true,
          mainAlign: "space_between",
          children: [
            Text({ content: label, font: "tom-thumb", color: ACCENT }),
            stamp
              ? Text({ content: stamp, font: "tom-thumb", color: INK3 })
              : Box({ width: 1, height: 1 }),
          ],
        }),
      }),
      Box({ width, height: 1, color: "#1A2028" }),
      Padding({
        pad: { left: 2, top: 1, right: 2, bottom: 0 },
        child: WrappedText({
          content: title,
          font,
          width: width - 4,
          color: INK,
          lineSpacing: 1,
        }),
      }),
    ],
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "source",
        name: "Source",
        desc: "Which feed to read.",
        icon: "newspaper",
        default: "npr",
        options: SOURCES.map((s) => schema.option({ display: s.label, value: s.id })),
      }),
      schema.text({
        id: "custom_url",
        name: "Custom feed URL",
        desc:
          "Optional RSS or Atom URL, used instead of the source above. Only hosts already used by this app are reachable - a feed elsewhere is refused before the request leaves the device.",
        icon: "link",
      }),
    ],
  });
}

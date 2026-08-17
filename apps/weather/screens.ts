/**
 * The three subscreens that ride over the sky.
 *
 * Every builder takes an opacity multiplier so the cycle can dissolve one
 * into the next by ramping text alpha, rather than by fading a solid box
 * over everything — the sky underneath has to keep moving through the
 * transition, which is the whole point of the direction.
 */

import {
  Box,
  Column,
  Padding,
  Plot,
  Row,
  Text,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

import type { Conditions } from "./types";
import { alpha } from "./scene";
import { SCENE_LABEL, formatAge, tempString, windString } from "./format";

export interface Ctx {
  cond: Conditions;
  unit: "f" | "c";
  width: number;
  height: number;
  /** Preformatted in the location's own timezone by app.ts. */
  riseLabel: string;
  setLabel: string;
  locality: string;
  accent: string;
}

const INK = "#FFFFFF";
const INK2 = "#C6D2E4";
const INK3 = "#8A99B4";
const COOL = "#9BC4F0";

/** Row of small type pinned to the top, inside the top scrim. */
function topBar(left: string, right: string, leftColor: string, rightColor: string, a: number): WidgetSpec {
  return Padding({
    pad: { left: 2, top: 1, right: 2, bottom: 0 },
    child: Row({
      expanded: true,
      mainAlign: "space_between",
      children: [
        Text({ content: left, font: "tom-thumb", color: alpha(leftColor, a) }),
        right
          ? Text({ content: right, font: "tom-thumb", color: alpha(rightColor, a) })
          : Box({ width: 1, height: 1 }),
      ],
    }),
  });
}

/** Content block pinned to the bottom of the panel. */
function bottom(height: number, rows: number, child: WidgetSpec): WidgetSpec {
  return Column({
    children: [Box({ height: Math.max(0, height - rows) }), child],
  });
}

export function nowScreen(ctx: Ctx, a: number): WidgetSpec {
  const c = ctx.cond;
  const stale = c.ageSeconds > 1800;
  const label = c.demo ? "EXAMPLE" : stale ? `${formatAge(c.ageSeconds)} OLD` : "";
  const title = ctx.locality || SCENE_LABEL[c.scene] || "NOW";

  const temp = Text({
    content: `${tempString(c.tempC, ctx.unit)}°`,
    font: "6x13",
    color: alpha(INK, a),
  });
  const hilo = Column({
    crossAlign: "end",
    children: [
      Row({
        children: [
          Text({ content: "H", font: "tom-thumb", color: alpha(INK3, a) }),
          Text({ content: tempString(c.highC, ctx.unit), font: "tom-thumb", color: alpha(INK2, a) }),
        ],
      }),
      Box({ height: 1 }),
      Row({
        children: [
          Text({ content: "L", font: "tom-thumb", color: alpha(INK3, a) }),
          Text({ content: tempString(c.lowC, ctx.unit), font: "tom-thumb", color: alpha(COOL, a) }),
        ],
      }),
    ],
  });

  return Column({
    children: [
      topBar(title, label, INK2, c.demo ? ctx.accent : ctx.accent, a),
      bottom(
        ctx.height - 7,
        13,
        Padding({
          pad: { left: 2, top: 0, right: 2, bottom: 1 },
          child: Row({
            expanded: true,
            mainAlign: "space_between",
            crossAlign: "center",
            children: [temp, hilo],
          }),
        }),
      ),
    ],
  });
}

export function todayScreen(ctx: Ctx, a: number): WidgetSpec {
  const c = ctx.cond;
  const precip = `RAIN ${Math.round(c.precipChance * 100)}%`;
  const rise = ctx.riseLabel;
  const set = ctx.setLabel;

  const line = (l: string, v: string, vColor: string): WidgetSpec =>
    Row({
      expanded: true,
      mainAlign: "space_between",
      children: [
        Text({ content: l, font: "tom-thumb", color: alpha(INK3, a) }),
        Text({ content: v, font: "tom-thumb", color: alpha(vColor, a) }),
      ],
    });

  return Column({
    children: [
      topBar("TODAY", precip, ctx.accent, COOL, a),
      bottom(
        ctx.height - 7,
        13,
        Padding({
          pad: { left: 2, top: 0, right: 2, bottom: 1 },
          child: Column({
            children: [
              line("RISE", rise, INK2),
              Box({ height: 1 }),
              line("SET", set, INK2),
            ],
          }),
        }),
      ),
    ],
  });
}

/**
 * The next twelve hours as a trend. `prog` reveals it left to right; the
 * y-limits stay fixed across the reveal so the line grows rather than
 * rescaling under itself.
 */
export function next12Screen(ctx: Ctx, a: number, prog: number): WidgetSpec {
  const c = ctx.cond;
  const hours = c.hourlyC.length > 1 ? c.hourlyC : [c.tempC, c.tempC];
  let lo = hours[0];
  let hi = hours[0];
  for (const h of hours) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (hi - lo < 0.5) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.15;
  const upto = Math.max(2, Math.round(prog * hours.length));
  const data: [number, number][] = [];
  for (let i = 0; i < upto; i++) data.push([i, hours[i]]);

  const chartH = 13;
  return Column({
    children: [
      topBar("NEXT 12H", "APPLE", ctx.accent, INK3, a),
      bottom(
        ctx.height - 7,
        chartH,
        Padding({
          pad: { left: 1, top: 0, right: 1, bottom: 0 },
          child: Plot({
            data,
            width: ctx.width - 2,
            height: chartH,
            xLim: [0, hours.length - 1],
            yLim: [lo - pad, hi + pad],
            color: alpha(ctx.accent, a),
            fill: true,
            fillColor: alpha(ctx.accent, a * 0.22),
            chartType: "line",
          }),
        }),
      ),
    ],
  });
}

/** Alert banner — replaces the NOW slot when a warning is active. */
export function alertScreen(ctx: Ctx, a: number): WidgetSpec {
  const headline = ctx.cond.alert.toUpperCase().slice(0, 22);
  return Column({
    children: [
      topBar("ALERT", "", "#FF6E7E", "#FF6E7E", a),
      bottom(
        ctx.height - 7,
        13,
        Padding({
          pad: { left: 2, top: 0, right: 2, bottom: 1 },
          child: Text({ content: headline, font: "tom-thumb", color: alpha(INK, a) }),
        }),
      ),
    ],
  });
}

/** Wind and feels-like, for panels tall enough to carry a fourth line. */
export function detailLine(ctx: Ctx, a: number): WidgetSpec {
  const c = ctx.cond;
  return Row({
    expanded: true,
    mainAlign: "space_between",
    children: [
      Text({
        content: `FEELS ${tempString(c.feelsC, ctx.unit)}°`,
        font: "tom-thumb",
        color: alpha(INK3, a),
      }),
      Text({ content: windString(c.windKph, ctx.unit), font: "tom-thumb", color: alpha(INK3, a) }),
    ],
  });
}

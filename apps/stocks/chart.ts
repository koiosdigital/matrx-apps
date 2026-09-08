/**
 * Sparkline built on the renderer's `Plot`.
 *
 * The series is plotted as *delta from a baseline* rather than as raw
 * price. Two things fall out of that:
 *
 *  - Plot draws `color` above y=0 and `colorInverted` below it, so the
 *    green-above / red-below split is free and exact, with no manual
 *    segmentation.
 *  - Zero is where the charted window opened (`Quote.chartBase`), so the
 *    line is read as "up or down since then" and every symbol's chart
 *    becomes directly comparable.
 *
 * The cost is that y-limits always include zero, so a symbol that ran up
 * all day uses less of the chart height than it could. That is the right
 * trade: the baseline is the information.
 */

import { Plot, type WidgetSpec } from "@koiosdigital/matrx-sdk";

import type { Palette } from "./palette";

export interface ChartGeom {
  yMin: number;
  yMax: number;
  /** Deltas from the baseline, oldest first. */
  deltas: number[];
}

export function chartGeom(series: number[], base: number): ChartGeom {
  const deltas = series.map((v) => v - base);
  let lo = 0;
  let hi = 0;
  for (const d of deltas) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  if (hi - lo < 1e-9) {
    lo = -1;
    hi = 1;
  }
  const pad = (hi - lo) * 0.1;
  return { yMin: lo - pad, yMax: hi + pad, deltas };
}

/**
 * The chart at a given point in the draw-on. `upto` is how many points are
 * revealed; x- and y-limits are fixed across every frame so the line grows
 * left to right instead of rescaling under itself.
 */
export function plotFrame(
  geom: ChartGeom,
  upto: number,
  width: number,
  height: number,
  pal: Palette,
): WidgetSpec {
  const n = geom.deltas.length;
  const count = Math.max(2, Math.min(n, upto));
  const data: [number, number][] = [];
  for (let i = 0; i < count; i++) data.push([i, geom.deltas[i]]);
  return Plot({
    data,
    width,
    height,
    xLim: [0, Math.max(1, n - 1)],
    yLim: [geom.yMin, geom.yMax],
    color: pal.gain,
    colorInverted: pal.loss,
    fill: true,
    fillColor: pal.gainFill,
    fillColorInverted: pal.lossFill,
    chartType: "line",
  });
}

/** Row of the chart a value lands on — mirrors Plot's own y mapping. */
export function rowOf(value: number, geom: ChartGeom, height: number): number {
  const span = geom.yMax - geom.yMin || 1;
  const t = (value - geom.yMin) / span;
  const row = Math.round((1 - t) * (height - 1));
  return Math.max(0, Math.min(height - 1, row));
}

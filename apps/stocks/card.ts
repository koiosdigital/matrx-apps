/**
 * Direction A — one symbol owning the panel for a 50-frame slot.
 *
 * Frame budget per slot, which must stay exact or the loop seam shows:
 *
 *     16  draw-on   chart grows left→right, price rolls up from prev close
 *     22  settle    static card + a pulsing endpoint marker
 *     12  slide     this card leaves upward, the next arrives
 *     --
 *     50
 *
 * The draw-on is the only phase that costs a subtree per frame, and it is
 * worth it: `Plot` carries just its data array. The settle is one subtree
 * held by a `Transformation`, plus a cheap marker layer, rather than 22
 * copies of the card.
 */

import {
  Animation,
  Box,
  Column,
  Padding,
  Row,
  Sequence,
  Stack,
  Text,
  Transformation,
  animation,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

import type { Quote } from "./types";
import type { Palette } from "./palette";
import { chartGeom, plotFrame, rowOf, type ChartGeom } from "./chart";
import { alpha, easeOutCubic, formatAge, formatChangePct, formatPrice } from "./format";

export const DRAW_FRAMES = 16;
export const SETTLE_FRAMES = 22;
export const SLIDE_FRAMES = 12;
export const SLOT_FRAMES = DRAW_FRAMES + SETTLE_FRAMES + SLIDE_FRAMES;

/** 1px of breathing room above the 8px tb-8 header line. */
const HEADER_H = 1 + 8;
/** 6x10 ascent+descent. */
const PRICE_H = 10;

/** Age past which the card stops claiming to be current. */
const STALE_AFTER = 600;

interface CardOpts {
  width: number;
  height: number;
  pal: Palette;
  /** Muted treatment: market closed or data stale. */
  muted: boolean;
  /** Example data — labelled in the header rather than over the chart. */
  demo: boolean;
}

function chartHeight(o: CardOpts): number {
  return Math.max(6, o.height - HEADER_H - PRICE_H);
}

/** Symbol on the left, one of change / CLOSED / STALE on the right. */
function header(q: Quote, o: CardOpts): WidgetSpec {
  const stale = q.ageSeconds > STALE_AFTER;
  let right: string;
  let rightColor: string;
  if (o.demo) {
    // The chart is full-bleed, so there is nowhere to put a badge that
    // isn't on top of it. The header slot is free — and in example mode
    // a fabricated change percentage is the least useful thing there.
    right = "EXAMPLE";
    rightColor = o.pal.accent;
  } else if (stale) {
    right = `STALE ${formatAge(q.ageSeconds)}`;
    rightColor = o.pal.accent;
  } else if (!q.marketOpen) {
    right = "CLOSED";
    rightColor = o.pal.ink2;
  } else {
    right = formatChangePct(q.changePct);
    rightColor = q.changePct >= 0 ? o.pal.gain : o.pal.loss;
  }
  return Padding({
    pad: { left: 2, top: 1, right: 2, bottom: 0 },
    child: Row({
      expanded: true,
      mainAlign: "space_between",
      crossAlign: "center",
      children: [
        Text({ content: q.symbol, font: "tb-8", color: o.pal.ink }),
        Text({ content: right, font: "tb-8", color: rightColor }),
      ],
    }),
  });
}

function price(value: number, o: CardOpts): WidgetSpec {
  return Padding({
    pad: { left: 2, top: 0, right: 0, bottom: 0 },
    child: Text({ content: formatPrice(value), font: "6x10", color: o.pal.ink }),
  });
}

/** One complete still of the card at a given point in the draw-on. */
function still(q: Quote, geom: ChartGeom, upto: number, shownPrice: number, o: CardOpts): WidgetSpec {
  return Column({
    children: [
      header(q, o),
      price(shownPrice, o),
      plotFrame(geom, upto, o.width, chartHeight(o), o.pal),
    ],
  });
}

/**
 * Endpoint marker for the settle phase: a 2px dot at the live end of the
 * line, breathing over the 22 frames. Stacked over the held card so the
 * card itself stays a single subtree.
 */
function marker(q: Quote, geom: ChartGeom, o: CardOpts): WidgetSpec {
  const h = chartHeight(o);
  const last = geom.deltas[geom.deltas.length - 1] ?? 0;
  const top = HEADER_H + PRICE_H + rowOf(last, geom, h);
  // Ink, not the series colour — a marker tinted like the line it sits on
  // is invisible against it.
  const base = o.pal.ink;
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < SETTLE_FRAMES; f++) {
    const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 2 * f) / SETTLE_FRAMES));
    frames.push(
      Padding({
        pad: { left: Math.max(0, o.width - 2), top: Math.max(0, top - 1), right: 0, bottom: 0 },
        child: Box({ width: 2, height: 2, color: alpha(base, a) }),
      }),
    );
  }
  return Animation({ children: frames });
}

/** Card with nothing moving — used on both sides of a slide. */
export function staticCard(q: Quote, o: CardOpts): WidgetSpec {
  const geom = chartGeom(q.series, q.chartBase);
  return still(q, geom, geom.deltas.length, q.last, o);
}

/**
 * Draw-on then settle: 38 frames. Sequence (not Animation) so the child
 * timelines restart from zero each time this slot comes round.
 */
export function animatedCard(q: Quote, o: CardOpts): WidgetSpec {
  const geom = chartGeom(q.series, q.chartBase);
  const n = geom.deltas.length;

  const drawFrames: WidgetSpec[] = [];
  for (let f = 0; f < DRAW_FRAMES; f++) {
    const t = (f + 1) / DRAW_FRAMES;
    const upto = Math.max(2, Math.round(t * n));
    const shown = q.prevClose + (q.last - q.prevClose) * easeOutCubic(t);
    drawFrames.push(still(q, geom, upto, shown, o));
  }

  const settled = still(q, geom, n, q.last, o);
  const hold = Transformation({
    child: settled,
    duration: SETTLE_FRAMES,
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, 0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
  });

  return Sequence({
    children: [
      Animation({ children: drawFrames }),
      // Marker rides over the held card; both run SETTLE_FRAMES, so the
      // Stack's frame count is exactly SETTLE_FRAMES.
      Stack({ children: [hold, marker(q, geom, o)] }),
    ],
  });
}

/** The 12-frame handoff between two slots. */
export function slide(from: Quote, to: Quote, o: CardOpts): WidgetSpec {
  const out = Transformation({
    child: staticCard(from, o),
    duration: SLIDE_FRAMES,
    keyframes: [
      animation.Keyframe({
        percentage: 0,
        transforms: [animation.Translate(0, 0)],
        curve: "ease_in_out",
      }),
      animation.Keyframe({
        percentage: 1,
        transforms: [animation.Translate(0, -o.height)],
        curve: "ease_in_out",
      }),
    ],
    fillMode: "forwards",
  });
  const incoming = Transformation({
    child: staticCard(to, o),
    duration: SLIDE_FRAMES,
    keyframes: [
      animation.Keyframe({
        percentage: 0,
        transforms: [animation.Translate(0, o.height)],
        curve: "ease_in_out",
      }),
      animation.Keyframe({
        percentage: 1,
        transforms: [animation.Translate(0, 0)],
        curve: "ease_in_out",
      }),
    ],
    fillMode: "forwards",
  });
  return Stack({ children: [out, incoming] });
}

/** A one-off edge flash on entry for a symbol past the mover threshold. */
export function moverFlash(q: Quote, o: CardOpts, threshold: number): WidgetSpec | null {
  if (Math.abs(q.changePct) < threshold) return null;
  const col = q.changePct >= 0 ? o.pal.gain : o.pal.loss;
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < DRAW_FRAMES + SETTLE_FRAMES; f++) {
    const a = f < 4 ? (1 - f / 4) * 0.85 : 0;
    frames.push(
      a > 0
        ? Column({
            children: [
              Box({ width: o.width, height: 1, color: alpha(col, a) }),
              Box({ height: Math.max(0, o.height - 2) }),
              Box({ width: o.width, height: 1, color: alpha(col, a) }),
            ],
          })
        : Box({ width: 1, height: 1 }),
    );
  }
  return Animation({ children: frames });
}

export type { CardOpts };

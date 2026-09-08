/**
 * Direction C — the whole watchlist at once, for 128x64.
 *
 * Nothing cycles here, so nothing is waiting its turn: every row is a
 * symbol, and the only motion is the staggered draw-on of the per-row
 * sparklines. Illegible below 128x64, which is why small panels get the
 * card instead.
 *
 * Columns are fixed-width cells rather than a free `space_between` row —
 * proportional glyph widths would otherwise leave every row's numbers
 * landing in a slightly different place, which is exactly what a tearsheet
 * must not do.
 */

import {
  Animation,
  Box,
  Column,
  Padding,
  Row,
  Sequence,
  Text,
  Transformation,
  animation,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

import type { Quote } from "./types";
import type { Palette } from "./palette";
import { chartGeom, plotFrame } from "./chart";
import { formatChangePct, formatPrice } from "./format";

const ROW_DRAW = 26;
const ROW_STAGGER = 4;
/**
 * The board does not cycle, but the device still loops whatever it emits —
 * so a bare draw-on would restart every ~2s and strobe. Draw once, then
 * hold the completed board for the rest of a 15s loop: the wrap reads as a
 * periodic refresh rather than a glitch. This is the one place in either
 * app where the loop is deliberately not seamless.
 */
const BOARD_TOTAL = 250;
const CHROME_H = 8;
const HEAT_H = 6;
const MIN_ROW_H = 8;
const MAX_ROW_H = 14;

/** Frames the last row finishes on: draw plus the largest stagger offset. */
export const boardFrames = (rows: number): number =>
  ROW_DRAW + ROW_STAGGER * Math.max(0, rows - 1);

/** Hold a static subtree for an exact number of frames. */
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

interface Cells {
  sym: number;
  price: number;
  change: number;
  spark: number;
}

function cells(width: number): Cells {
  const inner = width - 4;
  const sym = Math.round(inner * 0.21);
  const price = Math.round(inner * 0.28);
  const change = Math.round(inner * 0.26);
  return { sym, price, change, spark: Math.max(8, inner - sym - price - change) };
}

/** Fixed-width cell with its text pushed to one edge. */
function cell(width: number, height: number, child: WidgetSpec, align: "start" | "end"): WidgetSpec {
  return Box({
    width,
    height,
    child: Row({ expanded: true, mainAlign: align, crossAlign: "center", children: [child] }),
  });
}

function row(
  q: Quote,
  pal: Palette,
  c: Cells,
  rowH: number,
  revealed: number,
): WidgetSpec {
  const geom = chartGeom(q.series, q.chartBase);
  const up = q.changePct >= 0;
  const upto = Math.max(2, Math.round(revealed * geom.deltas.length));
  const sparkH = Math.max(5, rowH - 2);
  return Box({
    height: rowH,
    child: Padding({
      pad: { left: 2, top: 0, right: 2, bottom: 0 },
      child: Row({
        expanded: true,
        crossAlign: "center",
        children: [
          cell(c.sym, rowH, Text({ content: q.symbol, font: "tb-8", color: pal.ink }), "start"),
          cell(
            c.price,
            rowH,
            Text({ content: formatPrice(q.last), font: "tb-8", color: pal.ink }),
            "end",
          ),
          cell(
            c.change,
            rowH,
            Text({
              content: formatChangePct(q.changePct),
              font: "tb-8",
              color: up ? pal.gain : pal.loss,
            }),
            "end",
          ),
          // Gap so the line never butts up against the percentage.
          Padding({
            pad: { left: 3, top: 0, right: 0, bottom: 0 },
            child: plotFrame(geom, upto, Math.max(6, c.spark - 3), sparkH, pal),
          }),
        ],
      }),
    }),
  });
}

/** One cell per symbol, tinted by the size of the day's move. */
function heat(quotes: Quote[], pal: Palette, width: number): WidgetSpec {
  const cellW = Math.max(1, Math.floor((width - 4) / Math.max(1, quotes.length)));
  const digits = "0123456789ABCDEF";
  return Padding({
    pad: { left: 2, top: 1, right: 2, bottom: 1 },
    child: Row({
      children: quotes.map((q) => {
        const mag = Math.min(1, Math.abs(q.changePct) / 3);
        const base = q.changePct >= 0 ? pal.gain : pal.loss;
        // Alpha stands in for saturation: a flat day barely lights up.
        const v = Math.round((0.25 + 0.75 * mag) * 255);
        return Box({
          width: cellW - 1,
          height: HEAT_H - 2,
          color: base + digits[Math.floor(v / 16)] + digits[v % 16],
        });
      }),
    }),
  });
}

export function board(
  quotes: Quote[],
  pal: Palette,
  width: number,
  height: number,
  label: string,
): WidgetSpec {
  const c = cells(width);
  const bodyH = height - CHROME_H - HEAT_H;
  // Rows grow to fill the panel rather than stacking at the top — a short
  // watchlist on a tall panel should breathe, not leave half of it dark.
  const rowH = Math.max(
    MIN_ROW_H,
    Math.min(MAX_ROW_H, Math.floor(bodyH / Math.max(1, quotes.length))),
  );
  const visible = Math.max(1, Math.min(quotes.length, Math.floor(bodyH / rowH)));
  const shown = quotes.slice(0, visible);

  const chrome = Padding({
    pad: { left: 2, top: 1, right: 2, bottom: 0 },
    child: Row({
      expanded: true,
      mainAlign: "space_between",
      children: [
        Text({ content: "WATCHLIST", font: "tom-thumb", color: pal.accent }),
        Text({ content: label, font: "tom-thumb", color: pal.ink3 }),
      ],
    }),
  });

  const drawFrames: WidgetSpec[] = [];
  const draw = boardFrames(shown.length);
  for (let f = 0; f < draw; f++) {
    drawFrames.push(
      Column({
        children: shown.map((q, i) =>
          row(q, pal, c, rowH, Math.max(0, Math.min(1, (f - i * ROW_STAGGER) / ROW_DRAW))),
        ),
      }),
    );
  }
  const settled = Column({ children: shown.map((q) => row(q, pal, c, rowH, 1)) });

  return Column({
    expanded: true,
    mainAlign: "space_between",
    children: [
      chrome,
      Sequence({
        children: [
          Animation({ children: drawFrames }),
          hold(settled, Math.max(1, BOARD_TOTAL - draw)),
        ],
      }),
      heat(shown, pal, width),
    ],
  });
}

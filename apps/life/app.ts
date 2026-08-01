/**
 * Life — hand port of `life/life.star` (by dinosaursrarr): Conway's Game of
 * Life on a toroidal board seeded randomly each render (`Math.random()` is
 * deterministic inside the isolate, like pixlet's per-render `random`).
 *
 * Differences from the Starlark original:
 *  - Rows are run-length encoded into Boxes instead of one 1px Box per cell
 *    — the original's 2048 widgets/frame × 200 frames wouldn't scale to
 *    128x64 (8192 cells/frame).
 *  - Screen sizes: 64x32 and 64x64 run 1px cells over the full canvas;
 *    128x64 runs the classic 64x32 board at 2px cells, keeping the same
 *    simulation density.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Root,
  Row,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

const APP_DURATION_MS = 15000;
const REFRESH_MS = 75;

const WHITE = "#ffffff";
const BLACK = "#000000";

const NEIGHBOUR_DIFFS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** One generation on a toroidal width x height board of 0/1 cells. */
function nextGeneration(board: Uint8Array, width: number, height: number): Uint8Array {
  const next = new Uint8Array(board.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let neighbours = 0;
      for (const [dx, dy] of NEIGHBOUR_DIFFS) {
        const nx = (x + dx + width) % width;
        const ny = (y + dy + height) % height;
        neighbours += board[ny * width + nx];
      }
      const alive = board[y * width + x] === 1;
      next[y * width + x] =
        (alive && (neighbours === 2 || neighbours === 3)) || (!alive && neighbours === 3) ? 1 : 0;
    }
  }
  return next;
}

/** Render a board as RLE rows of boxes. */
function renderFrame(
  board: Uint8Array,
  width: number,
  height: number,
  cellPx: number,
  aliveColour: string,
  deadColour: string,
): WidgetSpec {
  const rows: WidgetSpec[] = [];
  for (let y = 0; y < height; y++) {
    const row: WidgetSpec[] = [];
    let runColour = board[y * width] === 1 ? aliveColour : deadColour;
    let runLength = 1;
    for (let x = 1; x < width; x++) {
      const colour = board[y * width + x] === 1 ? aliveColour : deadColour;
      if (colour !== runColour) {
        row.push(Box({ width: runLength * cellPx, height: cellPx, color: runColour }));
        runColour = colour;
        runLength = 0;
      }
      runLength += 1;
    }
    row.push(Box({ width: runLength * cellPx, height: cellPx, color: runColour }));
    rows.push(Row({ children: row }));
  }
  return Column({ children: rows });
}

export default function render(config: Config): RootSpec {
  const aliveColour = config.get("alive_colour") || WHITE;
  const deadColour = config.get("dead_colour") || BLACK;

  const screenW = config.width();
  const screenH = config.height();
  // 128x64 runs the classic 64x32 board at 2px cells.
  const cellPx = screenW >= 128 ? 2 : 1;
  const width = Math.floor(screenW / cellPx);
  const height = Math.floor(screenH / cellPx);

  // Random starting point where every cell has equal chance of starting
  // dead or alive.
  let board: Uint8Array = new Uint8Array(width * height);
  for (let i = 0; i < board.length; i++) {
    board[i] = Math.random() > 0.5 ? 1 : 0;
  }

  const frames: WidgetSpec[] = [];
  for (let t = 0; t < APP_DURATION_MS; t += REFRESH_MS) {
    frames.push(renderFrame(board, width, height, cellPx, aliveColour, deadColour));
    board = nextGeneration(board, width, height);
  }

  return Root({
    delay: REFRESH_MS,
    child: Animation({ children: frames }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.color({
        id: "alive_colour",
        name: "Alive colour",
        desc: "The colour to show for living cells",
        icon: "heartPulse",
        default: WHITE,
      }),
      schema.color({
        id: "dead_colour",
        name: "Dead colour",
        desc: "The colour to show for dead cells",
        icon: "skullCrossbones",
        default: BLACK,
      }),
    ],
  });
}

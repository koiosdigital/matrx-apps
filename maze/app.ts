/**
 * Maze — determinism reference app (handoff §11): a seeded recursive
 * backtracker. Same seed ⇒ same maze ⇒ same rendered bytes. No external
 * data, no clock — plain Math.random(), which the frozen isolate
 * environment seeds deterministically (§8.2).
 */

import { Box, Column, Config, Root, Row, Stack, type RootSpec, type WidgetSpec } from "@koiosdigital/matrx-sdk";

// Standard Math.random() is host-seeded from (appId, config, timeBucket)
// inside render isolates (§8.2) — same config within a bucket ⇒ same maze
// ⇒ same bytes. The optional "variant" config key changes the derived seed
// via the config hash.

const CELLS_X = 31; // wall grid 63 wide
const CELLS_Y = 15; // wall grid 31 tall

const WALL = "#0e9e6e";
const START = "#f43";
const END = "#fff";

export default function render(_config: Config): RootSpec {
  // Wall grid: true = wall. Cells at odd coordinates.
  const gw = CELLS_X * 2 + 1;
  const gh = CELLS_Y * 2 + 1;
  const wall: boolean[] = new Array(gw * gh).fill(true);
  const at = (x: number, y: number) => y * gw + x;

  // Iterative recursive backtracker over the cell grid.
  const visited: boolean[] = new Array(CELLS_X * CELLS_Y).fill(false);
  const stack: [number, number][] = [[0, 0]];
  visited[0] = true;
  wall[at(1, 1)] = false;

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const neighbors: [number, number][] = [];
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < CELLS_X &&
        ny < CELLS_Y &&
        !visited[ny * CELLS_X + nx]
      ) {
        neighbors.push([nx, ny]);
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
    visited[ny * CELLS_X + nx] = true;
    // Knock down the wall between (cx,cy) and (nx,ny), and the cell itself.
    wall[at(1 + cx * 2 + (nx - cx), 1 + cy * 2 + (ny - cy))] = false;
    wall[at(1 + nx * 2, 1 + ny * 2)] = false;
    stack.push([nx, ny]);
  }

  // Openings at entry (left of start cell) and exit (right of end cell).
  wall[at(0, 1)] = false;
  wall[at(gw - 1, gh - 2)] = false;

  // Encode rows as runs of wall/passage → compact Row of Boxes.
  const rows: WidgetSpec[] = [];
  for (let y = 0; y < gh; y++) {
    const runs: WidgetSpec[] = [];
    let x = 0;
    while (x < gw) {
      const isWall = wall[at(x, y)];
      let len = 1;
      while (x + len < gw && wall[at(x + len, y)] === isWall) len++;
      runs.push(
        Box({
          width: len,
          height: 1,
          ...(isWall ? { color: WALL } : {}),
        }),
      );
      x += len;
    }
    rows.push(Row({ children: runs }));
  }

  return Root({
    child: Stack({
      children: [
        Column({ children: rows }),
        // Start / end markers.
        Row({
          children: [
            Box({ width: 1, height: 1 }),
            Column({
              children: [Box({ width: 1, height: 1 }), Box({ width: 1, height: 1, color: START })],
            }),
          ],
        }),
        Row({
          children: [
            Box({ width: gw - 2, height: 1 }),
            Column({
              children: [Box({ width: 1, height: gh - 2 }), Box({ width: 1, height: 1, color: END })],
            }),
          ],
        }),
      ],
    }),
  });
}

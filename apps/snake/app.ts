/**
 * Snake — hand port of `snake/snake.star` (by noahpodgurski): a
 * self-playing snake chasing eggs on a wrapping board, 300 frames.
 *
 * Differences from the Starlark original:
 *  - Rows are run-length encoded into Boxes instead of one 1px Box per cell
 *    (like the `life` port) so 128x64 stays cheap.
 *  - Screen sizes: 1px cells over the full canvas; 128x64 runs the classic
 *    64x32 board at 2px cells.
 *
 * `Math.random()` is deterministic inside the isolate.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Root,
  Row,
  Stack,
  schema,
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

const WHITE = "#ffffff";
const BLACK = "#000000";
const GREEN = "#00ff00";

type Pos = [number, number];
type Dir = "u" | "r" | "d" | "l";

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function collideTail(snake: Pos[], pos: Pos): boolean {
  return snake.some((s) => s[0] === pos[0] && s[1] === pos[1]);
}

function renderFrame(snake: Pos[], egg: Pos, width: number, height: number, cellPx: number): WidgetSpec {
  const grid = new Uint8Array(width * height); // 0 bg, 1 snake, 2 egg
  for (const s of snake) grid[s[1] * width + s[0]] = 1;
  grid[egg[1] * width + egg[0]] = 2;
  const colors = [BLACK, WHITE, GREEN];

  const rows: WidgetSpec[] = [];
  for (let y = 0; y < height; y++) {
    const row: WidgetSpec[] = [];
    let run = grid[y * width];
    let runLength = 1;
    for (let x = 1; x < width; x++) {
      const cell = grid[y * width + x];
      if (cell !== run) {
        row.push(Box({ width: runLength * cellPx, height: cellPx, color: colors[run] }));
        run = cell;
        runLength = 0;
      }
      runLength += 1;
    }
    row.push(Box({ width: runLength * cellPx, height: cellPx, color: colors[run] }));
    rows.push(Row({ children: row }));
  }
  return Column({ children: rows });
}

function playSnake(
  startingSize: number,
  growthRate: number,
  width: number,
  height: number,
  cellPx: number,
): WidgetSpec[] {
  const frames: WidgetSpec[] = [];

  const newEgg = (): Pos => [randInt(2, width - 2), randInt(2, height - 2)];

  // Init snake.
  let snakeDir: Dir = "u";
  const snake: Pos[] = [];
  const initX = Math.floor(width / 2) - startingSize;
  const initY = Math.floor(height / 2);
  for (let x = 0; x < startingSize; x++) {
    snake.push([initX + x, initY]);
  }

  let egg = newEgg();

  for (let f = 0; f < 300; f++) {
    const snakePos = snake[snake.length - 1];
    const lastPos = snake[snake.length - 2];

    // Move towards egg.
    if (snakeDir === "u" || snakeDir === "d") {
      if (egg[0] < snakePos[0]) snakeDir = "l";
      else if (egg[0] > snakePos[0]) snakeDir = "r";
      // moving away at same col
      else if (Math.abs(egg[1] - snakePos[1]) > Math.abs(egg[1] - lastPos[1])) snakeDir = "l";
    }
    if (snakeDir === "l" || snakeDir === "r") {
      if (egg[1] < snakePos[1]) snakeDir = "u";
      else if (egg[1] > snakePos[1]) snakeDir = "d";
      // moving away at same row
      else if (Math.abs(egg[0] - snakePos[0]) > Math.abs(egg[0] - lastPos[0])) snakeDir = "u";
    }

    // Do your best to dodge tail.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (snakeDir === "u" && collideTail(snake, [snakePos[0], snakePos[1] - 1])) {
        snakeDir = (["r", "d", "l"] as Dir[])[randInt(0, 2)];
      }
      if (snakeDir === "r" && collideTail(snake, [snakePos[0] + 1, snakePos[1]])) {
        snakeDir = (["d", "l", "u"] as Dir[])[randInt(0, 2)];
      }
      if (snakeDir === "d" && collideTail(snake, [snakePos[0], snakePos[1] + 1])) {
        snakeDir = (["l", "u", "r"] as Dir[])[randInt(0, 2)];
      }
      if (snakeDir === "l" && collideTail(snake, [snakePos[0] - 1, snakePos[1]])) {
        snakeDir = (["u", "r", "d"] as Dir[])[randInt(0, 2)];
      }
    }

    // Get egg.
    if (snakePos[0] === egg[0] && snakePos[1] === egg[1]) {
      egg = newEgg();
      for (let g = 0; g < growthRate; g++) {
        snake.unshift([snake[snake.length - 1][0], snake[snake.length - 1][1]]);
      }
    }

    frames.push(renderFrame(snake, egg, width, height, cellPx));

    // Move snake towards egg.
    const tail = snake.shift()!;
    tail[0] = snakePos[0];
    tail[1] = snakePos[1];
    if (snakeDir === "u") tail[1] = (tail[1] - 1 + height) % height;
    else if (snakeDir === "r") tail[0] = (tail[0] + 1) % width;
    else if (snakeDir === "d") tail[1] = (tail[1] + 1) % height;
    else if (snakeDir === "l") tail[0] = (tail[0] - 1 + width) % width;
    snake.push(tail);
  }

  return frames;
}

export default function render(config: Config): RootSpec {
  const startingSize = parseInt(config.get("STARTING_SIZE") || "4", 10);
  const growthRate = parseInt(config.get("GROWTH_RATE") || "1", 10);

  const screenW = config.width();
  const screenH = config.height();
  // 128x64 runs the classic 64x32 board at 2px cells.
  const cellPx = screenW >= 128 ? 2 : 1;
  const width = Math.floor(screenW / cellPx);
  const height = Math.floor(screenH / cellPx);

  return Root({
    child: Stack({
      children: [Animation({ children: playSnake(startingSize, growthRate, width, height, cellPx) })],
    }),
  });
}

export function getSchema(): Schema {
  const opt = (v: number): SchemaOption => schema.option({ display: String(v), value: String(v) });
  const startingSizeOptions = [4, 5, 6, 7, 8, 9, 10].map(opt);
  const growthRateOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(opt);

  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "STARTING_SIZE",
        name: "Starting size",
        desc: "The starting size of the snake.",
        icon: "gear",
        default: startingSizeOptions[0].value,
        options: startingSizeOptions,
      }),
      schema.dropdown({
        id: "GROWTH_RATE",
        name: "Growth rate",
        desc: "The rate at which the snake grows.",
        icon: "gear",
        default: growthRateOptions[0].value,
        options: growthRateOptions,
      }),
    ],
  });
}

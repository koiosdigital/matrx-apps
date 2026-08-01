/**
 * Tetris Clock — hand port of `tetrisclock/tetris_clock.star` (by
 * MarkGamed7794, with the Koios dynamic-screen-size modifications), kept
 * structurally line-for-line: same piece tables, backwards movement
 * simulation, fade tables, colon cadence and bar layout.
 *
 * The screen-size logic is the Koios fork's: a square cell size is picked to
 * fit 12 grid rows (digit height) and ≥31 columns of content, so the same
 * piece choreography renders on 64x32, 64x64 and 128x64.
 *
 * `Math.random()` is deterministic inside the render isolate (frozen
 * environment), matching pixlet's per-render seeded `random` module.
 */

import {
  Animation,
  Box,
  Column,
  Config,
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
import { time } from "@koiosdigital/matrx-sdk/stdlib";

const FRAME_COUNT = 14 * 15; // module-level in the original: 14fps * 15s
// The piece simulation always runs in a 6x12 digit box (the module-level
// grid in the original — main() only shadows GRID_HEIGHT for rendering);
// VERT_OFFSET then places that box at the bottom of the actual screen grid.
const GRID_WIDTH = 6;
const PIECE_GRID_HEIGHT = 12;
const INITIAL_DELAY = 12;
const BACKGROUND_FALLBACK = "#222";

const DIGIT_SHAPES: Record<number, string> = {
  0: "ZERO",
  1: "ONE",
  2: "TWO",
  3: "THREE",
  4: "FOUR",
  5: "FIVE",
  6: "SIX",
  7: "SEVEN",
  8: "EIGHT",
  9: "NINE",
};

const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_LOCATION = `{
  "lat": "40.6781784",
  "lng": "-73.9441579",
  "description": "Brooklyn, NY, USA",
  "locality": "Brooklyn",
  "place_id": "ChIJCSF8lBZEwokRhngABHRcdoI",
  "timezone": "America/New_York"
}`;

// Piece definitions. Y+ goes down, X+ goes right.
const PIECES: Record<string, [number, number][]> = {
  T0: [[0, -1], [-1, 0], [0, 0], [1, 0]],
  TR: [[0, -1], [0, 0], [1, 0], [0, 1]],
  T2: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  TL: [[0, -1], [-1, 0], [0, 0], [0, 1]],
  I0: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  IR: [[1, -1], [1, 0], [1, 1], [1, 2]],
  I2: [[-1, 1], [0, 1], [1, 1], [2, 1]],
  IL: [[0, -1], [0, 0], [0, 1], [0, 2]],
  O0: [[0, -1], [1, -1], [0, 0], [1, 0]],
  OR: [[0, -1], [1, -1], [0, 0], [1, 0]],
  O2: [[0, -1], [1, -1], [0, 0], [1, 0]],
  OL: [[0, -1], [1, -1], [0, 0], [1, 0]],
  L0: [[1, -1], [-1, 0], [0, 0], [1, 0]],
  LR: [[0, -1], [0, 0], [0, 1], [1, 1]],
  L2: [[-1, 0], [0, 0], [1, 0], [-1, 1]],
  LL: [[-1, -1], [0, -1], [0, 0], [0, 1]],
  J0: [[-1, -1], [-1, 0], [0, 0], [1, 0]],
  JR: [[0, -1], [1, -1], [0, 0], [0, 1]],
  J2: [[-1, 0], [0, 0], [1, 0], [1, 1]],
  JL: [[0, -1], [0, 0], [-1, 1], [0, 1]],
  S0: [[0, -1], [1, -1], [-1, 0], [0, 0]],
  SR: [[0, -1], [0, 0], [1, 0], [1, 1]],
  S2: [[0, 0], [1, 0], [-1, -1], [0, -1]],
  SL: [[-1, -1], [-1, 0], [0, 0], [0, 1]],
  Z0: [[-1, -1], [0, -1], [0, 0], [1, 0]],
  ZR: [[1, -1], [0, 0], [1, 0], [0, 1]],
  Z2: [[-1, 0], [0, 0], [0, -1], [1, -1]],
  ZL: [[0, -1], [-1, 0], [0, 0], [-1, 1]],
};

const PIECE_COLOURS: Record<string, number> = {
  T0: 0, TR: 0, T2: 0, TL: 0,
  I0: 1, IR: 1, I2: 1, IL: 1,
  O0: 2, OR: 2, O2: 2, OL: 2,
  L0: 3, LR: 3, L2: 3, LL: 3,
  J0: 4, JR: 4, J2: 4, JL: 4,
  S0: 5, SR: 5, S2: 5, SL: 5,
  Z0: 6, ZR: 6, Z2: 6, ZL: 6,
};

type Rgb = [number, number, number];

// (T, I, O, L, J, S, Z, background, bar, barLerp)
const COLOUR_SCHEMES: Record<string, [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, number]> = {
  standard_dark: [[187, 68, 255], [68, 255, 255], [255, 255, 68], [255, 187, 68], [68, 136, 255], [68, 255, 68], [255, 68, 68], [22, 22, 22], [255, 255, 255], 0.4],
  standard_light: [[187, 68, 255], [68, 255, 255], [255, 255, 68], [255, 187, 68], [68, 136, 255], [68, 255, 68], [255, 68, 68], [200, 200, 200], [68, 68, 68], 0.6],
  autumn: [[241, 235, 163], [240, 227, 152], [237, 211, 130], [241, 198, 118], [245, 185, 105], [249, 172, 92], [251, 165, 86], [176, 100, 38], [252, 143, 54], 1],
  winter: [[214, 221, 255], [192, 201, 245], [173, 185, 237], [163, 173, 227], [156, 164, 219], [147, 152, 209], [139, 142, 201], [89, 104, 150], [54, 65, 89], 1],
  spring: [[161, 213, 151], [153, 196, 143], [150, 190, 140], [137, 180, 129], [124, 169, 118], [111, 159, 107], [98, 148, 98], [201, 242, 199], [69, 99, 61], 1],
  summer: [[255, 218, 185], [254, 213, 182], [253, 207, 178], [251, 196, 171], [250, 185, 164], [249, 179, 161], [248, 173, 157], [236, 91, 91], [165, 63, 63], 1],
  monochrome_dark: [[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [0, 0, 0], [255, 255, 255], 0.4],
  monochrome_light: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [255, 255, 255], [0, 0, 0], 0.6],
};

const ROTATE_CW: Record<string, string> = {
  T0: "TR", TR: "T2", T2: "TL", TL: "T0",
  I0: "IR", IR: "I2", I2: "IL", IL: "I0",
  O0: "OR", OR: "O2", O2: "OL", OL: "O0",
  L0: "LR", LR: "L2", L2: "LL", LL: "L0",
  J0: "JR", JR: "J2", J2: "JL", JL: "J0",
  S0: "SR", SR: "S2", S2: "SL", SL: "S0",
  Z0: "ZR", ZR: "Z2", Z2: "ZL", ZL: "Z0",
};

// Piece placement definitions are [shape, x position]. Pieces are represented
// by their letter followed by their orientation.
type Placement = [string, number];
const SUBSHAPES: Record<string, (Placement[] | Placement)[]> = {
  TWO_BY_FOUR: [
    [["O0", 0], ["O0", 0]],
    [["LR", 0], ["LL", 1]],
    [["JL", 1], ["JR", 0]],
    [["IL", 0], ["IR", 0]],
  ],
  TWO_BY_SIX: [
    [["TWO_BY_FOUR", 0], ["O0", 0]],
    [["O0", 0], ["TWO_BY_FOUR", 0]],
    [["JL", 1], ["IL", 0], ["LL", 1]],
    [["LR", 0], ["IL", 1], ["JR", 0]],
  ],
  TWO_BY_EIGHT: [
    [["TWO_BY_SIX", 0], ["O0", 0]],
    [["O0", 0], ["TWO_BY_SIX", 0]],
    [["TWO_BY_FOUR", 0], ["TWO_BY_FOUR", 0]],
  ],
  FOUR_BY_TWO: [
    [["O0", -1], ["O0", 1]],
    [["L0", 1], ["L2", 0]],
    [["J0", 0], ["J2", 1]],
  ],
  SIX_BY_TWO: [
    [["O0", -2], ["FOUR_BY_TWO", 1]],
    [["O0", 2], ["FOUR_BY_TWO", -1]],
    [["L0", 2], ["J0", -1], ["I0", 0]],
    [["I0", 0], ["L2", -1], ["J2", 2]],
  ],
  SQUARE_HOOK_DOWN: [
    [["JL", 2], ["J2", 0]],
    [["O0", 1], ["I0", 0]],
  ],
  SQUARE_HOOK_UP: [
    [["L0", 0], ["LL", 2]],
    [["I0", 0], ["O0", 1]],
  ],
  HORIZONTAL_SLANT: [
    [["Z0", -1], ["Z0", 1]],
    [["I0", 0], ["I0", -1]],
    [["T0", 1], ["T2", -1]],
  ],
  VERTICAL_SLANT_RIGHT: [
    [["ZR", 0], ["ZR", 0]],
    [["TR", 0], ["TL", 1]],
    [["IR", 0], ["IL", 0]],
  ],
  VERTICAL_SLANT_LEFT: [
    [["SR", 0], ["SR", 0]],
    [["TL", 1], ["TR", 0]],
    [["IR", 0], ["IL", 0]],
  ],
  BOWL: [
    [["O0", 0], ["SL", -1], ["ZR", 2]],
    [["O0", 0], ["ZR", 2], ["SL", -1]],
    [["I0", 0], ["L0", 2], ["J0", -1]],
    [["I0", 0], ["J0", -1], ["L0", 2]],
  ],
  SIX_MIDDLE: [
    [["T2", -1], ["T2", 2], ["I0", 0], ["TR", -2]],
    [["T2", 2], ["L2", 1], ["VERTICAL_SLANT_LEFT", -2]],
  ],
  ONE: [["TWO_BY_EIGHT", 0]],
  TWO: [
    ["SIX_BY_TWO", 0],
    ["O0", -2],
    ["Z0", 0],
    ["T2", 2],
    ["O0", 2],
    ["S0", 1],
    ["S0", -1],
  ],
  THREE: [
    ["HORIZONTAL_SLANT", 0],
    ["SQUARE_HOOK_DOWN", 1],
    ["SQUARE_HOOK_UP", 1],
    ["S0", 1],
    ["S0", -1],
  ],
  FOUR: [
    ["O0", 1],
    ["I0", -1],
    ["O0", 2],
    ["L0", 0],
    ["VERTICAL_SLANT_RIGHT", -2],
    ["TL", 2],
  ],
  FIVE: [
    ["HORIZONTAL_SLANT", 0],
    ["O0", 2],
    ["T0", 2],
    ["S0", 0],
    ["O0", -2],
    ["I0", 0],
    ["L2", -1],
    ["J2", 2],
  ],
  SIX: [
    ["BOWL", 0],
    ["SIX_MIDDLE", 0],
    ["I0", 0],
    ["I0", 0],
  ],
  SEVEN: [
    ["LR", 0],
    ["JR", 1],
    ["S0", 2],
    ["I0", 0],
    ["L2", -1],
    ["J2", 2],
  ],
  EIGHT: [
    ["BOWL", 0],
    ["TR", -1],
    ["T2", 2],
    ["IL", -2],
    ["I0", 1],
    ["O0", 2],
    ["S0", 1],
    ["JR", -1],
  ],
  NINE: [
    ["FOUR_BY_TWO", 0],
    ["TL", 3],
    ["I0", 0],
    ["T0", -1],
    ["T0", 2],
    ["J2", 2],
    ["L2", -1],
    ["I0", 0],
  ],
  ZERO: [
    ["BOWL", 0],
    ["VERTICAL_SLANT_LEFT", -2],
    ["VERTICAL_SLANT_RIGHT", 2],
    ["FOUR_BY_TWO", 0],
  ],
};

/** Starlark random.number(min, max): integer in [min, max]. */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Grid cells are [solid?, colour, age]; the "unplace bug" of the original
 * (setting cell[0] to the truthy EMPTY_CELL array) is reproduced for
 * choreography parity. */
type Cell = [unknown, string, number];
/** [shape, x, y] */
type Piece = [string, number, number];
/** [piece, movements, placed?, fade age, movement index, movement length] */
type PieceSequence = [Piece, number[], boolean, number, number, number];

function rgb2hex(col: Rgb | number[]): string {
  return (
    "#" +
    [col[0], col[1], col[2]]
      .map((c) => Math.max(0, Math.min(255, Math.floor(c))).toString(16).padStart(2, "0").toUpperCase())
      .join("")
  );
}

const EMPTY_CELL: Cell = [false, BACKGROUND_FALLBACK, 0];

function newGrid(): Cell[][] {
  const grid: Cell[][] = [];
  for (let y = 0; y < PIECE_GRID_HEIGHT; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < GRID_WIDTH; x++) row.push(EMPTY_CELL);
    grid.push(row);
  }
  return grid;
}

function collides(grid: Cell[][], piece: Piece): boolean {
  for (const cell of PIECES[piece[0]]) {
    const cx = cell[0] + piece[1];
    const cy = cell[1] + piece[2];
    if (cx >= 0 && cx < GRID_WIDTH && cy >= 0 && cy < PIECE_GRID_HEIGHT) {
      if (grid[cy][cx][0]) return true;
    } else if (cy >= PIECE_GRID_HEIGHT) {
      return true;
    }
  }
  return false;
}

function place(grid: Cell[][], piece: Piece): boolean {
  for (const cell of PIECES[piece[0]]) {
    const cx = cell[0] + piece[1];
    const cy = cell[1] + piece[2];
    if (cx >= 0 && cx < GRID_WIDTH && cy >= 0 && cy < PIECE_GRID_HEIGHT) {
      grid[cy][cx] = [true, "#fff", 1];
    } else if (cy >= PIECE_GRID_HEIGHT) {
      return true;
    }
  }
  return false;
}

function unplace(grid: Cell[][], piece: Piece): boolean {
  for (const cell of PIECES[piece[0]]) {
    const cx = cell[0] + piece[1];
    const cy = cell[1] + piece[2];
    if (cx >= 0 && cx < GRID_WIDTH && cy >= 0 && cy < PIECE_GRID_HEIGHT) {
      // Original sets element 0 to the (truthy) EMPTY_CELL array; kept as-is.
      grid[cy][cx][0] = EMPTY_CELL;
    } else if (cy >= PIECE_GRID_HEIGHT) {
      return true;
    }
  }
  return false;
}

function generateFinalPieces(subshape: (Placement[] | Placement)[], offset: number, tempGrid: Cell[][]): Piece[] {
  const finalPieces: Piece[] = [];
  for (const piece of subshape as Placement[]) {
    const shape = piece[0] as string;
    if (PIECES[shape]) {
      // Drop from just above top of grid.
      const tempPiece: Piece = [shape, (piece[1] as number) + offset, 0];
      for (let i = 0; i < PIECE_GRID_HEIGHT + 4; i++) {
        if (!collides(tempGrid, tempPiece)) tempPiece[2] += 1;
        else break;
      }
      tempPiece[2] -= 1;
      finalPieces.push(tempPiece);
      place(tempGrid, tempPiece);
    } else {
      const newSubshape = SUBSHAPES[shape];
      finalPieces.push(
        ...generateFinalPieces(
          newSubshape[randInt(0, newSubshape.length - 1)] as Placement[],
          offset + (piece[1] as number),
          tempGrid,
        ),
      );
    }
  }
  return finalPieces;
}

function generatePieceSequence(subshape: string, dropOffset: number, length: number, moveOdds: number): PieceSequence[] {
  const finalPieces = generateFinalPieces(SUBSHAPES[subshape], 2, newGrid());
  const tempGrid = newGrid();
  const pieceSequences: PieceSequence[] = [];
  for (const piece of finalPieces) place(tempGrid, piece);
  for (let idx = 0; idx < finalPieces.length; idx++) {
    const i = finalPieces.length - idx - 1;
    const piece = finalPieces[i];
    // To mitigate movements that immediately get cancelled, the odds are
    // weighted 66/33 towards a random direction.
    const bias = randInt(1, 2);
    // 0 = nothing, 1 = move left, 2 = move right, 3 = ccw, 4 = cw
    const movements: number[] = [];
    unplace(tempGrid, piece);
    const steps = (i + 1) * Math.floor(length / finalPieces.length) + dropOffset + INITIAL_DELAY;
    for (let movementNum = 0; movementNum < steps; movementNum++) {
      if (randInt(0, 99) < moveOdds) {
        // Movements happen just after gravity, but since we're doing it
        // backwards the gravity happens afterwards.
        let movement: number;
        const movementType = randInt(0, 1); // 0 = movement, 1 = rotation
        if (movementType === 0) {
          movement = randInt(0, 3) !== 0 ? bias : 3 - bias;
        } else {
          movement = randInt(3, 4);
        }

        // We're "undoing" the movement, so this looks backwards.
        if (movement === 1) piece[1] += 1;
        if (movement === 2) piece[1] -= 1;
        if (movement === 3) piece[0] = ROTATE_CW[piece[0]];
        if (movement === 4) piece[0] = ROTATE_CW[ROTATE_CW[ROTATE_CW[piece[0]]]];

        if (!collides(tempGrid, piece)) {
          movements.unshift(movement);
        } else {
          if (movement === 1) piece[1] -= 1;
          if (movement === 2) piece[1] += 1;
          if (movement === 3) piece[0] = ROTATE_CW[ROTATE_CW[ROTATE_CW[piece[0]]]];
          if (movement === 4) piece[0] = ROTATE_CW[piece[0]];
          movements.unshift(0);
        }
      } else {
        movements.unshift(0);
      }
      piece[2] -= 1;
    }

    pieceSequences.unshift([piece, movements, false, 0, 0, movements.length]);
  }
  return pieceSequences;
}

export default function render(config: Config): RootSpec {
  const TWENTY_FOUR_HOUR = config.bool("24hr", false);
  const LEADING_ZERO = config.bool("leadzero", true);
  const SHOW_DATE = config.bool("showdate", true);
  const COLOUR_SCHEME_NAME = config.get("colourscheme", "standard_dark")!;
  const FADE_SPEED = parseInt(config.get("fadespeed", "10")!, 10);
  const FADE_COLOUR = FADE_SPEED > 0;
  const FRAME_RATE = parseInt(config.get("framerate", "10")!, 10);
  const DIGIT_LENGTH = parseInt(config.get("digitlength", "60")!, 10);
  const MOVEMENT_ODDS = parseInt(config.get("movementrate", "2")!, 10);
  const TOP_BAR = config.bool("topbar");

  // Dynamic screen dimensions.
  const SCREEN_W = config.width();
  const SCREEN_H = config.height();
  const BAR_HEIGHT = 8;
  const gridAvailH = TOP_BAR ? SCREEN_H : SCREEN_H - BAR_HEIGHT;

  // Square cell size: fit 12 rows (digit height) and >=31 columns of content.
  const cellPx = Math.max(1, Math.min(Math.floor(gridAvailH / 12), Math.floor(SCREEN_W / 31)));

  const FINAL_GRID_WIDTH = Math.floor(SCREEN_W / cellPx);
  const GRID_HEIGHT = Math.floor(gridAvailH / cellPx);
  const VERT_OFFSET = GRID_HEIGHT - 12; // digits sit at bottom of available grid

  // Brightness.
  const BRIGHTNESS_MULT = parseFloat(config.get("brightness", "1")!);
  const baseScheme = COLOUR_SCHEMES[COLOUR_SCHEME_NAME] ?? COLOUR_SCHEMES.standard_dark;
  const COLOUR_SCHEME: number[][] = [];
  for (let i = 0; i < 9; i++) {
    const col = baseScheme[i] as Rgb;
    COLOUR_SCHEME.push([
      Math.floor(col[0] * BRIGHTNESS_MULT),
      Math.floor(col[1] * BRIGHTNESS_MULT),
      Math.floor(col[2] * BRIGHTNESS_MULT),
    ]);
  }
  const BAR_LERP = baseScheme[9];
  const BACKGROUND_COLOUR = rgb2hex(COLOUR_SCHEME[7]) || BACKGROUND_FALLBACK;

  const location = config.get("location", DEFAULT_LOCATION)!;
  let timezone = DEFAULT_TIMEZONE;
  try {
    const loc = JSON.parse(location) as { timezone?: string };
    timezone = loc.timezone ?? config.get("$tz", DEFAULT_TIMEZONE)!;
  } catch {
    timezone = config.get("$tz", DEFAULT_TIMEZONE)!;
  }
  const now = time.now().inLocation(timezone);

  const adjustedHours = TWENTY_FOUR_HOUR ? now.hour : ((now.hour - 1 + 12) % 12) + 1;

  // --- digit layout ---

  let DIGIT_OFFSETS: number[];
  let COLON_OFFSET: number;
  let sequences: PieceSequence[][];
  if (!LEADING_ZERO && adjustedHours < 10) {
    // 3-digit layout: D0(6) + gap(1) + colon(2) + gap(1) + D1(6) + gap(1) + D2(6) = 23 cells
    const lm = Math.floor((FINAL_GRID_WIDTH - 23) / 2);
    DIGIT_OFFSETS = [lm, lm + 10, lm + 17];
    COLON_OFFSET = lm + 7;
    sequences = [
      generatePieceSequence(DIGIT_SHAPES[adjustedHours % 10], Math.floor((DIGIT_LENGTH * 1) / 20), DIGIT_LENGTH, MOVEMENT_ODDS),
      generatePieceSequence(DIGIT_SHAPES[Math.floor(now.minute / 10)], 0, DIGIT_LENGTH, MOVEMENT_ODDS),
      generatePieceSequence(DIGIT_SHAPES[now.minute % 10], Math.floor((DIGIT_LENGTH * 2) / 20), DIGIT_LENGTH, MOVEMENT_ODDS),
    ];
  } else {
    // 4-digit layout: D0(6)+gap(1)+D1(6)+gap(1)+colon(2)+gap(1)+D2(6)+gap(1)+D3(6) = 30 cells
    const lm = Math.floor((FINAL_GRID_WIDTH - 30) / 2);
    DIGIT_OFFSETS = [lm, lm + 7, lm + 17, lm + 24];
    COLON_OFFSET = lm + 14;
    sequences = [
      generatePieceSequence(DIGIT_SHAPES[Math.floor(adjustedHours / 10)], Math.floor((DIGIT_LENGTH * 3) / 20), DIGIT_LENGTH, MOVEMENT_ODDS),
      generatePieceSequence(DIGIT_SHAPES[adjustedHours % 10], Math.floor((DIGIT_LENGTH * 1) / 20), DIGIT_LENGTH, MOVEMENT_ODDS),
      generatePieceSequence(DIGIT_SHAPES[Math.floor(now.minute / 10)], 0, DIGIT_LENGTH, MOVEMENT_ODDS),
      generatePieceSequence(DIGIT_SHAPES[now.minute % 10], Math.floor((DIGIT_LENGTH * 2) / 20), DIGIT_LENGTH, MOVEMENT_ODDS),
    ];
  }

  // Prefade all colours.
  const FADE_TABLE: string[][] = [[], [], [], [], [], [], []];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j <= FADE_SPEED; j++) {
      const lerpAmt = FADE_COLOUR ? j / FADE_SPEED : 0;
      const colA = COLOUR_SCHEME[i];
      const colB = COLOUR_SCHEME[8];
      FADE_TABLE[i].push(
        rgb2hex([
          Math.floor(colA[0] + (colB[0] - colA[0]) * lerpAmt),
          Math.floor(colA[1] + (colB[1] - colA[1]) * lerpAmt),
          Math.floor(colA[2] + (colB[2] - colA[2]) * lerpAmt),
        ]),
      );
    }
  }

  const frames: WidgetSpec[] = [];
  for (let FRAME = 0; FRAME < FRAME_COUNT; FRAME++) {
    // Prepare a temporary grid for rendering.
    const colourGrid: string[][] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      const row: string[] = [];
      for (let x = 0; x < FINAL_GRID_WIDTH; x++) row.push("#0000");
      colourGrid.push(row);
    }

    // Update sequences.
    let sequenceNo = 0;
    for (const sequence of sequences) {
      // Execute the first movement in each piece.
      for (const piece of sequence) {
        let PIECE_NAME = piece[0][0];
        if (piece[4] >= piece[5]) {
          if (!piece[2]) piece[2] = true; // piece has no more movements :(
          piece[3] += 1;
        } else {
          const movement = piece[1][piece[4]];
          piece[4] += 1;
          piece[0][2] += 1;
          if (movement === 1) piece[0][1] -= 1;
          if (movement === 2) piece[0][1] += 1;
          if (movement === 3) piece[0][0] = ROTATE_CW[ROTATE_CW[ROTATE_CW[PIECE_NAME]]];
          if (movement === 4) piece[0][0] = ROTATE_CW[PIECE_NAME];
        }

        PIECE_NAME = piece[0][0];
        for (const cell of PIECES[PIECE_NAME]) {
          const cx = cell[0] + piece[0][1] + DIGIT_OFFSETS[sequenceNo];
          const cy = cell[1] + piece[0][2] + VERT_OFFSET;
          if (cx >= 0 && cx < FINAL_GRID_WIDTH && cy >= 0 && cy < GRID_HEIGHT) {
            colourGrid[cy][cx] = FADE_TABLE[PIECE_COLOURS[PIECE_NAME]][Math.min(piece[3], FADE_SPEED)];
          }
        }
      }
      sequenceNo += 1;
    }

    // Colon.
    if (FRAME % FRAME_RATE < FRAME_RATE / 2) {
      const col = rgb2hex(COLOUR_SCHEME[FADE_COLOUR ? 8 : PIECE_COLOURS.O0]);
      // Colon dots positioned relative to the 12-cell digit area.
      for (const dotY of [VERT_OFFSET + 5, VERT_OFFSET + 6, VERT_OFFSET + 9, VERT_OFFSET + 10]) {
        if (dotY >= 0 && dotY < GRID_HEIGHT) {
          colourGrid[dotY][COLON_OFFSET] = col;
          if (COLON_OFFSET + 1 < FINAL_GRID_WIDTH) {
            colourGrid[dotY][COLON_OFFSET + 1] = col;
          }
        }
      }
    }

    // Render the grid (run-length encoded rows of boxes).
    const rows: WidgetSpec[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      const row: WidgetSpec[] = [];
      let cumulativeColour = colourGrid[y][0];
      let cumulativeCount = 1;
      for (let x = 1; x < FINAL_GRID_WIDTH; x++) {
        const col = colourGrid[y][x];
        if (col !== cumulativeColour) {
          row.push(Box({ width: cellPx * cumulativeCount, height: cellPx, color: cumulativeColour }));
          cumulativeCount = 0;
        }
        cumulativeCount += 1;
        cumulativeColour = colourGrid[y][x];
      }
      row.push(
        Box({
          width: cellPx * cumulativeCount,
          height: cellPx,
          color: colourGrid[y][FINAL_GRID_WIDTH - 1],
        }),
      );
      rows.push(Row({ children: row }));
    }
    frames.push(Column({ children: rows }));
  }

  const BAR_COLOUR = rgb2hex(COLOUR_SCHEME[TOP_BAR ? 7 : 8]);

  const lerpAmt = TOP_BAR ? BAR_LERP : 0;
  const colA = COLOUR_SCHEME[7];
  const colB = COLOUR_SCHEME[8];
  const TEXT_COLOUR = rgb2hex([
    Math.floor(colA[0] + (colB[0] - colA[0]) * lerpAmt),
    Math.floor(colA[1] + (colB[1] - colA[1]) * lerpAmt),
    Math.floor(colA[2] + (colB[2] - colA[2]) * lerpAmt),
  ]);

  const BAR = Box({
    width: SCREEN_W,
    height: BAR_HEIGHT,
    color: BAR_COLOUR,
    child: Box({
      width: SCREEN_W - 1,
      height: BAR_HEIGHT,
      color: BAR_COLOUR,
      child: Row({
        expanded: true,
        mainAlign: "space_between",
        crossAlign: "end",
        children: [
          Text({
            content: TWENTY_FOUR_HOUR ? "" : now.hour < 12 ? "AM" : "PM",
            color: TEXT_COLOUR,
          }),
          Text({
            content: SHOW_DATE ? now.format(config.get("dateformat", "Jan 02")!).toUpperCase() : "",
            color: TEXT_COLOUR,
          }),
        ],
      }),
    }),
  });

  const DELAY = Math.floor(1000 / FRAME_RATE);

  if (TOP_BAR) {
    return Root({
      delay: DELAY,
      maxAge: 120,
      child: Stack({
        children: [
          Box({ color: BACKGROUND_COLOUR, height: SCREEN_H }),
          BAR,
          Column({ children: [Animation({ children: frames })] }),
        ],
      }),
    });
  }
  return Root({
    delay: DELAY,
    maxAge: 120,
    child: Stack({
      children: [
        Box({ color: BACKGROUND_COLOUR, height: SCREEN_H }),
        Column({ children: [Animation({ children: frames }), BAR] }),
      ],
    }),
  });
}

export function getSchema(): Schema {
  const opt = (display: string, value: string): SchemaOption => schema.option({ display, value });

  const themeOptions = [
    opt("Standard Dark", "standard_dark"),
    opt("Standard Light", "standard_light"),
    opt("Spring", "spring"),
    opt("Summer", "summer"),
    opt("Autumn", "autumn"),
    opt("Winter", "winter"),
    opt("Monochrome Dark", "monochrome_dark"),
    opt("Monochrome Light", "monochrome_light"),
  ];
  const dateFormatOptions = [
    opt("Month, Day", "Jan 02"),
    opt("Day, Month", "02 Jan"),
    opt("Weekday, Day", "Mon 02"),
    opt("Day, Weekday", "02 Mon"),
  ];
  const brightnessOptions = [
    opt("100%", "1"),
    opt("80%", "0.8"),
    opt("60%", "0.6"),
    opt("40%", "0.4"),
    opt("20%", "0.2"),
  ];
  const fadeSpeedOptions = [
    opt("Disabled", "0"),
    opt("Very Slow", "45"),
    opt("Slow", "30"),
    opt("Medium", "20"),
    opt("Fast", "14"),
    opt("Very Fast", "8"),
    opt("Instant", "1"),
  ];
  const framerateOptions = [
    opt("Slow", "8"),
    opt("Medium", "10"),
    opt("Fast", "14"),
    opt("Very Fast", "20"),
  ];
  const digitLengthOptions = [
    opt("Very Slow", "90"),
    opt("Slow", "75"),
    opt("Medium", "60"),
    opt("Fast", "40"),
    opt("Very Fast", "28"),
  ];
  const movementRateOptions = [
    opt("None", "0"),
    opt("Very Slow", "5"),
    opt("Slow", "8"),
    opt("Moderately Slow", "13"),
    opt("Medium", "19"),
    opt("Moderately Fast", "25"),
    opt("Fast", "35"),
    opt("Very Fast", "50"),
    opt("Extreme", "70"),
    opt("Maximum", "100"),
  ];

  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "colourscheme",
        name: "Colour Scheme",
        desc: "The colour scheme of the app.",
        icon: "palette",
        default: themeOptions[0].value,
        options: themeOptions,
      }),
      schema.location({
        id: "location",
        name: "Location",
        desc: "The location to display the time from.",
        icon: "locationDot",
      }),
      schema.toggle({
        id: "24hr",
        name: "24-Hour Clock",
        desc: "Whether or not to show a 24-hour clock (on) or 12-hour clock (off).",
        icon: "clock",
        default: false,
      }),
      schema.toggle({
        id: "leadzero",
        name: "Leading Zero",
        desc: "Whether or not to show a leading zero for the hours.",
        icon: "creativeCommonsZero",
        default: false,
      }),
      schema.toggle({
        id: "showdate",
        name: "Show Date",
        desc: "Whether or not to show the date.",
        icon: "calendar",
        default: true,
      }),
      schema.toggle({
        id: "topbar",
        name: "Text In Background",
        desc: "Whether the text is on a bar on the bottom or in the background.",
        icon: "bars",
        default: false,
      }),
      schema.dropdown({
        id: "dateformat",
        name: "Date Format",
        desc: "The format of the date shown.",
        icon: "calendarDays",
        default: dateFormatOptions[0].value,
        options: dateFormatOptions,
      }),
      schema.dropdown({
        id: "brightness",
        name: "Brightness",
        desc: "Overall brightness.",
        icon: "paintRoller",
        default: brightnessOptions[0].value,
        options: brightnessOptions,
      }),
      schema.dropdown({
        id: "fadespeed",
        name: "Fade Speed",
        desc: "The speed at which the blocks fade out.",
        icon: "stopwatch",
        default: fadeSpeedOptions[2].value,
        options: fadeSpeedOptions,
      }),
      schema.dropdown({
        id: "framerate",
        name: "Animation Speed",
        desc: "The speed at which the animation plays.",
        icon: "gear",
        default: framerateOptions[1].value,
        options: framerateOptions,
      }),
      schema.dropdown({
        id: "digitlength",
        name: "Build Speed",
        desc: "The speed at which the individual digits are built.",
        icon: "hourglassStart",
        default: digitLengthOptions[2].value,
        options: digitLengthOptions,
      }),
      schema.dropdown({
        id: "movementrate",
        name: "Movement Rate",
        desc: "How fast and how much the pieces move on their way down.",
        icon: "arrowsUpDownLeftRight",
        default: movementRateOptions[3].value,
        options: movementRateOptions,
      }),
    ],
  });
}

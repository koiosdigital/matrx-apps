/**
 * Digital Rain — hand port of `digitalrain/digital_rain.star` (by Henry So,
 * Jr., MIT-licensed), kept structurally line-for-line: same LCG random
 * sequence, column styles, drop mutation rules and 30-minute seed window,
 * so a given half-hour shows the same choreography as the original.
 *
 * Screen sizes: column/row counts derive from the canvas, so the rain
 * fills 64x32, 64x64 and 128x64 alike.
 *
 * The glyphs (5 character sizes x 50 glyphs) live in ./glyphs.ts as
 * PNG32-normalized base64 (transparent strokes over black, drawn atop a
 * colored Box — the bigclock trick).
 */

import {
  Animation,
  Box,
  Config,
  Image,
  Padding,
  Root,
  Row,
  Column,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import { CHAR_SIZES, type CharSize } from "./glyphs";

interface ColumnStyle {
  speed: number;
  dropMin: number;
  dropVariance: number;
}

// 'speed' is frames before the drop moves (lower = faster); dropMin/-Variance
// bound the drop-and-trail length.
const FAST_COLUMN: ColumnStyle = { speed: 1, dropMin: 9, dropVariance: 9 };
const NORMAL_COLUMN: ColumnStyle = { speed: 2, dropMin: 9, dropVariance: 9 };
const SLOW_COLUMN: ColumnStyle = { speed: 3, dropMin: 7, dropVariance: 5 };

// Relative frequency of the column types.
const COLUMN_STYLES = [
  FAST_COLUMN, FAST_COLUMN, FAST_COLUMN,
  NORMAL_COLUMN, NORMAL_COLUMN, NORMAL_COLUMN, NORMAL_COLUMN, NORMAL_COLUMN,
  SLOW_COLUMN, SLOW_COLUMN,
];

/** Variance in the position of a column's second drop. */
const SECOND_DROP_VARIANCE = 8;

const FRAMES = 72;
/** A new sequence is generated every 30 minutes. */
const SEED_GRANULARITY = 60 * 30;

const COLORS = ["#00X", "#0X0", "#0XX", "#X00", "#X0X", "#XX0"].map((p) =>
  ["2", "5", "8", "b", "d", "f"].map((v) => p.replace("X", v)),
);
const COLOR_NAMES: Record<string, number> = {
  random: 6,
  "random-mono": 7,
  blue: 0,
  green: 1,
  cyan: 2,
  red: 3,
  magenta: 4,
  yellow: 5,
  multicolor: -1,
};

const CHAR_COUNT = CHAR_SIZES.normal.chars.length;

/** The original's LCG, exact 32-bit arithmetic. */
function rand(seed: { s: number }, max: number): number {
  seed.s = (Math.imul(seed.s, 1103515245) + 12345) >>> 0;
  return (seed.s >>> 16) % max;
}

interface Drop {
  chars: number[];
  mutations: number[];
  offset: number;
  dropSize: number;
  colors: string[];
}

interface RainColumn extends Drop {
  speed: number;
  frameOffset: number;
  size: number;
  secondDrop: Drop | null;
}

interface Dims {
  columns: number;
  rows: number;
}

function colorsOf(seed: { s: number }, colorNumber: number): string[] {
  // Always call rand to preserve the seed sequence.
  const color = rand(seed, COLORS.length);
  return COLORS[colorNumber >= 0 ? colorNumber : color];
}

function generateColumn(seed: { s: number }, dims: Dims, colorNumber: number): RainColumn {
  const style = COLUMN_STYLES[rand(seed, COLUMN_STYLES.length)];
  const speed = style.speed;
  const dropSize = style.dropMin + rand(seed, style.dropVariance);
  const size = Math.floor(FRAMES / speed);
  const offset = rand(seed, size);
  const colors = colorsOf(seed, colorNumber);

  const secondDrop: Drop | null =
    speed === 1 && rand(seed, 7) < 2
      ? {
          chars: Array.from({ length: dims.rows }, () => rand(seed, CHAR_COUNT)),
          mutations: new Array(dims.rows).fill(0),
          offset:
            offset + Math.floor((size - SECOND_DROP_VARIANCE) / 2) + rand(seed, SECOND_DROP_VARIANCE),
          dropSize: style.dropMin + rand(seed, style.dropVariance),
          colors: colorsOf(seed, colorNumber),
        }
      : null;

  return {
    speed,
    frameOffset: rand(seed, speed),
    size,
    chars: Array.from({ length: dims.rows }, () => rand(seed, CHAR_COUNT)),
    mutations: new Array(dims.rows).fill(0),
    offset,
    dropSize,
    colors,
    secondDrop,
  };
}

function mutateChar(
  seed: { s: number },
  dims: Dims,
  chars: number[],
  mutations: number[],
  pos: number,
  size: number,
  n: number,
  numerator: number,
  denominator: number,
): void {
  const index = (((pos + n) % size) + size) % size;
  if (index < dims.rows && rand(seed, denominator) < numerator - mutations[index]) {
    chars[index] = rand(seed, CHAR_COUNT);
    mutations[index] += 1;
  }
}

function mutateChars(
  seed: { s: number },
  dims: Dims,
  chars: number[],
  mutations: number[],
  pos: number,
  size: number,
  dropSize: number,
): void {
  for (let i = 1; i < 6; i++) {
    mutateChar(seed, dims, chars, mutations, -pos, size, dropSize - i, 6 - i, 30);
  }
  for (let n = 1; n < dropSize - 5; n++) {
    mutateChar(seed, dims, chars, mutations, -pos, size, n, 1, 50);
  }
}

/** Visible characters of a drop: [glyph index, position within the drop]. */
function charsOf(dims: Dims, chars: number[], pos: number, size: number, dropSize: number): ([number, number] | null)[] {
  const result: ([number, number] | null)[] = new Array(dims.rows).fill(null);
  for (let i = 0; i < dropSize; i++) {
    const index = (((-pos + i) % size) + size) % size;
    if (index < dims.rows) {
      result[index] = [chars[index], i];
    }
  }
  return result;
}

interface ComputedDrop {
  chars: ([number, number] | null)[];
  dropSize: number;
  colors: string[];
}

function computeDrop(
  seed: { s: number },
  dims: Dims,
  speed: number,
  size: number,
  drop: Drop,
  f: number,
  doMutate: boolean,
): ComputedDrop {
  const pos = Math.floor(f / speed) + drop.offset;

  // Prevent mutation while offset <= dropSize to avoid visible flip-flops
  // when the animation loops.
  if (doMutate && drop.offset > drop.dropSize) {
    mutateChars(seed, dims, drop.chars, drop.mutations, pos, size, drop.dropSize);
  }

  return {
    chars: charsOf(dims, drop.chars, pos, size, drop.dropSize),
    dropSize: drop.dropSize,
    colors: drop.colors,
  };
}

function computeColumn(seed: { s: number }, dims: Dims, column: RainColumn | null, f: number): ComputedDrop[] {
  if (!column) return [];
  const speed = column.speed;
  const frame = f + column.frameOffset;
  const doMutate = frame % speed === 0;

  const first = computeDrop(seed, dims, speed, column.size, column, frame, doMutate);
  if (column.secondDrop) {
    return [first, computeDrop(seed, dims, speed, column.size, column.secondDrop, frame, doMutate)];
  }
  return [first];
}

function renderChar(charSize: CharSize, index: number | null, color: string): WidgetSpec {
  if (index === null) {
    return Box({ width: charSize.w, height: charSize.h });
  }
  return Box({
    color,
    width: charSize.w,
    height: charSize.h,
    child: Image({ src: charSize.chars[index] }),
  });
}

function generateFrame(
  seed: { s: number },
  charSize: CharSize,
  dims: Dims,
  columns: (RainColumn | null)[],
  f: number,
): WidgetSpec {
  const frameChars: (number | null)[][] = Array.from({ length: dims.rows }, () =>
    new Array(dims.columns).fill(null),
  );
  const frameColors: string[][] = Array.from({ length: dims.rows }, () =>
    new Array(dims.columns).fill("#000"),
  );

  for (let c = 0; c < dims.columns; c++) {
    for (const drop of computeColumn(seed, dims, columns[c], f)) {
      for (let i = 0; i < dims.rows; i++) {
        const cell = drop.chars[i];
        if (cell) {
          const r = dims.rows - i - 1;
          frameChars[r][c] = cell[0];
          const loc = cell[1];
          frameColors[r][c] = loc === 0 ? "#fff" : drop.colors[Math.min(drop.dropSize - loc, 5)];
        }
      }
    }
  }

  const rows: WidgetSpec[] = [];
  for (let r = 0; r < dims.rows; r++) {
    const cells: WidgetSpec[] = [];
    for (let c = 0; c < dims.columns; c++) {
      cells.push(
        Box({
          width: charSize.w + 1,
          height: charSize.h + 1,
          child: renderChar(charSize, frameChars[r][c], frameColors[r][c]),
        }),
      );
    }
    rows.push(Row({ children: cells }));
  }
  return Column({ children: rows });
}

export default function render(config: Config): RootSpec {
  // In addition to the schema params, 'seed' is accepted for debugging.
  const seedConfig = config.get("seed");
  const seedValue = seedConfig
    ? parseInt(seedConfig, 10)
    : Math.floor(time.now().unix / SEED_GRANULARITY);
  const seed = { s: seedValue >>> 0 };

  const width = config.width();
  const height = config.height();

  // Get the color; done this way so setting the color from config doesn't
  // spoil the pseudo-random number sequence.
  const colorOptions = [0, 1, 2, 3, 4, 5, rand(seed, COLORS.length + 1) - 1, rand(seed, COLORS.length)];
  let colorNumber = COLOR_NAMES[config.get("color") ?? ""] ?? COLOR_NAMES.random;
  if (colorNumber >= 0) {
    colorNumber = colorOptions[colorNumber];
  }

  const charSize = CHAR_SIZES[config.get("char_size") ?? ""] ?? CHAR_SIZES.normal;
  const dims: Dims = {
    columns: Math.floor(width / (charSize.w + 1)) + 1,
    rows: Math.floor(height / (charSize.h + 1)) + 1,
  };

  const columns: (RainColumn | null)[] = Array.from({ length: dims.columns }, () =>
    generateColumn(seed, dims, colorNumber),
  );

  // Occasionally blow a column away.
  if (rand(seed, 25) === 0 && dims.columns > 2) {
    columns[rand(seed, dims.columns - 2) + 1] = null;
  }

  // Vary the x/y offset for more interesting variety.
  const xoffset = -rand(seed, Math.max(charSize.w, 2));
  const yoffset = -rand(seed, Math.max(charSize.h, 2));

  const frames: WidgetSpec[] = [];
  for (let f = 0; f < FRAMES; f++) {
    frames.push(generateFrame(seed, charSize, dims, columns, f));
  }

  return Root({
    delay: 30,
    child: Box({
      width,
      height,
      child: Padding({
        pad: { left: xoffset, top: yoffset, right: 0, bottom: 0 },
        child: Animation({ children: frames }),
      }),
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "color",
        name: "Color",
        icon: "brush",
        desc: "The color to use for the rain.",
        options: Object.keys(COLOR_NAMES).map((color) =>
          schema.option({ display: color, value: color }),
        ),
        default: "green",
      }),
      schema.dropdown({
        id: "char_size",
        name: "Character Size",
        icon: "textHeight",
        desc: "The character size for the rain.",
        options: Object.keys(CHAR_SIZES).map((charSize) =>
          schema.option({ display: charSize, value: charSize }),
        ),
        default: "normal",
      }),
    ],
  });
}

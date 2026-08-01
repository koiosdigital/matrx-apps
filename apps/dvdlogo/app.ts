/**
 * DVD Logo — hand port of `dvdlogo/dvd_logo.star` (by Mack Ward), kept
 * structurally line-for-line: the bounce position is a pure function of
 * wall-clock time, so consecutive renders continue the same trajectory.
 *
 * Screen sizes: the bounce box is the actual canvas, and on 128x64 the
 * 15x9 logo doubles to 30x18 so it doesn't get lost.
 *
 * The logo PNG has a transparent glyph over an opaque black background —
 * the colored Box underneath shows through the glyph (same trick as
 * bigclock's digits).
 */

import {
  Animation,
  Box,
  Config,
  Image,
  Padding,
  Root,
  Stack,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import LOGO from "./logo.png";

const LOGO_W = 15;
const LOGO_H = 9;
const DELAY_MS = 100;
const APP_CYCLE_SECONDS = 30;

const COLORS = [
  "#0ef", // light blue
  "#f70", // orange
  "#02f", // dark blue
  "#fe0", // yellow
  "#f20", // red
  "#f08", // pink
  "#b0f", // purple
];

interface BounceState {
  posX: number;
  posY: number;
  color: string;
}

function getState(index: number, frameW: number, frameH: number, logoW: number, logoH: number): BounceState {
  const numXPositions = frameW - logoW;
  const numYPositions = frameH - logoH;

  const numXHits = Math.floor(index / numXPositions);
  const velX = numXHits % 2 === 0 ? 1 : -1;

  const numYHits = Math.floor(index / numYPositions);
  const velY = numYHits % 2 === 0 ? 1 : -1;

  const numXStates = numXPositions * 2;
  let posX = (index % numXStates) + 1;
  if (velX !== 1) posX = numXStates - posX;

  const numYStates = numYPositions * 2;
  let posY = (index % numYStates) + 1;
  if (velY !== 1) posY = numYStates - posY;

  const numCornerHits = Math.floor(index / (numXPositions * numYPositions));
  const numHits = numXHits + numYHits - numCornerHits;
  const color = COLORS[numHits % COLORS.length];

  return { posX, posY, color };
}

function getFrame(state: BounceState, logoW: number, logoH: number): WidgetSpec {
  return Padding({
    pad: { left: state.posX, top: state.posY, right: 0, bottom: 0 },
    child: Stack({
      children: [
        Box({ width: logoW, height: logoH, color: state.color }),
        Image({ src: LOGO, width: logoW, height: logoH }),
      ],
    }),
  });
}

export default function render(config: Config): RootSpec {
  const frameW = config.width();
  const frameH = config.height();
  const scale = frameW >= 128 && frameH >= 64 ? 2 : 1;
  const logoW = LOGO_W * scale;
  const logoH = LOGO_H * scale;

  const framesPerSecond = 1000 / DELAY_MS;
  const framesSinceEpoch = Math.floor(time.now().unix * framesPerSecond);
  const numStates = (frameW - logoW) * (frameH - logoH) * COLORS.length * 2;
  const index = framesSinceEpoch % numStates;

  const numFrames = Math.ceil((APP_CYCLE_SECONDS * 1000) / DELAY_MS);

  const frames: WidgetSpec[] = [];
  for (let i = index; i < index + numFrames; i++) {
    frames.push(getFrame(getState(i, frameW, frameH, logoW, logoH), logoW, logoH));
  }

  return Root({
    delay: DELAY_MS,
    child: Animation({ children: frames }),
  });
}

export function getSchema(): Schema {
  return schema.schema({ version: "1", fields: [] });
}

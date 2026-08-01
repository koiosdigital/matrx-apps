/**
 * Fireworks — hand port of `fireworks/fireworks.star`, kept structurally
 * line-for-line: same rocket/flare model, shell distribution, fade table
 * and message marquee.
 *
 * Screen sizes: launch positions, altitudes and the message marquee follow
 * the canvas; wider panels launch proportionally more rockets.
 *
 * `Math.random()` is deterministic inside the isolate (seeded from the
 * quantized render time), matching the original's `random.seed(now // 10)`.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Marquee,
  Padding,
  Root,
  Stack,
  Text,
  schema,
  type Insets,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

const FRAME_DELAYS: Record<string, string> = { Normal: "100", Fast: "60" };
const DURATION_MS = 15100;
const ROCKET_SPEED = 8; // px/sec
const ROCKET_FLARE_SPEED = 8; // px/sec
const ROCKET_FLARES_COUNT = 120;
const ROCKET_FLARES_RADIUS = 8;
const ROCKET_FLARES_DECAY = 500; // ms to fully fade out
const ROCKET_FUSE_SPACING = 750; // ms between rockets
const DEFAULT_MESSAGE = "CUSTOM MESSAGE HERE";
const DEFAULT_FONT = "tb-8";
const DEFAULT_MSG_COLOR = "#CCC";
const DEFAULT_FRAME_DELAY = FRAME_DELAYS.Normal;

const FIREWORK_COLORS = ["#F00", "#0F0", "#00F", "#FF0", "#F80", "#A0F", "#FFF"];

function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

/** 16 transparency levels (#RGB + alpha nibble) per firework color. */
function compileCells(): WidgetSpec[][] {
  return FIREWORK_COLORS.map((c) => {
    const group: WidgetSpec[] = [];
    for (let i = 0; i < 16; i++) {
      group.push(Box({ width: 1, height: 1, color: c + i.toString(16).toUpperCase() }));
    }
    return group;
  });
}

const FIREWORK_CELLS = compileCells();

interface Flare {
  angle: number;
  maxDist: number;
  cos: number;
  sin: number;
}

interface Rocket {
  cells: WidgetSpec[];
  fuse: number;
  positionX: number;
  altitude: number;
  maxAltitude: number;
  burstFrameMs: number;
  flaresDoneFrameMs: number;
  flares: Flare[];
  flaresDone: boolean;
  fadesDone: boolean;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function summonFireworks(width: number, height: number, count: number): Rocket[] {
  const rockets: Rocket[] = [];
  const maxAltitude = height - ROCKET_FLARES_RADIUS;
  const minAltitude = maxAltitude - 3;
  for (let rocketI = 0; rocketI < count; rocketI++) {
    const rocket: Rocket = {
      cells: FIREWORK_CELLS[randInt(0, FIREWORK_CELLS.length - 1)],
      fuse: ROCKET_FUSE_SPACING * rocketI,
      positionX: randInt(ROCKET_FLARES_RADIUS, width - ROCKET_FLARES_RADIUS),
      altitude: -1,
      maxAltitude: randInt(minAltitude, maxAltitude),
      burstFrameMs: -1,
      flaresDoneFrameMs: -1,
      flares: [],
      flaresDone: false,
      fadesDone: false,
    };
    rockets.push(rocket);

    let radiiOdds = 0;
    const layersTwist: number[] = [];
    for (let r = 0; r < ROCKET_FLARES_RADIUS; r++) {
      layersTwist.push(Math.random() * 2 * Math.PI);
      radiiOdds += (r + 1) * (r + 1);
    }

    for (let f = 0; f < ROCKET_FLARES_COUNT; f++) {
      // Pick a shell with odds proportional to its area (r²).
      const randShell = randInt(1, radiiOdds);
      let shell = 0;
      let dist = 0;
      while (shell < randShell) {
        dist += 1;
        shell += dist * dist;
      }
      rocket.flares.push({ angle: layersTwist[dist - 1], maxDist: dist, cos: 0, sin: 0 });
    }

    // Spread flares evenly around each shell.
    for (let shell = 1; shell <= ROCKET_FLARES_RADIUS; shell++) {
      const inShell = rocket.flares.filter((f) => f.maxDist === shell);
      inShell.forEach((flare, i) => {
        flare.angle += ((2 * Math.PI) / inShell.length) * i;
        flare.cos = Math.cos(flare.angle);
        flare.sin = Math.sin(flare.angle);
      });
    }
  }
  return rockets;
}

function renderRocket(timestampMs: number, frameDelay: number, rocket: Rocket, height: number): WidgetSpec {
  const cells: WidgetSpec[] = [];
  if (rocket.fuse > 0) {
    rocket.fuse = Math.max(0, rocket.fuse - frameDelay);
  } else if (rocket.fadesDone) {
    // nothing left to draw
  } else if (rocket.altitude < rocket.maxAltitude) {
    // Draw the rocket.
    rocket.altitude += (frameDelay / 1000) * ROCKET_SPEED;
    rocket.altitude = Math.min(rocket.altitude, rocket.maxAltitude);
    cells.push(
      Padding({
        child: rocket.cells[15],
        pad: pad(rocket.positionX, height - Math.floor(rocket.altitude), 0, 0),
      }),
    );
  } else {
    // Draw the explosion.
    rocket.altitude = rocket.maxAltitude;
    const burstLengthMs = (ROCKET_FLARES_RADIUS / ROCKET_FLARE_SPEED) * 1000;
    if (rocket.burstFrameMs === -1) {
      rocket.burstFrameMs = timestampMs;
    }

    const burstPercent =
      rocket.burstFrameMs > -1 ? Math.min(1, (timestampMs - rocket.burstFrameMs) / burstLengthMs) : 0;

    if (burstPercent === 1 && rocket.flaresDoneFrameMs === -1) {
      rocket.flaresDoneFrameMs = timestampMs;
      rocket.flaresDone = true;
    }

    for (const flare of rocket.flares) {
      let cell: WidgetSpec;
      if (rocket.flaresDone) {
        // Start/continue fading.
        let fadeIdx = 1 - Math.min(1, (timestampMs - rocket.flaresDoneFrameMs) / ROCKET_FLARES_DECAY);
        fadeIdx = Math.floor(fadeIdx * 15);
        rocket.fadesDone = fadeIdx === 0;
        cell = rocket.cells[fadeIdx];
      } else {
        cell = rocket.cells[15];
      }

      const flareDistance = burstPercent * flare.maxDist;
      if (!rocket.fadesDone) {
        cells.push(
          Padding({
            child: cell,
            pad: pad(
              Math.floor(rocket.positionX + flare.cos * flareDistance),
              Math.floor(height - rocket.altitude + flare.sin * flareDistance),
              0,
              0,
            ),
          }),
        );
      }
    }
  }

  return Stack({ children: cells });
}

export default function render(config: Config): RootSpec {
  const width = config.width();
  const height = config.height();

  const msg = config.bool("show_message", true) ? config.str("message", DEFAULT_MESSAGE) : "";

  const widgetMessage = Column({
    expanded: true,
    mainAlign: "end",
    children: [
      Marquee({
        width,
        offsetStart: width,
        align: "center",
        child: Text({
          content: msg,
          color: config.get("message_color", DEFAULT_MSG_COLOR),
          font: config.get("font", DEFAULT_FONT),
        }),
      }),
    ],
  });

  const frameDelay = parseInt(config.get("frame_delay", DEFAULT_FRAME_DELAY)!, 10);
  const rocketCount = Math.round(14 * (width / 64));
  const rockets = summonFireworks(width, height, rocketCount);

  const frames: WidgetSpec[] = [];
  let timestampMs = 0;
  const frameCount = Math.floor(DURATION_MS / frameDelay);
  for (let i = 0; i < frameCount; i++) {
    const frameStack: WidgetSpec[] = [widgetMessage];
    for (const r of rockets) {
      frameStack.push(renderRocket(timestampMs, frameDelay, r, height));
    }
    frames.push(Stack({ children: frameStack }));
    timestampMs += frameDelay;
  }

  return Root({
    delay: frameDelay,
    child: Animation({ children: frames }),
  });
}

export function getSchema(): Schema {
  const fonts = [
    schema.option({ display: "tb-8", value: "tb-8" }),
    schema.option({ display: "tom-thumb", value: "tom-thumb" }),
    schema.option({ display: "Dina", value: "Dina_r400-6" }),
    schema.option({ display: "5x8", value: "5x8" }),
    schema.option({ display: "6x13", value: "6x13" }),
    schema.option({ display: "10x20", value: "10x20" }),
    schema.option({ display: "CG pixel 3x5", value: "CG-pixel-3x5-mono" }),
    schema.option({ display: "CG pixel 4x5", value: "CG-pixel-4x5-mono" }),
  ];

  const speeds = Object.entries(FRAME_DELAYS).map(([display, value]) =>
    schema.option({ display, value }),
  );

  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "message",
        name: "Message",
        desc: "Message to show under the fireworks",
        icon: "pen",
      }),
      schema.dropdown({
        id: "font",
        name: "Font",
        desc: "The font to use for the message",
        icon: "font",
        default: DEFAULT_FONT,
        options: fonts,
      }),
      schema.color({
        id: "message_color",
        name: "Color",
        desc: "The color of the message",
        icon: "brush",
        default: DEFAULT_MSG_COLOR,
      }),
      schema.dropdown({
        id: "frame_delay",
        name: "Message Speed",
        desc: "The speed to scroll long messages",
        icon: "backward",
        default: DEFAULT_FRAME_DELAY,
        options: speeds,
      }),
      schema.toggle({
        id: "show_message",
        name: "Show Message",
        desc: "Disable this to only show fireworks",
        icon: "eye",
        default: true,
      }),
    ],
  });
}

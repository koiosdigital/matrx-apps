/**
 * The animated sky layers.
 *
 * Everything here is one static subtree under a `Transformation`, never a
 * subtree per frame: the renderer interpolates the translate, so a whole
 * rainstorm costs what a single still of it costs. `Animation` is reserved
 * for things that genuinely change shape.
 *
 * SEAM RULE — the device loops frame N-1 straight into frame 0, so every
 * layer's travel must divide the loop exactly. Falling layers translate by
 * `travel` over `FRAMES` and repeat their content with period `travel`, so
 * the offset sequence steps uniformly across the wrap. That is why each
 * layer duplicates its first screen at the far end: it makes content[y]
 * equal content[y + travel] over the visible window, which is precisely the
 * condition for the seam to vanish.
 */

import {
  Animation,
  Box,
  Circle,
  Column,
  Padding,
  Sequence,
  Stack,
  Transformation,
  animation,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

import type { Scene } from "./types";
import type { Stops } from "./sky";

/** Frames in one loop. Every period below divides this. */
export const FRAMES = 150;

/** Deterministic PRNG so a given scene always lays out identically. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hex2 = (v: number): string => {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  const d = "0123456789ABCDEF";
  return d[Math.floor(n / 16)] + d[n % 16];
};

/** Append an alpha byte to a #RRGGBB colour. */
export function alpha(hex: string, a: number): string {
  return hex + hex2(a * 255);
}

/** Vertical gradient as one 1px Box per row — 32 specs, and exact. */
export function skyGradient(stops: Stops, width: number, height: number): WidgetSpec {
  const parse = (h: string) => ({
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  });
  const [a, b, c] = [parse(stops[0]), parse(stops[1]), parse(stops[2])];
  const rows: WidgetSpec[] = [];
  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 0 : y / (height - 1);
    const from = t < 0.5 ? a : b;
    const to = t < 0.5 ? b : c;
    const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const col =
      "#" +
      hex2(from.r + (to.r - from.r) * k) +
      hex2(from.g + (to.g - from.g) * k) +
      hex2(from.b + (to.b - from.b) * k);
    rows.push(Box({ width, height: 1, color: col }));
  }
  return Column({ children: rows });
}

function translateLoop(child: WidgetSpec, dx: number, dy: number): WidgetSpec {
  return Transformation({
    child,
    duration: FRAMES,
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(dx, dy)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
    rounding: "floor",
  });
}

interface FallOpts {
  width: number;
  height: number;
  /** Pixels travelled over one loop; also the content repeat period. */
  travel: number;
  count: number;
  length: number;
  color: string;
  seed: number;
  /** Horizontal drift per row, for wind-slanted rain. */
  slant: number;
  /** Flakes drift sideways; drops don't. */
  sway: number;
}

/**
 * One depth of precipitation. Drops are laid out over `travel` rows, then
 * the first screenful is repeated at `y + travel` so the wrap is invisible.
 */
export function fallLayer(o: FallOpts): WidgetSpec {
  const r = rng(o.seed);
  const children: WidgetSpec[] = [];
  const place = (x: number, y: number) => {
    children.push(
      Padding({
        pad: { left: Math.round(x), top: Math.round(y), right: 0, bottom: 0 },
        child: Box({ width: o.sway > 0 ? 2 : 1, height: o.length, color: o.color }),
      }),
    );
  };
  for (let i = 0; i < o.count; i++) {
    const x = r() * o.width;
    const y = r() * o.travel;
    const drift = o.slant * y + (o.sway > 0 ? Math.sin(y / 7) * o.sway : 0);
    place((x + drift) % o.width, y);
    // Duplicate anything in the first screenful at the far end.
    if (y < o.height + o.length) {
      const y2 = y + o.travel;
      const drift2 = o.slant * y2 + (o.sway > 0 ? Math.sin(y2 / 7) * o.sway : 0);
      place((x + drift2) % o.width, y2);
    }
  }
  return translateLoop(Stack({ children }), 0, -o.travel);
}

/** A blobby cloud from three circles over a slab. */
function cloud(scale: number, color: string): WidgetSpec {
  const s = Math.max(1, Math.round(scale));
  return Stack({
    children: [
      Padding({ pad: { left: 0, top: 2 * s, right: 0, bottom: 0 }, child: Circle({ color, diameter: 5 * s }) }),
      Padding({ pad: { left: 4 * s, top: 0, right: 0, bottom: 0 }, child: Circle({ color, diameter: 7 * s }) }),
      Padding({ pad: { left: 10 * s, top: 2 * s, right: 0, bottom: 0 }, child: Circle({ color, diameter: 5 * s }) }),
      Padding({
        pad: { left: 2 * s, top: 4 * s, right: 0, bottom: 0 },
        child: Box({ width: 11 * s, height: 3 * s, color }),
      }),
    ],
  });
}

interface CloudOpts {
  width: number;
  count: number;
  top: number;
  scale: number;
  color: string;
  seed: number;
}

/**
 * Clouds drift exactly one screen-plus-cloud per loop, so the traverse is
 * periodic by construction rather than by arithmetic luck.
 */
export function cloudLayer(o: CloudOpts): WidgetSpec {
  const r = rng(o.seed);
  const cw = 15 * Math.max(1, Math.round(o.scale));
  const span = o.width + cw;
  const children: WidgetSpec[] = [];
  for (let i = 0; i < o.count; i++) {
    const x = (i * span) / o.count + r() * 6;
    const top = o.top + Math.round(r() * 4);
    for (const copy of [0, span]) {
      children.push(
        Padding({
          pad: { left: Math.round(x + copy), top, right: 0, bottom: 0 },
          child: cloud(o.scale, o.color),
        }),
      );
    }
  }
  return translateLoop(Stack({ children }), -span, 0);
}

/**
 * Sun with rays. Rotating a full 45° — one ray pitch — over the loop is
 * indistinguishable from a slow continuous spin and is exactly periodic.
 */
export function sunLayer(x: number, y: number, core: string, ray: string): WidgetSpec {
  const rays: WidgetSpec[] = [];
  const R = 7;
  for (let i = 0; i < 8; i++) {
    const th = (i * Math.PI) / 4;
    rays.push(
      Padding({
        pad: {
          left: Math.round(R + Math.cos(th) * R),
          top: Math.round(R + Math.sin(th) * R),
          right: 0,
          bottom: 0,
        },
        child: Box({ width: 2, height: 2, color: ray }),
      }),
    );
  }
  const disc = Stack({
    children: [
      ...rays,
      Padding({ pad: { left: R - 3, top: R - 3, right: 0, bottom: 0 }, child: Circle({ color: core, diameter: 7 }) }),
    ],
  });
  const spun = Transformation({
    child: disc,
    duration: FRAMES,
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Rotate(0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Rotate(45)] }),
    ],
    width: 2 * R + 2,
    height: 2 * R + 2,
    origin: animation.Origin(0.5, 0.5),
  });
  return Padding({ pad: { left: x, top: y, right: 0, bottom: 0 }, child: spun });
}

/** Moon, with a shadow disc offset to suggest the phase. */
export function moonLayer(x: number, y: number, phase: number): WidgetSpec {
  const d = 9;
  const shift = Math.round((phase - 0.5) * d * 1.6);
  return Padding({
    pad: { left: x, top: y, right: 0, bottom: 0 },
    child: Stack({
      children: [
        Circle({ color: "#ECEEE4", diameter: d }),
        Padding({
          pad: { left: shift, top: 0, right: 0, bottom: 0 },
          child: Circle({ color: "#0A0E22", diameter: d }),
        }),
      ],
    }),
  });
}

/**
 * Stars twinkling on a short cycle. 10 frames divides 150 exactly, so the
 * cycle lands on the loop boundary.
 */
export function starLayer(width: number, height: number, count: number, seed: number): WidgetSpec {
  const CYCLE = 10;
  const r = rng(seed);
  const stars: { x: number; y: number; k: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.floor(r() * width),
      y: Math.floor(r() * height),
      k: 1 + Math.floor(r() * 3),
      phase: r() * Math.PI * 2,
    });
  }
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < CYCLE; f++) {
    frames.push(
      Stack({
        children: stars.map((s) => {
          const b = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((2 * Math.PI * s.k * f) / CYCLE + s.phase));
          return Padding({
            pad: { left: s.x, top: s.y, right: 0, bottom: 0 },
            child: Box({ width: 1, height: 1, color: alpha("#FFF6E4", b) }),
          });
        }),
      }),
    );
  }
  return Animation({ children: frames });
}

/** Empty filler with an explicit frame count, for Sequence gaps. */
function gap(frames: number): WidgetSpec {
  return Transformation({
    child: Box({ width: 1, height: 1 }),
    duration: frames,
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, 0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
  });
}

/**
 * Two lightning flashes per loop at fixed frames. Cheap: a handful of specs
 * rather than one per frame, and the gaps sum to exactly FRAMES.
 */
export function lightningLayer(width: number, height: number): WidgetSpec {
  const flash = (len: number): WidgetSpec => {
    const frames: WidgetSpec[] = [];
    for (let f = 0; f < len; f++) {
      frames.push(
        Box({ width, height, color: alpha("#D6E8FF", (1 - f / len) * 0.62) }),
      );
    }
    return Animation({ children: frames });
  };
  // 36 + 3 + 65 + 4 + 42 = 150
  return Sequence({ children: [gap(36), flash(3), gap(65), flash(4), gap(42)] });
}

/** Horizontal haze bands drifting against each other. */
export function fogLayer(width: number, height: number, color: string): WidgetSpec {
  const bands: WidgetSpec[] = [];
  const span = width * 2;
  for (let i = 0; i < 5; i++) {
    const top = Math.round((i * height) / 5) + 1;
    for (const copy of [0, span]) {
      bands.push(
        Padding({
          pad: { left: copy, top, right: 0, bottom: 0 },
          child: Box({ width, height: 2, color }),
        }),
      );
    }
  }
  return translateLoop(Stack({ children: bands }), -span, 0);
}

/** Scrim: an alpha ramp so type stays legible without boxing it. */
export function scrimTop(width: number, rows: number, strength: number): WidgetSpec {
  const out: WidgetSpec[] = [];
  for (let y = 0; y < rows; y++) {
    out.push(Box({ width, height: 1, color: alpha("#000000", strength * (1 - y / (rows - 1))) }));
  }
  return Column({ children: out });
}

export function scrimBottom(
  width: number,
  height: number,
  rows: number,
  strength: number,
): WidgetSpec {
  const out: WidgetSpec[] = [Box({ width, height: height - rows })];
  for (let y = 0; y < rows; y++) {
    out.push(Box({ width, height: 1, color: alpha("#000000", strength * (y / (rows - 1))) }));
  }
  return Column({ children: out });
}

/** Everything behind the type, assembled for one scene. */
export function skyScene(
  scene: Scene,
  stops: Stops,
  width: number,
  height: number,
  night: boolean,
  arc: number,
  intensity: number,
): WidgetSpec[] {
  const layers: WidgetSpec[] = [skyGradient(stops, width, height)];
  const scale = intensity;

  // Celestial body rides its arc: low near the horizon, high at midday.
  const bodyX = Math.round(arc * (width - 18)) + 2;
  const bodyY = Math.round((1 - Math.sin(arc * Math.PI)) * (height * 0.42)) + 1;

  if (night) {
    layers.push(starLayer(width, Math.round(height * 0.7), Math.round(14 * scale), 7));
    if (scene === "clear" || scene === "partly") layers.push(moonLayer(bodyX, bodyY, 0.35));
  } else if (scene === "clear" || scene === "partly") {
    layers.push(sunLayer(bodyX, bodyY, "#FFD696", "#FFB260"));
  }

  if (scene === "partly") {
    layers.push(cloudLayer({ width, count: 2, top: 3, scale: 1, color: "#FFFFFF44", seed: 11 }));
  }
  if (scene === "cloudy" || scene === "rain" || scene === "snow" || scene === "thunder" || scene === "sleet") {
    layers.push(cloudLayer({ width, count: 2, top: 0, scale: 1, color: "#2C3242AA", seed: 17 }));
    layers.push(cloudLayer({ width, count: 2, top: 4, scale: 1, color: "#454E64AA", seed: 23 }));
  }
  if (scene === "fog") {
    layers.push(fogLayer(width, height, "#B6BCC466"));
  }

  if (scene === "rain" || scene === "sleet" || scene === "thunder") {
    layers.push(
      fallLayer({ width, height, travel: 150, count: Math.round(140 * scale), length: 2, color: "#5A7CA8AA", seed: 31, slant: 0.16, sway: 0 }),
      fallLayer({ width, height, travel: 225, count: Math.round(120 * scale), length: 3, color: "#86AEDCDD", seed: 41, slant: 0.2, sway: 0 }),
      fallLayer({ width, height, travel: 300, count: Math.round(80 * scale), length: 4, color: "#C8E0FF", seed: 53, slant: 0.24, sway: 0 }),
    );
  }
  if (scene === "snow") {
    layers.push(
      fallLayer({ width, height, travel: 75, count: Math.round(90 * scale), length: 1, color: "#BCC8DCAA", seed: 61, slant: 0, sway: 2 }),
      fallLayer({ width, height, travel: 150, count: Math.round(70 * scale), length: 1, color: "#ECF2FC", seed: 71, slant: 0, sway: 3 }),
    );
  }
  if (scene === "wind") {
    layers.push(
      fallLayer({ width, height, travel: 150, count: Math.round(60 * scale), length: 1, color: "#C8D4E488", seed: 83, slant: 2.4, sway: 0 }),
    );
  }
  if (scene === "thunder") {
    layers.push(lightningLayer(width, height));
  }

  return layers;
}

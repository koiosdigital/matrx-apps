/**
 * Subscreen cycling.
 *
 * The transition is an alpha dissolve on the *type*, not a solid box faded
 * over the panel: the sky has to keep moving through it. That is only
 * possible because every screen builder threads an opacity multiplier
 * through its colours — see `screens.ts`.
 *
 * Frame accounting is done here rather than by hand so the total is exact
 * by construction. `plan()` distributes whatever is left after the fades by
 * weight and puts any rounding remainder on the first screen, so the sum is
 * always `total` and the loop seam never drifts.
 */

import {
  Animation,
  Box,
  Sequence,
  Transformation,
  animation,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

/** A screen that can be drawn at an arbitrary opacity and progress. */
export interface Screen {
  /** `a` is opacity 0..1; `prog` is 0..1 through this screen's own hold. */
  build: (a: number, prog: number) => WidgetSpec;
  /** Relative share of the non-transition frames. */
  weight: number;
  /** True when the screen animates during its hold and needs a frame each. */
  animated?: boolean;
}

/** Hold a static subtree for an exact number of frames. */
export function hold(child: WidgetSpec, frames: number): WidgetSpec {
  return Transformation({
    child,
    duration: Math.max(1, frames),
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, 0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
  });
}

/** Frames each screen holds for, guaranteed to sum with the fades to `total`. */
export function plan(weights: number[], fadeFrames: number, total: number): number[] {
  const budget = total - weights.length * fadeFrames;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const holds = weights.map((w) => Math.max(1, Math.floor((budget * w) / sum)));
  const drift = budget - holds.reduce((a, b) => a + b, 0);
  holds[0] += drift;
  return holds;
}

/**
 * One screen dissolving into the next: the first half ramps the outgoing
 * type to nothing, the second brings the incoming type up.
 */
function dissolve(from: Screen, to: Screen, frames: number): WidgetSpec {
  const half = Math.max(1, Math.floor(frames / 2));
  const out: WidgetSpec[] = [];
  for (let f = 0; f < half; f++) {
    out.push(from.build(1 - (f + 1) / half, 1));
  }
  for (let f = 0; f < frames - half; f++) {
    out.push(to.build((f + 1) / (frames - half), 0));
  }
  return Animation({ children: out });
}

/**
 * The full content timeline. Returns exactly `total` frames so it lines up
 * with the sky layers underneath, which are all periodic in `total`.
 */
export function cycle(screens: Screen[], fadeFrames: number, total: number): WidgetSpec {
  if (screens.length === 0) return Box({ width: 1, height: 1 });
  if (screens.length === 1) {
    const only = screens[0];
    return only.animated
      ? Animation({
          children: Array.from({ length: total }, (_, f) => only.build(1, f / (total - 1 || 1))),
        })
      : hold(only.build(1, 1), total);
  }

  const holds = plan(
    screens.map((s) => s.weight),
    fadeFrames,
    total,
  );

  const children: WidgetSpec[] = [];
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const frames = holds[i];
    if (s.animated) {
      children.push(
        Animation({
          children: Array.from({ length: frames }, (_, f) => s.build(1, f / (frames - 1 || 1))),
        }),
      );
    } else {
      children.push(hold(s.build(1, 1), frames));
    }
    children.push(dissolve(s, screens[(i + 1) % screens.length], fadeFrames));
  }
  return Sequence({ children, duration: total });
}

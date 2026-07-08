/**
 * Animation helpers, ported from the Starlark `#MARK: Animation helpers`
 * section. `animation.Transformation(...)` maps to the SDK `Transformation`
 * widget builder; `animation.Keyframe/Translate` come from the SDK `animation`
 * namespace. Keyword args become options objects; snake_case → camelCase.
 */

import {
  Animation,
  Box,
  Sequence,
  Stack,
  Transformation,
  animation,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

/** Estimate the frame count for one cycle of nChildren screens. */
export function cycleFrames(
  nChildren: number,
  hold: number,
  transition: number,
  style = "crossfade",
): number {
  if (nChildren <= 1) return hold;
  if (style === "crossfade") return nChildren * (hold + 2 * transition);
  if (style === "slide_up" || style === "slide_down") {
    return nChildren * (hold + transition);
  }
  return nChildren * hold;
}

/** Target duration (max of all cycles) so every block loops to fill it. */
export function syncDuration(cycleEstimates: number[]): number {
  let result = 0;
  for (const c of cycleEstimates) {
    if (c > result) result = c;
  }
  return result;
}

function slideVectors(
  direction: string,
  width: number,
  height: number,
): [number, number, number, number] {
  if (direction === "up") return [0, -height, 0, height];
  if (direction === "down") return [0, height, 0, -height];
  throw new Error(`Unknown direction: ${direction}`);
}

interface SlideOpts {
  holdFrames?: number;
  slideFrames?: number;
  direction?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export function cycleSlide(
  children: WidgetSpec[],
  {
    holdFrames = 60,
    slideFrames = 15,
    direction = "up",
    width = 64,
    height = 32,
    duration = 0,
  }: SlideOpts = {},
): WidgetSpec {
  if (children.length === 0) return Box();
  if (children.length === 1) return children[0];

  const seqChildren: WidgetSpec[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[(i + 1) % children.length];
    const [xOut, yOut, xIn, yIn] = slideVectors(direction, width, height);

    const hold = Transformation({
      child,
      duration: holdFrames,
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(0, 0)] }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(0, 0)] }),
      ],
      waitForChild: true,
    });
    seqChildren.push(hold);

    const slideOut = Transformation({
      child,
      duration: slideFrames,
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(0, 0)], curve: "ease_in_out" }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(xOut, yOut)], curve: "ease_in_out" }),
      ],
      fillMode: "forwards",
    });
    const slideIn = Transformation({
      child: nextChild,
      duration: slideFrames,
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(xIn, yIn)], curve: "ease_in_out" }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(0, 0)], curve: "ease_in_out" }),
      ],
      fillMode: "forwards",
    });
    seqChildren.push(Stack({ children: [slideOut, slideIn] }));
  }

  if (duration > 0) return Sequence({ children: seqChildren, duration });
  return Sequence({ children: seqChildren });
}

function toHexByte(val: number): string {
  val = Math.max(0, Math.min(255, Math.trunc(val)));
  const hexChars = "0123456789abcdef";
  return hexChars[Math.floor(val / 16)] + hexChars[val % 16];
}

function normalizeColor(color: string): string {
  let c = color;
  if (c[0] === "#") c = c.slice(1);
  if (c.length === 3) return "#" + c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length === 4) return "#" + c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length === 6) return "#" + c;
  if (c.length === 8) return "#" + c.slice(0, 6);
  return "#" + c;
}

interface CrossfadeOpts {
  holdFrames?: number;
  fadeFrames?: number;
  bgColor?: string;
  duration?: number;
}

export function cycleCrossfade(
  children: WidgetSpec[],
  { holdFrames = 60, fadeFrames = 10, bgColor = "#000", duration = 0 }: CrossfadeOpts = {},
): WidgetSpec {
  if (children.length === 0) return Box();
  if (children.length === 1) return children[0];

  // Use Sequence (not Animation) so each child gets a relative frameIdx from
  // 0 — that lets a Marquee scroll from the beginning each cycle. Hold phases
  // use Transformation(waitForChild) so the hold extends until the Marquee
  // finishes scrolling.
  const seqChildren: WidgetSpec[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[(i + 1) % children.length];

    const hold = Transformation({
      child,
      duration: holdFrames,
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(0, 0)] }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(0, 0)] }),
      ],
      waitForChild: true,
    });
    seqChildren.push(hold);

    if (fadeFrames > 0) {
      const transitionFrames: WidgetSpec[] = [];
      for (let f = 0; f < fadeFrames; f++) {
        const alpha = Math.trunc(((f + 1) * 255) / fadeFrames);
        const overlay = normalizeColor(bgColor) + toHexByte(alpha);
        transitionFrames.push(Stack({ children: [child, Box({ color: overlay })] }));
      }
      for (let f = 0; f < fadeFrames; f++) {
        const alpha = Math.trunc(((fadeFrames - f) * 255) / fadeFrames);
        const overlay = normalizeColor(bgColor) + toHexByte(alpha);
        transitionFrames.push(Stack({ children: [nextChild, Box({ color: overlay })] }));
      }
      seqChildren.push(Animation({ children: transitionFrames }));
    }
  }

  if (duration > 0) return Sequence({ children: seqChildren, duration });
  return Sequence({ children: seqChildren });
}

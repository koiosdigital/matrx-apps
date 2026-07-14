/**
 * Animation helpers.
 *
 * Loop correctness: the device loops the rendered animation, so frame T-1
 * must land exactly on the end of a full cycle of every cycling block — then
 * frame 0 follows seamlessly. The renderer's `Sequence(duration)` replays its
 * children modulo their natural length, so each block's base cycle must
 * divide the total duration exactly.
 *
 * The old port used `waitForChild` holds, which stretch with marquee text
 * width — that made the real cycle length differ from the static estimate and
 * the loop cut mid-cycle. Instead we compute every marquee's frame count here
 * (mirroring renderer formulas; both fonts used in marquees are 6px
 * monospace), give holds explicit durations, and pad holds so all cycles are
 * commensurate (see `syncCycles`).
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

/** Advance width of Dina_r400-6 and 6x10 — both monospace, 6px per glyph. */
const MONO_ADVANCE = 6;

/** Renderer marquee wrap-around gap (render/marquee LOOP_GAP). */
const LOOP_GAP = 10;

/**
 * Pixel width of a single-line Text in a 6px monospace font. Glyphs missing
 * from the font advance 0 in the renderer, so this is an upper bound — safe:
 * holds sized from it are never shorter than the real scroll.
 */
export function textWidthPx(content: string): number {
  return [...content].length * MONO_ADVANCE;
}

/** tb-8 per-glyph advance widths for codepoints 32..126, one digit each. */
const TB8_ADVANCES =
  "32455552335434255555555555234444655555555445565555554566565555453554555554454655555455465555255";
/** Max advance in the whole font — safe upper bound for other codepoints. */
const TB8_DEFAULT_ADVANCE = 6;

/** Pixel width of a single-line Text in the proportional tb-8 font. */
export function textWidthTb8(content: string): number {
  let w = 0;
  for (const ch of content) {
    const cp = ch.codePointAt(0) ?? 0;
    w += cp >= 32 && cp <= 126 ? TB8_ADVANCES.charCodeAt(cp - 32) - 48 : TB8_DEFAULT_ADVANCE;
  }
  return w;
}

export interface MarqueeFrameOpts {
  /** Child (text) pixel width along the scroll axis. */
  cw: number;
  /** Marquee viewport size along the scroll axis. */
  size: number;
  delay?: number;
  endDelay?: number;
  loop?: boolean;
  offsetStart?: number;
  offsetEnd?: number;
}

/** Mirror of the renderer's Marquee.frameCount() for horizontal scroll. */
export function marqueeFrames({
  cw,
  size,
  delay = 0,
  endDelay = 0,
  loop = false,
  offsetStart = 0,
  offsetEnd = 0,
}: MarqueeFrameOpts): number {
  if (cw <= size) return 1;
  if (loop) return delay + cw + LOOP_GAP + 1 + endDelay;
  const offstart = Math.max(offsetStart, -cw);
  const offend = Math.max(offsetEnd, -cw);
  if (offstart === offend) {
    return cw + offstart + size - offend + delay + endDelay;
  }
  return cw + offstart + size - offend + 1 + delay + endDelay;
}

/** Frames one transition adds per subscreen for a given style. */
export function transitionCost(style: string, transition: number): number {
  if (style === "crossfade") return 2 * transition;
  if (style === "slide_up" || style === "slide_down") return transition;
  return 0;
}

/** One cycling block: per-child hold durations + resulting base cycle. */
export interface CyclePlan {
  holds: number[];
  transCost: number;
  base: number;
}

/**
 * Plan a block's cycle: each hold shows its child for at least `holdFrames`,
 * extended to the child's own frame count (marquee scroll) — the explicit
 * replacement for `waitForChild`.
 */
export function planCycle(
  childFrames: number[],
  holdFrames: number,
  transCost: number,
): CyclePlan {
  const holds = childFrames.map((f) => Math.max(holdFrames, f));
  const base = holds.reduce((sum, h) => sum + h + transCost, 0);
  return { holds, transCost, base };
}

function padCycle(plan: CyclePlan, pad: number): void {
  const n = plan.holds.length;
  const each = Math.trunc(pad / n);
  const extra = pad % n;
  for (let i = 0; i < n; i++) {
    plan.holds[i] += each + (i < extra ? 1 : 0);
  }
  plan.base += pad;
}

/**
 * Pick the total animation duration T and pad plan holds so every plan's
 * base cycle divides T exactly, with T ≥ minFrames (so slower one-shot
 * widgets — e.g. the looping carrier marquee, which freezes at its start
 * position once done — fit inside one T and stay seam-safe).
 *
 * Two plans a ≥ b are made commensurate by running b exactly
 * k = floor(a.base / b.base) times per a-cycle: b is padded up to
 * ceil(a.base / k) and a up to k times that. Padding is small (< k + n
 * frames) and spread across holds, so no LCM blow-up.
 */
export function syncCycles(plans: CyclePlan[], minFrames: number): number {
  const min = Math.max(1, minFrames);
  if (plans.length === 0) return min;
  if (plans.length === 1) {
    const b = plans[0].base;
    return b * Math.max(1, Math.ceil(min / b));
  }
  let [a, b] = plans;
  if (b.base > a.base) [a, b] = [b, a];
  const k = Math.max(1, Math.trunc(a.base / b.base));
  const bTarget = Math.ceil(a.base / k);
  padCycle(b, bTarget - b.base);
  padCycle(a, k * bTarget - a.base);
  const cycle = a.base; // == k * b.base
  return cycle * Math.max(1, Math.ceil(min / cycle));
}

function slideVectors(
  direction: string,
  width: number,
  height: number,
): [number, number, number, number] {
  void width;
  if (direction === "up") return [0, -height, 0, height];
  if (direction === "down") return [0, height, 0, -height];
  throw new Error(`Unknown direction: ${direction}`);
}

interface SlideOpts {
  holds: number[];
  slideFrames?: number;
  direction?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export function cycleSlide(
  children: WidgetSpec[],
  {
    holds,
    slideFrames = 15,
    direction = "up",
    width = 64,
    height = 32,
    duration = 0,
  }: SlideOpts,
): WidgetSpec {
  if (children.length === 0) return Box();
  if (children.length === 1) return children[0];

  const seqChildren: WidgetSpec[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[(i + 1) % children.length];
    const [xOut, yOut, xIn, yIn] = slideVectors(direction, width, height);

    // Fixed hold duration (≥ the child's marquee scroll) keeps the cycle
    // length deterministic so `duration` can be an exact multiple of it.
    const hold = Transformation({
      child,
      duration: holds[i],
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(0, 0)] }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(0, 0)] }),
      ],
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
  holds: number[];
  fadeFrames?: number;
  bgColor?: string;
  duration?: number;
}

export function cycleCrossfade(
  children: WidgetSpec[],
  { holds, fadeFrames = 10, bgColor = "#000", duration = 0 }: CrossfadeOpts,
): WidgetSpec {
  if (children.length === 0) return Box();
  if (children.length === 1) return children[0];

  // Use Sequence (not Animation) so each child gets a relative frameIdx from
  // 0 — that lets a Marquee scroll from the beginning each cycle.
  const seqChildren: WidgetSpec[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[(i + 1) % children.length];

    const hold = Transformation({
      child,
      duration: holds[i],
      keyframes: [
        animation.Keyframe({ percentage: 0.0, transforms: [animation.Translate(0, 0)] }),
        animation.Keyframe({ percentage: 1.0, transforms: [animation.Translate(0, 0)] }),
      ],
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
        // Ends at alpha 0 so the fade's last frame matches the next hold's
        // first frame exactly (loop seam included).
        const alpha = Math.trunc(((fadeFrames - f - 1) * 255) / fadeFrames);
        const overlay = normalizeColor(bgColor) + toHexByte(alpha);
        transitionFrames.push(Stack({ children: [nextChild, Box({ color: overlay })] }));
      }
      seqChildren.push(Animation({ children: transitionFrames }));
    }
  }

  if (duration > 0) return Sequence({ children: seqChildren, duration });
  return Sequence({ children: seqChildren });
}

/** Dispatch on the configured style; used by both cycling blocks. */
export function buildCycle(
  children: WidgetSpec[],
  style: string,
  plan: CyclePlan,
  transition: number,
  width: number,
  height: number,
  duration: number,
): WidgetSpec {
  if (style === "slide_up" || style === "slide_down") {
    return cycleSlide(children, {
      holds: plan.holds,
      slideFrames: transition,
      direction: style === "slide_up" ? "up" : "down",
      width,
      height,
      duration,
    });
  }
  const fade = style === "crossfade" ? transition : 0;
  return cycleCrossfade(children, { holds: plan.holds, fadeFrames: fade, bgColor: "#000", duration });
}

/**
 * Subscreen builders + the main flight layout, ported from the Starlark
 * `#MARK: Subscreen builders` and `#MARK: Rendering` sections.
 *
 * Every subscreen returns a Box of exactly (width x BOTTOM_H) with an expanded
 * Column inside so content sits at the bottom; each text line is wrapped in a
 * Marquee(width) so a narrow Column isn't centered horizontally by the Box.
 *
 * Builders return the widget together with its intrinsic frame count
 * (computed via animation.ts mirrors of the renderer formulas) so the caller
 * can size holds exactly and pick a total duration every cycle divides —
 * that's what makes the device loop (last frame → frame 0) seamless.
 *
 * Scrolling marquees inside cycled blocks get `delay = transition cost`: the
 * incoming transition paints the child at frame indexes 0..cost-1, so with
 * that delay the text is still at its start position when the hold begins —
 * transition end and hold start are pixel-identical, including at the loop
 * seam.
 *
 * Note: the Starlark `main_align="left"` / `"top"` (pixlet-lenient aliases for
 * the main-axis start) become `"start"` here, which the SDK's stricter
 * MainAlign type requires — same visual result.
 */

import {
  Box,
  Column,
  Marquee,
  Padding,
  Row,
  Text,
  Image,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import {
  buildCycle,
  marqueeFrames,
  planCycle,
  syncCycles,
  textWidthPx,
  textWidthTb8,
  transitionCost,
  type CyclePlan,
} from "./animation";
import { formatAirport, formatDuration, formatNumber, pad } from "./format";
import type { AnimConfig, FlightData } from "./types";

const BOTTOM_H = 22; // fixed height for the bottom animation region
const AIRCRAFT_H = 10; // fixed height for the aircraft model/reg line
const SUB_FONT = "Dina_r400-6";

/** A built subscreen plus its intrinsic frame count. */
export interface Screen {
  widget: WidgetSpec;
  frames: number;
}

interface TextLine {
  content: string;
  color: string;
}

/** Marquee that scrolls the text fully out to the left (offsetEnd = width). */
function scrollOutLine(line: TextLine, width: number, delay: number): WidgetSpec {
  return Marquee({
    width,
    offsetEnd: width,
    delay,
    child: Text({ content: line.content, color: line.color, font: SUB_FONT }),
  });
}

function scrollOutFrames(line: TextLine, width: number, delay: number): number {
  return marqueeFrames({ cw: textWidthPx(line.content), size: width, offsetEnd: width, delay });
}

export function buildTimingScreen(
  flight: FlightData,
  nowUnix: number,
  width: number,
  transCost: number,
): Screen | null {
  const texts: TextLine[] = [];
  if (flight.depTime) {
    const elapsed = nowUnix - flight.depTime;
    if (flight.delaySeconds) {
      texts.push({ content: `Delayed by ${formatDuration(flight.delaySeconds)}`, color: "#f80" });
    } else if (elapsed > 0) {
      texts.push({ content: `Departed ${formatDuration(elapsed)} ago`, color: "#aaa" });
    } else {
      texts.push({ content: `Departing in ${formatDuration(-elapsed)}`, color: "#aaa" });
    }
  }
  if (flight.arrTime) {
    const remaining = flight.arrTime - nowUnix;
    if (remaining > 0) {
      texts.push({ content: `Arriving in ${formatDuration(remaining)}`, color: "#aaa" });
    } else {
      texts.push({ content: `Arrived ${formatDuration(-remaining)} ago`, color: "#aaa" });
    }
  }
  if (texts.length === 0) return null;

  const lines = texts.map((t) => scrollOutLine(t, width, transCost));
  const frames = Math.max(...texts.map((t) => scrollOutFrames(t, width, transCost)));

  // Progress bar: dep_time → arr_time.
  let progressBar: WidgetSpec | null = null;
  const dep = flight.depTime;
  const arr = flight.arrTime;
  if (dep && arr && arr > dep) {
    const total = arr - dep;
    const elapsedS = nowUnix - dep;
    const frac = Math.max(0.0, Math.min(1.0, elapsedS / total));
    const filled = Math.max(1, Math.trunc(width * frac));
    const barColor = flight.delaySeconds ? "#f80" : "#1DB954";
    progressBar = Padding({
      pad: pad(0, 1, 0, 0),
      child: Row({
        children: [
          Box({ width: filled - 2, height: 1, color: barColor }),
          Box({ width: width - filled - 2, height: 1, color: "#333" }),
        ],
      }),
    });
  }

  const children: WidgetSpec[] = [...lines];
  if (progressBar) children.push(progressBar);
  return {
    widget: Box({
      width,
      height: BOTTOM_H,
      child: Column({ mainAlign: "start", crossAlign: "start", expanded: true, children }),
    }),
    frames,
  };
}

export function buildTelemetryScreen(
  flight: FlightData,
  width: number,
): Screen | null {
  if (flight.onGround || !flight.speed) return null;
  const lines: WidgetSpec[] = [];
  if (flight.speed || flight.distance) {
    let left = "";
    let right = "";
    if (flight.speed) {
      left = `${formatNumber(flight.speed)} ${flight.speedUnit || "kn"}`;
    }
    if (flight.distance) {
      const bearing = flight.cardinal || "";
      right = bearing ? `${flight.distance} ${bearing}` : flight.distance;
    }
    if (left && right) {
      lines.push(Row({
        mainAlign: "space_between",
        expanded: true,
        children: [
          Text({ content: left, color: "#aaa", font: "tb-8" }),
          Text({ content: right, color: "#666", font: "tb-8" }),
        ],
      }));
    } else {
      lines.push(Text({ content: left || right, color: "#aaa", font: "tb-8" }));
    }
  }
  if (flight.altitude || flight.verticalSpeed != null) {
    let left = "";
    let right = "";
    if (flight.altitude) {
      left = `${formatNumber(flight.altitude)} ${flight.altUnit || "ft"}`;
    }
    if (flight.verticalSpeed != null) {
      const vs = Math.trunc(flight.verticalSpeed);
      const prefix = vs > 0 ? "+" : "";
      right = `${prefix}${formatNumber(vs)} ${flight.vspeedUnit || "ft/min"}`;
    }
    if (left && right) {
      lines.push(Row({
        mainAlign: "space_between",
        expanded: true,
        children: [
          Text({ content: left, color: "#aaa", font: "tb-8" }),
          Text({ content: right, color: "#666", font: "tb-8" }),
        ],
      }));
    } else {
      lines.push(Text({ content: left || right, color: "#aaa", font: "tb-8" }));
    }
  }
  if (lines.length === 0) return null;
  return {
    widget: Box({
      width: width - 1,
      height: BOTTOM_H,
      child: Column({ mainAlign: "end", crossAlign: "start", expanded: true, children: lines }),
    }),
    frames: 1, // static text only
  };
}

export function buildStatusScreen(
  flight: FlightData,
  width: number,
  transCost: number,
): Screen | null {
  const label = flight.phaseLabel;
  if (!label) return null;
  const line: TextLine = { content: label, color: "#aaa" };
  return {
    widget: Box({
      width,
      height: BOTTOM_H,
      child: Column({
        mainAlign: "end",
        crossAlign: "start",
        expanded: true,
        children: [scrollOutLine(line, width, transCost)],
      }),
    }),
    frames: scrollOutFrames(line, width, transCost),
  };
}

export function buildAirportsScreen(
  flight: FlightData,
  width: number,
  transCost: number,
): Screen | null {
  const delay = Math.max(10, transCost);
  const endDelay = 10;
  const texts: string[] = [];
  if (flight.originName) texts.push(formatAirport(flight.originName));
  if (flight.destName) texts.push(formatAirport(flight.destName));
  if (texts.length === 0) return null;

  const lines = texts.map((content) =>
    Marquee({
      width,
      child: Text({ content, color: "#aaa", font: "tb-8" }),
      loop: true,
      endDelay,
      delay,
    }),
  );
  const frames = Math.max(
    ...texts.map((content) =>
      marqueeFrames({ cw: textWidthTb8(content), size: width, delay, endDelay, loop: true }),
    ),
  );
  return {
    widget: Box({
      width,
      height: BOTTOM_H,
      child: Column({ mainAlign: "end", crossAlign: "start", expanded: true, children: lines }),
    }),
    frames,
  };
}

/** One line of the aircraft model / registration switcher. */
function buildAircraftLine(content: string, width: number, transCost: number): Screen {
  return {
    widget: Marquee({
      width,
      delay: transCost,
      child: Text({ content, color: "#aaa", font: SUB_FONT }),
    }),
    // offsetStart == offsetEnd == 0: scrolls out and back in, ends at the
    // start position (loop-safe).
    frames: marqueeFrames({ cw: textWidthPx(content), size: width, delay: transCost }),
  };
}

export function renderFlight(
  flight: FlightData,
  width: number,
  height: number,
  animConfig: AnimConfig,
): [WidgetSpec, number] {
  void height; // unused in the original layout; kept for signature parity.
  const logoSize = 30;
  let logoWidth = logoSize;
  const nowUnix = time.now().unix;
  const callsignColor = animConfig.callsignColor || "#0af";

  let logoWidget: WidgetSpec | null;
  if (flight.logo) {
    logoWidget = Image({ src: flight.logo, width: logoSize, height: logoSize });
  } else {
    logoWidget = null;
    logoWidth = 0;
  }

  const style = animConfig.style || "slide_up";
  const hold = animConfig.holdFrames || 30;
  const transition = animConfig.transitionFrames || 10;
  const transCost = transitionCost(style, transition);

  // Build bottom subscreens.
  const subscreens: Screen[] = [];
  if (animConfig.showTiming) {
    const s = buildTimingScreen(flight, nowUnix, width, transCost);
    if (s) subscreens.push(s);
  }
  if (animConfig.showTelemetry) {
    const s = buildTelemetryScreen(flight, width);
    if (s) subscreens.push(s);
  }
  if (animConfig.showAirports) {
    const s = buildAirportsScreen(flight, width, transCost);
    if (s) subscreens.push(s);
  }
  if (animConfig.showStatus) {
    const s = buildStatusScreen(flight, width, transCost);
    if (s) subscreens.push(s);
  }

  // Cycling aircraft info line (model / registration) — uses the same
  // transition style, duration and hold as the bottom subscreens.
  const aircraftWidth = width - logoWidth - 2;
  const aircraftScreens: Screen[] = [];
  if (flight.aircraftModel) {
    aircraftScreens.push(buildAircraftLine(flight.aircraftModel, aircraftWidth, transCost));
  }
  if (flight.aircraftReg) {
    aircraftScreens.push(buildAircraftLine(flight.aircraftReg, aircraftWidth, transCost));
  }

  // The carrier marquee loops once and then freezes at its start position
  // (renderer paintLoop), so it is loop-safe as long as the total duration
  // covers one full scroll.
  const carrierFrames = marqueeFrames({
    cw: textWidthPx(flight.carrier),
    size: width - logoWidth,
    loop: true,
  });

  // One-shot blocks (not cycling) must also fit inside the total duration:
  // they end in a frame identical to their frame 0.
  let minFrames = carrierFrames;
  if (subscreens.length === 1) minFrames = Math.max(minFrames, subscreens[0].frames);
  if (aircraftScreens.length === 1) minFrames = Math.max(minFrames, aircraftScreens[0].frames);

  // Exact cycle planning: holds absorb marquee scroll lengths, then both
  // cycles are padded to be commensurate and the total is a multiple of each.
  const plans: CyclePlan[] = [];
  let subPlan: CyclePlan | null = null;
  let aircraftPlan: CyclePlan | null = null;
  if (subscreens.length > 1) {
    subPlan = planCycle(subscreens.map((s) => s.frames), hold, transCost);
    plans.push(subPlan);
  }
  if (aircraftScreens.length > 1) {
    aircraftPlan = planCycle(aircraftScreens.map((s) => s.frames), hold, transCost);
    plans.push(aircraftPlan);
  }
  const totalDuration = plans.length > 0 ? syncCycles(plans, minFrames) : 0;

  // Build aircraft widget.
  let aircraftWidget: WidgetSpec;
  if (aircraftPlan) {
    aircraftWidget = buildCycle(
      aircraftScreens.map((s) => s.widget),
      style,
      aircraftPlan,
      transition,
      aircraftWidth,
      AIRCRAFT_H,
      totalDuration,
    );
    aircraftWidget = Box({ height: AIRCRAFT_H, child: aircraftWidget });
  } else if (aircraftScreens.length) {
    aircraftWidget = aircraftScreens[0].widget;
  } else {
    aircraftWidget = Box({ height: AIRCRAFT_H });
  }

  const top = Box({
    width,
    height: logoSize + 1,
    child: Row({
      crossAlign: "center",
      mainAlign: "start",
      children: [
        logoWidget,
        Padding({
          pad: pad(1, 0, 0, 0),
          child: Column({
            mainAlign: "start",
            children: [
              Marquee({ width: width - logoWidth, child: Text({ content: flight.carrier, color: callsignColor, font: "6x10" }), loop: true }),
              Text({ content: flight.route, font: "Dina_r400-6" }),
              aircraftWidget,
            ],
          }),
        }),
      ],
    }),
  });

  let delay = 0;
  let bottom: WidgetSpec | null = null;

  if (subscreens.length === 1) {
    bottom = subscreens[0].widget;
  } else if (subPlan) {
    delay = 100;
    bottom = buildCycle(
      subscreens.map((s) => s.widget),
      style,
      subPlan,
      transition,
      width,
      BOTTOM_H,
      totalDuration,
    );
    // Clip the animation to a fixed size so slide/crossfade overflow is hidden
    // and PaintBounds stays constant across frames.
    bottom = Box({ width, height: BOTTOM_H, child: bottom });
  }

  if (bottom) {
    return [
      Column({ expanded: true, mainAlign: "space_between", children: [top, bottom] }),
      delay,
    ];
  }

  return [top, 0];
}

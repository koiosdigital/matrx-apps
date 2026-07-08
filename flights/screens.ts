/**
 * Subscreen builders + the main flight layout, ported from the Starlark
 * `#MARK: Subscreen builders` and `#MARK: Rendering` sections.
 *
 * Every subscreen returns a Box of exactly (width x BOTTOM_H) with an expanded
 * Column inside so content sits at the bottom; each text line is wrapped in a
 * Marquee(width) so a narrow Column isn't centered horizontally by the Box.
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

import { cycleCrossfade, cycleFrames, cycleSlide, syncDuration } from "./animation";
import { formatAirport, formatDuration, formatNumber, pad } from "./format";
import type { AnimConfig, FlightData } from "./types";

const BOTTOM_H = 22; // fixed height for the bottom animation region

export function buildTimingScreen(
  flight: FlightData,
  nowUnix: number,
  width: number,
): WidgetSpec | null {
  const lines: WidgetSpec[] = [];
  if (flight.depTime) {
    const elapsed = nowUnix - flight.depTime;
    if (flight.delaySeconds) {
      lines.push(Marquee({ width, offsetEnd: width, child: Text({ content: `Delayed by ${formatDuration(flight.delaySeconds)}`, color: "#f80", font: "Dina_r400-6" }) }));
    } else if (elapsed > 0) {
      lines.push(Marquee({ width, offsetEnd: width, child: Text({ content: `Departed ${formatDuration(elapsed)} ago`, color: "#aaa", font: "Dina_r400-6" }) }));
    } else {
      lines.push(Marquee({ width, offsetEnd: width, child: Text({ content: `Departing in ${formatDuration(-elapsed)}`, color: "#aaa", font: "Dina_r400-6" }) }));
    }
  }
  if (flight.arrTime) {
    const remaining = flight.arrTime - nowUnix;
    if (remaining > 0) {
      lines.push(Marquee({ width, offsetEnd: width, child: Text({ content: `Arriving in ${formatDuration(remaining)}`, color: "#aaa", font: "Dina_r400-6" }) }));
    } else {
      lines.push(Marquee({ width, offsetEnd: width, child: Text({ content: `Arrived ${formatDuration(-remaining)} ago`, color: "#aaa", font: "Dina_r400-6" }) }));
    }
  }
  if (lines.length === 0) return null;

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
  return Box({
    width,
    height: BOTTOM_H,
    child: Column({ mainAlign: "start", crossAlign: "start", expanded: true, children }),
  });
}

export function buildTelemetryScreen(
  flight: FlightData,
  width: number,
): WidgetSpec | null {
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
  return Box({
    width: width - 1,
    height: BOTTOM_H,
    child: Column({ mainAlign: "end", crossAlign: "start", expanded: true, children: lines }),
  });
}

export function buildStatusScreen(
  flight: FlightData,
  width: number,
): WidgetSpec | null {
  const label = flight.phaseLabel;
  if (!label) return null;
  return Box({
    width,
    height: BOTTOM_H,
    child: Column({
      mainAlign: "end",
      crossAlign: "start",
      expanded: true,
      children: [Marquee({ width, offsetEnd: width, child: Text({ content: label, color: "#aaa", font: "Dina_r400-6" }) })],
    }),
  });
}

export function buildAirportsScreen(
  flight: FlightData,
  width: number,
): WidgetSpec | null {
  const lines: WidgetSpec[] = [];
  if (flight.originName) {
    lines.push(Marquee({ width, child: Text({ content: formatAirport(flight.originName), color: "#aaa", font: "Dina_r400-6" }), loop: true, endDelay: 10, delay: 10 }));
  }
  if (flight.destName) {
    lines.push(Marquee({ width, child: Text({ content: formatAirport(flight.destName), color: "#aaa", font: "Dina_r400-6" }), loop: true, endDelay: 10, delay: 10 }));
  }
  if (lines.length === 0) return null;
  return Box({
    width,
    height: BOTTOM_H,
    child: Column({ mainAlign: "end", crossAlign: "start", expanded: true, children: lines }),
  });
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

  // Build bottom subscreens first so we know the total duration.
  const subscreens: WidgetSpec[] = [];
  if (animConfig.showTiming) {
    const w = buildTimingScreen(flight, nowUnix, width);
    if (w) subscreens.push(w);
  }
  if (animConfig.showTelemetry) {
    const w = buildTelemetryScreen(flight, width);
    if (w) subscreens.push(w);
  }
  if (animConfig.showAirports) {
    const w = buildAirportsScreen(flight, width);
    if (w) subscreens.push(w);
  }
  if (animConfig.showStatus) {
    const w = buildStatusScreen(flight, width);
    if (w) subscreens.push(w);
  }

  // Build cycling aircraft info line (model / registration).
  const aircraftScreens: WidgetSpec[] = [];
  if (flight.aircraftModel) {
    aircraftScreens.push(Marquee({ width: width - logoWidth - 2, child: Text({ content: flight.aircraftModel, color: "#aaa", font: "Dina_r400-6" }) }));
  }
  if (flight.aircraftReg) {
    aircraftScreens.push(Marquee({ width: width - logoWidth - 2, child: Text({ content: flight.aircraftReg, color: "#aaa", font: "Dina_r400-6" }) }));
  }

  // Compute synced duration across all cycling blocks.
  const style = animConfig.style || "slide_up";
  const hold = animConfig.holdFrames || 30;
  const transition = animConfig.transitionFrames || 10;
  const aircraftFade = 5;

  const cycleEstimates: number[] = [];
  if (subscreens.length > 1) cycleEstimates.push(cycleFrames(subscreens.length, hold, transition, style));
  if (aircraftScreens.length > 1) cycleEstimates.push(cycleFrames(aircraftScreens.length, hold, aircraftFade, "crossfade"));

  const targetDuration = syncDuration(cycleEstimates);

  // Build aircraft widget with synced duration.
  let aircraftWidget: WidgetSpec;
  if (aircraftScreens.length > 1) {
    aircraftWidget = cycleCrossfade(aircraftScreens, { holdFrames: hold, fadeFrames: aircraftFade, bgColor: "#000", duration: targetDuration });
    aircraftWidget = Box({ height: 10, child: aircraftWidget });
  } else if (aircraftScreens.length) {
    aircraftWidget = aircraftScreens[0];
  } else {
    aircraftWidget = Box({ height: 10 });
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
    bottom = subscreens[0];
  } else if (subscreens.length > 1) {
    delay = 100;

    if (style === "crossfade") {
      bottom = cycleCrossfade(subscreens, { holdFrames: hold, fadeFrames: transition, bgColor: "#000", duration: targetDuration });
    } else if (style === "slide_up" || style === "slide_down") {
      const direction = style === "slide_up" ? "up" : "down";
      bottom = cycleSlide(subscreens, { holdFrames: hold, slideFrames: transition, direction, width, height: BOTTOM_H, duration: targetDuration });
    } else {
      bottom = cycleCrossfade(subscreens, { holdFrames: hold, fadeFrames: 0, bgColor: "#000", duration: targetDuration });
    }

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

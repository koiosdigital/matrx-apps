/**
 * Binary Clock — hand port of `binaryclock/binary_clock.star` (by LukiLeu),
 * kept structurally line-for-line: six 11-bit columns (Y/M/D/H/M/S)
 * animated one second per frame for 30 seconds.
 *
 * Screen sizes: the column stack was designed for a 32px-tall panel; the
 * bar/label boxes stretch to the actual canvas height, so taller panels
 * space the bits out instead of leaving a letterboxed strip.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Root,
  Row,
  Text,
  schema,
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time, type Time } from "@koiosdigital/matrx-sdk/stdlib";

const DEFAULT_TIMEZONE = "Europe/Zurich";
const BITS = 11; // log2(2048)

const DEFAULT_COLORS = {
  white: "#fff",
  white20: "#222",
  red: "#f00",
};

interface Style {
  colorText: string;
  colorDots: string;
  colorDotsBg: string;
  widthBar: number;
  heightBar: number;
  showText: boolean;
  screenH: number;
}

/** One 11-bit column of boxes, least significant bit at the bottom. */
function renderBar(value: number, s: Style): WidgetSpec {
  const children: WidgetSpec[] = [];
  for (let bit = 0; bit < BITS; bit++) {
    children.push(
      Box({
        width: s.widthBar,
        height: s.heightBar,
        color: value % 2 === 1 ? s.colorDots : s.colorDotsBg,
      }),
    );
    value = Math.floor(value / 2);
  }
  children.reverse();
  return Column({ children });
}

function renderCol(value: number, text: string, s: Style): WidgetSpec {
  const boxW = s.widthBar <= 5 ? 5 : s.widthBar;
  if (s.showText && s.heightBar <= 2) {
    const textH = s.heightBar === 1 ? 8 : 7;
    return Column({
      children: [
        Box({ height: s.screenH - textH - 4, width: boxW, child: renderBar(value, s) }),
        Box({
          height: textH,
          width: s.widthBar <= 5 ? 6 : s.widthBar,
          child: Text({ font: "tb-8", content: text, color: s.colorText }),
        }),
        Box({ height: 4, width: boxW }),
      ],
    });
  }
  return Column({
    children: [Box({ height: s.screenH, width: boxW, child: renderBar(value, s) })],
  });
}

function renderImage(t: Time, s: Style): WidgetSpec {
  return Row({
    expanded: s.widthBar <= 9,
    mainAlign: s.widthBar <= 7 ? "space_evenly" : "space_between",
    children: [
      renderCol(t.year, "Y", s),
      renderCol(t.month, "M", s),
      renderCol(t.day, "D", s),
      renderCol(t.hour, "H", s),
      renderCol(t.minute, "M", s),
      renderCol(t.second, "S", s),
    ],
  });
}

export default function render(config: Config): RootSpec {
  const locationRaw = config.get("location");
  let timezone = config.get("$tz", DEFAULT_TIMEZONE)!;
  if (locationRaw) {
    try {
      const loc = JSON.parse(locationRaw) as { timezone?: string };
      timezone = loc.timezone ?? timezone;
    } catch {
      // keep fallback timezone
    }
  }

  const style: Style = {
    colorText: config.get("color_text", DEFAULT_COLORS.white)!,
    colorDots: config.get("color_dots", DEFAULT_COLORS.red)!,
    colorDotsBg: config.get("color_dots_bg", DEFAULT_COLORS.white20)!,
    widthBar: parseInt(config.get("width_bar", "3")!, 10),
    heightBar: parseInt(config.get("heigth_bar", "1")!, 10),
    showText: config.bool("show_text", true),
    screenH: config.height(),
  };

  // Whole-second baseline (the original round-tripped through a format).
  let current = time.fromUnix(time.now().inLocation(timezone).unix).inLocation(timezone);

  const frames: WidgetSpec[] = [];
  for (let i = 0; i < 30; i++) {
    frames.push(renderImage(current, style));
    current = current.add(time.parseDuration("1s"));
  }

  return Root({
    delay: 1000,
    maxAge: 120,
    child: Box({ child: Animation({ children: frames }) }),
  });
}

export function getSchema(): Schema {
  const opt = (display: string, value: string): SchemaOption => schema.option({ display, value });
  const widthOptions = Array.from({ length: 10 }, (_, i) => opt(`${i + 1} Pixel`, String(i + 1)));
  const heightOptions = Array.from({ length: 3 }, (_, i) => opt(`${i + 1} Pixel`, String(i + 1)));

  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Location defining the timezone.",
        icon: "locationDot",
      }),
      schema.color({
        id: "color_text",
        name: "Color Text",
        icon: "brush",
        desc: "Color of the text",
        default: DEFAULT_COLORS.white,
      }),
      schema.color({
        id: "color_dots",
        name: "Color Active Dots",
        icon: "brush",
        desc: "Color of the active dots",
        default: DEFAULT_COLORS.red,
      }),
      schema.color({
        id: "color_dots_bg",
        name: "Color Inactive Dots",
        icon: "brush",
        desc: "Color of the inactive dots",
        default: DEFAULT_COLORS.white20,
      }),
      schema.dropdown({
        id: "width_bar",
        name: "Width Bar",
        icon: "textWidth",
        desc: "Width of the individual bars",
        options: widthOptions,
        default: "3",
      }),
      schema.dropdown({
        id: "heigth_bar",
        name: "Height Bar",
        icon: "textHeight",
        desc: "Height of the individual bars",
        options: heightOptions,
        default: "1",
      }),
      schema.toggle({
        id: "show_text",
        name: "Show Text",
        desc: "Show the text labels below the bars.",
        icon: "textSlash",
        default: true,
      }),
    ],
  });
}

/**
 * Starfield — hand port of `starfield/starfield.star` (by gabe565), kept
 * structurally line-for-line: same polar star model, acceleration, alpha
 * fade by radius, palettes and custom-color validation.
 *
 * Screen sizes: the center and maximum radius derive from the canvas, and
 * the configured star count scales with screen area so density matches the
 * original 64x32 look.
 *
 * `Math.random()` is deterministic inside the isolate, matching the
 * original's `random.seed(now // 30)` windowing.
 */

import {
  Animation,
  Box,
  Config,
  Padding,
  Root,
  Stack,
  WrappedText,
  schema,
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

const DELAY = 50;
const FRAMES = 300;
const MIN_RADIUS = 4;

const RAINBOW_COLORS: Record<string, string> = {
  red: "#F44",
  orange: "#FFA500",
  yellow: "#FF0",
  green: "#0F0",
  blue: "#77F",
  indigo: "#8F00F8",
  violet: "#EE82EE",
};
const STAR_COLOR_RANDOM = "random";
const DEFAULT_BACKGROUND = "#000013";
const DEFAULT_STAR_COLOR = "#FFF";
const DEFAULT_STAR_COUNT = "25";
const DEFAULT_TAIL_LENGTH = "1.5";
const DEFAULT_SPEED = "1";

interface Star {
  angle: number;
  radius: number;
  speed: number;
  color: string;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Random angle 0..2π in half-degree steps (original granularity). */
function randomAngle(): number {
  return (randInt(0, 359 * 2) / 2) * (Math.PI / 180);
}

function randomPaletteColor(palette: string[]): string {
  return palette[randInt(0, palette.length - 1)];
}

function validColor(color: string): boolean {
  return /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})$/.test(color);
}

/** Normalize to #RRGGBB so an alpha byte can be appended. */
function sanitizeColor(color: string): string {
  if (color.length === 5) color = color.slice(0, -1); // #FFFF → #FFF
  if (color.length === 4) {
    return "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }
  return color.slice(0, 7); // strip alpha from #RRGGBBAA
}

function getPalette(config: Config): string[] | null {
  let palette: string | string[];
  if (config.bool("use_custom_star_colors", false)) {
    palette = config.get("custom_star_colors", "")!;
  } else {
    palette = config.get("star_color", DEFAULT_STAR_COLOR)!;
    if (palette === STAR_COLOR_RANDOM) {
      palette = [randomPaletteColor(Object.values(RAINBOW_COLORS))];
    }
  }

  if (typeof palette === "string") {
    const parts = palette.split(",").map((c) => c.trim());
    for (const part of parts) {
      if (!validColor(part)) return null;
    }
    palette = parts;
  }

  return palette.map(sanitizeColor);
}

export default function render(config: Config): RootSpec {
  const width = config.width();
  const height = config.height();
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY) + 3;

  const palette = getPalette(config);
  if (palette === null) {
    return Root({ child: WrappedText({ content: "Invalid star color", width }) });
  }

  const speedMultiplier = parseFloat(config.get("star_speed", DEFAULT_SPEED)!);
  const randomSpeed = (): number => (randInt(1, 8) / 4) * speedMultiplier;

  // Configured count is tuned for 64x32; scale with screen area.
  const baseCount = parseInt(config.get("star_count", DEFAULT_STAR_COUNT)!, 10);
  const count = Math.round(baseCount * ((width * height) / (64 * 32)));

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      angle: randomAngle(),
      radius: randInt(MIN_RADIUS, Math.floor(maxRadius)),
      speed: randomSpeed(),
      color: randomPaletteColor(palette),
    });
  }

  const streakLength = parseFloat(config.get("star_tail_length", DEFAULT_TAIL_LENGTH)!);

  const getStarXY = (radius: number, angle: number): [number, number, boolean] => {
    const x = Math.floor(Math.sin(angle) * radius + centerX);
    const y = Math.floor(Math.cos(angle) * radius + centerY);
    return [x, y, x >= 0 && x < width && y >= 0 && y < height];
  };

  const getAlpha = (radius: number): string => {
    const alpha = Math.min(255, Math.floor((radius * 255) / maxRadius));
    return alpha.toString(16).toUpperCase().padStart(2, "0");
  };

  const renderPixel = (x: number, y: number, color: string): WidgetSpec =>
    Padding({
      pad: { left: x, top: y, right: 0, bottom: 0 },
      child: Box({ color, width: 1, height: 1 }),
    });

  const frames: WidgetSpec[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const children: WidgetSpec[] = [];
    for (const star of stars) {
      star.speed += 0.1;
      star.radius += star.speed;

      const radius = star.radius;
      let [x, y, ok] = getStarXY(radius, star.angle);
      if (ok) {
        children.push(renderPixel(x, y, star.color + getAlpha(radius)));
      }

      // Render trail.
      for (let i = 0; i < Math.floor(star.speed * streakLength); i++) {
        const tailRadius = radius - i;
        if (tailRadius < MIN_RADIUS) break;
        [x, y, ok] = getStarXY(tailRadius, star.angle);
        if (ok) {
          children.push(renderPixel(x, y, star.color + getAlpha(radius)));
        }
      }

      // Reset when star and trail is out of bounds.
      if (!ok) {
        star.angle = randomAngle();
        star.radius = MIN_RADIUS;
        star.speed = randomSpeed();
      }
    }
    frames.push(Stack({ children }));
  }

  return Root({
    delay: DELAY,
    child: Stack({
      children: [
        Box({ color: config.get("background_color", DEFAULT_BACKGROUND) }),
        Animation({ children: frames }),
      ],
    }),
  });
}

export function getSchema(): Schema {
  const opt = (display: string, value: string): SchemaOption => schema.option({ display, value });

  const backgroundColors = [opt("Dark Blue", "#000013"), opt("Black", "#000")];
  const starColors = [
    opt("White", "#FFF"),
    opt("Red", RAINBOW_COLORS.red),
    opt("Orange", RAINBOW_COLORS.orange),
    opt("Yellow", RAINBOW_COLORS.yellow),
    opt("Green", RAINBOW_COLORS.green),
    opt("Blue", RAINBOW_COLORS.blue),
    opt("Indigo", RAINBOW_COLORS.indigo),
    opt("Violet", RAINBOW_COLORS.violet),
    opt("Random", STAR_COLOR_RANDOM),
    opt("Rainbow", Object.values(RAINBOW_COLORS).join(",")),
    opt("Christmas", `${RAINBOW_COLORS.red},${RAINBOW_COLORS.green}`),
    opt("Halloween", `${RAINBOW_COLORS.orange},${RAINBOW_COLORS.orange},${RAINBOW_COLORS.indigo}`),
    opt("Fall", `${RAINBOW_COLORS.red},${RAINBOW_COLORS.orange},${RAINBOW_COLORS.yellow}`),
  ];
  const starCounts = [opt("10", "10"), opt("25 (Default)", "25"), opt("40", "40"), opt("50", "50"), opt("60", "60")];
  const tailLengths = [opt("Disabled", "0"), opt("Shorter", "1"), opt("Regular", "1.5"), opt("Longer", "2")];
  const speeds = [opt("Slowest", "0.2"), opt("Slower", "0.5"), opt("Regular", "1"), opt("Faster", "1.3"), opt("Fastest", "2")];

  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "background_color",
        name: "Background Color",
        desc: "Change the background color",
        icon: "palette",
        default: backgroundColors[0].value,
        options: backgroundColors,
      }),
      schema.dropdown({
        id: "star_color",
        name: "Star Colors",
        desc: "Change the star palette",
        icon: "palette",
        default: starColors[0].value,
        options: starColors,
      }),
      schema.toggle({
        id: "use_custom_star_colors",
        name: "Use Custom Star Colors?",
        desc: "Enables custom star palette",
        icon: "palette",
        default: false,
      }),
      schema.text({
        id: "custom_star_colors",
        name: "Custom Star Colors",
        desc: "Comma-separated list of hex codes for stars",
        icon: "palette",
        default: "",
      }),
      schema.dropdown({
        id: "star_count",
        name: "Number of Stars",
        desc: "Change the number of stars",
        icon: "hashtag",
        default: DEFAULT_STAR_COUNT,
        options: starCounts,
      }),
      schema.dropdown({
        id: "star_speed",
        name: "Star Speed",
        desc: "Changes the star speed",
        icon: "personRunning",
        default: DEFAULT_SPEED,
        options: speeds,
      }),
      schema.dropdown({
        id: "star_tail_length",
        name: "Star Tail Length",
        desc: "Changes the star tail length",
        icon: "ruler",
        default: DEFAULT_TAIL_LENGTH,
        options: tailLengths,
      }),
    ],
  });
}

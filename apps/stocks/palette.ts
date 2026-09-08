/**
 * Colours. Direction is carried by a glyph as well as a hue (see
 * `formatChangePct`), so these stay legible to a viewer who can't separate
 * the two — the hue is reinforcement, not the only channel.
 *
 * `up_color` flips gain/loss for the red-up convention used in Japan,
 * Korea and China; green-up is a Western default, not a universal one.
 */

export interface Palette {
  gain: string;
  loss: string;
  gainFill: string;
  lossFill: string;
  ink: string;
  ink2: string;
  ink3: string;
  ground: string;
  accent: string;
}

const GREEN = "#3DE0A0";
const RED = "#FF6E7E";

export function palette(redUp: boolean, muted: boolean): Palette {
  const up = redUp ? RED : GREEN;
  const down = redUp ? GREEN : RED;
  if (muted) {
    // Closed / stale: same layout, drained of signal so a frozen panel
    // never reads as a live one.
    return {
      gain: "#5A7A6C",
      loss: "#7A5A60",
      gainFill: "#5A7A6C33",
      lossFill: "#7A5A6033",
      ink: "#96A29C",
      ink2: "#6B7772",
      ink3: "#49534E",
      ground: "#040605",
      accent: "#8A7346",
    };
  }
  return {
    gain: up,
    loss: down,
    gainFill: up + "38",
    lossFill: down + "38",
    ink: "#ECF4F0",
    ink2: "#8A9A93",
    ink3: "#4A5A55",
    ground: "#040605",
    accent: "#E0AE5C",
  };
}

/** Number and label formatting, sized for a 64px-wide panel. */

/**
 * Price with a digit budget rather than a fixed precision — 227.52 and
 * 63142 both have to fit the same slot, so precision gives way as the
 * integer part grows.
 */
export function formatPrice(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000) return String(Math.round(v));
  if (a >= 10000) return v.toFixed(0);
  if (a >= 1000) return v.toFixed(1);
  return v.toFixed(2);
}

/** Percent change with its sign as a glyph as well as a colour (tb-8 has
 *  the triangles; tom-thumb does not, so this string is tb-8 only). */
export function formatChangePct(pct: number): string {
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow}${Math.abs(pct).toFixed(2)}%`;
}

/** Compact signed change for narrow slots, no glyph. */
export function formatChangeAbs(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return sign + formatPrice(Math.abs(v));
}

/** "18M" / "2H" / "3D" — how far behind the last good quote is. */
export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}M`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}H`;
  return `${Math.round(seconds / 86400)}D`;
}

/** Ease-out cubic — the odometer decelerates into the real price. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Two-hex-digit alpha suffix for a #RRGGBB colour. */
export function alpha(hex: string, a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  const digits = "0123456789ABCDEF";
  return hex + digits[Math.floor(v / 16)] + digits[v % 16];
}

/** Uppercased ticker, trimmed to what the header slot can hold. */
export function normaliseSymbol(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 8);
}

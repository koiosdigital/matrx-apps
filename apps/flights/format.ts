/**
 * Formatting + layout helpers, ported 1:1 from the Starlark original.
 * `formatNumber` is kept bug-for-bug faithful (the char-grouping loop puts a
 * comma after a leading minus for negative inputs, just like the original).
 */

import type { Insets } from "@koiosdigital/matrx-sdk";

/** Pixlet pad tuple (left, top, right, bottom). */
export function pad(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Insets {
  return { left, top, right, bottom };
}

export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = -seconds;
  seconds = Math.trunc(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 3) return `${hours} hrs`;
  if (hours > 0) {
    if (minutes < 10) return `${hours}:0${minutes}`;
    return `${hours}:${minutes}`;
  }
  return `${minutes} min`;
}

export function formatNumber(n: number): string {
  const s = String(Math.trunc(n));
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) result += ",";
    result += s[i];
  }
  return result;
}

export function formatAirport(airport: string): string {
  if (airport) {
    airport = airport.replaceAll("International Airport", "Int'l");
    airport = airport.replaceAll("International", "Int'l");
  }
  return airport;
}

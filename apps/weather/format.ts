/** Units, labels and the small amount of arithmetic the panels need. */

export type Units = "auto" | "f" | "c";

/** Countries that actually use Fahrenheit for weather. */
const F_COUNTRIES = ["US", "BS", "KY", "LR", "PW", "FM", "MH"];

export function resolveUnits(units: Units, country: string): "f" | "c" {
  if (units === "f" || units === "c") return units;
  return F_COUNTRIES.includes(country.toUpperCase()) ? "f" : "c";
}

export function toDisplay(celsius: number, unit: "f" | "c"): number {
  return unit === "f" ? (celsius * 9) / 5 + 32 : celsius;
}

export function tempString(celsius: number, unit: "f" | "c"): string {
  return String(Math.round(toDisplay(celsius, unit)));
}

/** km/h in, mph out when the panel is in Fahrenheit. */
export function windString(kph: number, unit: "f" | "c"): string {
  const v = unit === "f" ? kph * 0.621371 : kph;
  return `${Math.round(v)}${unit === "f" ? "MPH" : "KPH"}`;
}

/** "6:41" in the location's own timezone. */
export function clockString(unixSec: number, tzOffsetMin: number): string {
  if (!unixSec) return "--:--";
  const local = unixSec + tzOffsetMin * 60;
  const mins = Math.floor(local / 60) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? "0" : ""}${m}`;
}

export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}M`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}H`;
  return `${Math.round(seconds / 86400)}D`;
}

/** Short label for each scene, sized to fit a 64px panel. */
export const SCENE_LABEL: Record<string, string> = {
  clear: "CLEAR",
  partly: "PARTLY CLOUDY",
  cloudy: "CLOUDY",
  fog: "FOG",
  rain: "RAIN",
  snow: "SNOW",
  sleet: "SLEET",
  thunder: "STORMS",
  wind: "WINDY",
};

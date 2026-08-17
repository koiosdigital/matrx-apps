/** The slice of WeatherKit this app renders, flattened. */

/** The nine scenes every WeatherKit conditionCode collapses into. */
export type Scene =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "rain"
  | "snow"
  | "sleet"
  | "thunder"
  | "wind";

export interface Conditions {
  scene: Scene;
  /** WeatherKit's own daylight flag for the observation. */
  daylight: boolean;
  tempC: number;
  feelsC: number;
  highC: number;
  lowC: number;
  /** 0..1 */
  precipChance: number;
  windKph: number;
  /** Unix seconds; used for the sky ramp and the TODAY panel. */
  sunriseSec: number;
  sunsetSec: number;
  /** Next twelve hourly temperatures in C, starting with the current hour. */
  hourlyC: number[];
  /** Headline of the most severe active alert, empty when none. */
  alert: string;
  /** 0 = fresh; drives the stale marker. */
  ageSeconds: number;
  /** Example payload — labelled so a preview never passes as real. */
  demo: boolean;
}

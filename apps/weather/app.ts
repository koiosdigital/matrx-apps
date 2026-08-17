/**
 * Weather — the panel as a sky rather than a dashboard.
 *
 * The gradient comes from where the sun actually is at the configured
 * coordinates, precipitation falls in parallax layers, clouds drift and
 * storms flash; the numbers sit on top under alpha scrims rather than in
 * boxes. You know the weather before you read a digit.
 *
 * ONE LOOP, 150 FRAMES AT 100ms. The device loops frame 149 straight into
 * frame 0, so every layer's period must divide 150 exactly:
 *
 *   - falling layers travel 75/150/225/300px and repeat their content with
 *     that same period (see `fallLayer`)
 *   - clouds traverse screen-plus-cloud exactly once
 *   - the sun rotates one 45 degree ray pitch
 *   - stars twinkle on a 10-frame cycle, and 150/10 is whole
 *   - the content cycle's holds and dissolves are planned to sum to 150
 *
 * Nothing here is periodic by luck; it is periodic by construction.
 */

import {
  Box,
  Config,
  Root,
  Stack,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import { FRAMES, scrimBottom, scrimTop, skyScene } from "./scene";
import { arcPosition, isNight, skyStops } from "./sky";
import { cycle, type Screen } from "./cycle";
import { fetchConditions } from "./weatherkit";
import { alertScreen, next12Screen, nowScreen, todayScreen, type Ctx } from "./screens";
import { resolveUnits, type Units } from "./format";

const FRAME_DELAY_MS = 100;
/** Ten minutes of sky is still the same sky. */
const MAX_AGE = 900;
const FADE_FRAMES = 10;

const DEFAULT_LOCATION = `{
  "lat": "37.3352",
  "lng": "-121.8811",
  "locality": "San Jose",
  "timezone": "America/Los_Angeles",
  "country": "US"
}`;

interface Location {
  lat: string | number;
  lng: string | number;
  locality?: string;
  timezone?: string;
  country?: string;
}

function readLocation(config: Config): Location {
  try {
    return JSON.parse(config.get("location") || DEFAULT_LOCATION) as Location;
  } catch {
    return JSON.parse(DEFAULT_LOCATION) as Location;
  }
}

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();

  const loc = readLocation(config);
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  const tz = loc.timezone || "UTC";

  const nowSec = time.now().unix;
  const cond = await fetchConditions(lat, lng, tz, nowSec);

  const unit = resolveUnits(config.str("units", "auto") as Units, loc.country ?? "");
  const accent = config.str("accent", "#F5A15B");
  const intensity = sceneIntensity(config.str("scene", "full"));
  const alertsOn = config.bool("alerts", true);

  const night = isNight(nowSec, cond.sunriseSec, cond.sunsetSec);
  const arc = arcPosition(nowSec, cond.sunriseSec, cond.sunsetSec);
  const stops = skyStops(nowSec, cond.sunriseSec, cond.sunsetSec, cond.scene);

  const ctx: Ctx = {
    cond,
    unit,
    width,
    height,
    riseLabel: clock(cond.sunriseSec, tz),
    setLabel: clock(cond.sunsetSec, tz),
    locality: (loc.locality ?? "").toUpperCase().slice(0, 14),
    accent,
  };

  const sky: WidgetSpec[] =
    intensity > 0
      ? skyScene(cond.scene, stops, width, height, night, arc, intensity)
      : [Box({ color: "#05070B" })];

  // Scrims are the whole reason the type stays legible over a live sky
  // without being boxed. Sized to the two bands the content occupies.
  const scrims: WidgetSpec[] =
    intensity > 0
      ? [scrimTop(width, 9, 0.55), scrimBottom(width, height, 15, 0.6)]
      : [];

  const screens: Screen[] = [];
  if (alertsOn && cond.alert) {
    screens.push({ build: (a) => alertScreen(ctx, a), weight: 3 });
  } else {
    screens.push({ build: (a) => nowScreen(ctx, a), weight: 3 });
  }
  screens.push({ build: (a) => todayScreen(ctx, a), weight: 2 });
  screens.push({
    build: (a, prog) => next12Screen(ctx, a, Math.min(1, prog * 2)),
    weight: 1.4,
    animated: true,
  });

  return Root({
    delay: FRAME_DELAY_MS,
    maxAge: MAX_AGE,
    child: Stack({
      children: [...sky, ...scrims, cycle(screens, FADE_FRAMES, FRAMES)],
    }),
  });
}

/** "6:41" in the location's own timezone. */
function clock(unixSec: number, tz: string): string {
  if (!unixSec) return "--:--";
  // 12-hour without a meridiem would render 23:41 as "11:41".
  return time.fromUnix(unixSec).inLocation(tz).format("3:04PM");
}

function sceneIntensity(mode: string): number {
  if (mode === "off") return 0;
  if (mode === "calm") return 0.45;
  return 1;
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Where to show the weather for.",
        icon: "locationDot",
      }),
      schema.dropdown({
        id: "units",
        name: "Units",
        desc: "Automatic follows the location's country.",
        icon: "temperatureHalf",
        default: "auto",
        options: [
          schema.option({ display: "Automatic", value: "auto" }),
          schema.option({ display: "Fahrenheit", value: "f" }),
          schema.option({ display: "Celsius", value: "c" }),
        ],
      }),
      schema.dropdown({
        id: "scene",
        name: "Sky",
        desc: "Calm halves the rain and snow. Off replaces the sky with a black background, for a bedside panel.",
        icon: "cloudSun",
        default: "full",
        options: [
          schema.option({ display: "Full", value: "full" }),
          schema.option({ display: "Calm", value: "calm" }),
          schema.option({ display: "Off", value: "off" }),
        ],
      }),
      schema.toggle({
        id: "alerts",
        name: "Severe weather alerts",
        desc: "Replace the current conditions with the alert headline while one is active.",
        icon: "triangleExclamation",
        default: true,
      }),
      schema.color({
        id: "accent",
        name: "Accent",
        desc: "Tints the labels and the twelve-hour trend. The sky stays driven by the real sun.",
        icon: "palette",
        default: "#F5A15B",
      }),
    ],
  });
}

/**
 * USGS Earthquakes — hand port of `usgsearthquakes/usgs_earthquakes.star`
 * (by Chris Silverberg, MIT-licensed): the most recent earthquakes near a
 * location from the free USGS GeoJSON feed, hand-rolled marquee and page
 * scrolling included.
 *
 * Differences from the Starlark original:
 *  - `humanize.time` became a small relative-time helper.
 *  - pixlet's Text.size() isn't available; the place-string width is
 *    estimated from character count.
 *  - Screen sizes: widths/heights derive from the canvas.
 */

import {
  Box,
  Column,
  Config,
  Image,
  Padding,
  Root,
  Row,
  Stack,
  Text,
  Animation,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http, time } from "@koiosdigital/matrx-sdk/stdlib";

import ICON from "./icon.png";

const BASE_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const CACHE_TTL = 300;
const DELAY_MS = 20;
const MAX_QUAKES = 3;
const ROW_HEIGHT = 10;
/** Estimated tb-8 glyph advance, for marquee length. */
const CHAR_W = 5;

const DEFAULT_LOCATION = `{
  "lat": "33.745571",
  "lng": "-117.867836",
  "locality": "Santa Ana, CA, USA",
  "timezone": "America/Los_Angeles"
}`;
const DEFAULT_MAGNITUDE = "3";
const DEFAULT_RADIUS = "0";

interface Quake {
  properties: { mag: number; place: string; time: number };
}

function colorFromMagnitude(mag: number): string {
  if (mag >= 5) return "#ff0000";
  if (mag >= 4) return "#ff8000";
  if (mag >= 3) return "#ffff00";
  if (mag >= 2) return "#80ff00";
  return "#00ffff";
}

/** "5 minutes ago"-style relative time. */
function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function getPageFrame(
  magStr: string,
  magColor: string,
  placeStr: string,
  placeX: number,
  timeStr: string,
  width: number,
  height: number,
): WidgetSpec {
  return Box({
    height,
    child: Column({
      expanded: true,
      mainAlign: "space_evenly",
      crossAlign: "start",
      children: [
        Row({
          children: [
            Image({ src: ICON }),
            Box({ width: 2, height: ROW_HEIGHT }),
            Text({ content: magStr, color: magColor }),
          ],
          expanded: true,
          mainAlign: "center",
        }),
        Box({
          width,
          height: ROW_HEIGHT,
          child: Padding({
            pad: { left: placeX, top: 0, right: 0, bottom: 0 },
            child: Text({ content: placeStr }),
          }),
        }),
        Row({ children: [Text({ content: timeStr })], expanded: true, mainAlign: "center" }),
      ],
    }),
  });
}

function getPageFrames(quake: Quake, nowMs: number, width: number, height: number): WidgetSpec[] {
  const { mag, place, time: quakeTime } = quake.properties;
  const magStr = `Mag ${mag}`;
  const magColor = colorFromMagnitude(mag);
  const placeStr = place ?? "";
  const timeStr = relativeTime(quakeTime, nowMs);
  const placeLen = placeStr.length * CHAR_W;

  if (placeLen > width) {
    // Place string requires scrolling: sweep out to the left, then back in
    // from the right (the original's two-phase marquee).
    const frames: WidgetSpec[] = [];
    for (let placeX = 0; placeX > -placeLen; placeX--) {
      frames.push(getPageFrame(magStr, magColor, placeStr, placeX, timeStr, width, height));
    }
    for (let placeX = width; placeX >= 0; placeX--) {
      frames.push(getPageFrame(magStr, magColor, placeStr, placeX, timeStr, width, height));
    }
    return frames;
  }

  const placeX = Math.floor((width - placeLen) / 2);
  return new Array(width).fill(
    getPageFrame(magStr, magColor, placeStr, placeX, timeStr, width, height),
  );
}

/** Vertical page-to-page scroll transition (after the BGG Hotness applet). */
function getScrollFrames(item: WidgetSpec, nextItem: WidgetSpec, height: number): WidgetSpec[] {
  const frames: WidgetSpec[] = [];
  for (let offset = -1; offset >= -height; offset--) {
    frames.push(
      Padding({
        pad: { left: 0, top: offset, right: 0, bottom: 0 },
        child: Stack({
          children: [
            item,
            Padding({ pad: { left: 0, top: height, right: 0, bottom: 0 }, child: nextItem }),
          ],
        }),
      }),
    );
  }
  return frames;
}

async function fetchEarthquakes(
  lat: string,
  lng: string,
  radius: string,
  magnitude: string,
): Promise<Quake[] | null> {
  const params: Record<string, string> = {
    format: "geojson",
    minmagnitude: magnitude,
    limit: String(MAX_QUAKES),
  };
  if (radius !== "0") {
    params.latitude = lat;
    params.longitude = lng;
    params.maxradiuskm = radius;
  }

  const res = await http.get(BASE_URL, { params, ttlSeconds: CACHE_TTL });
  if (res.status !== 200) return null;

  const features = (res.json() as { features?: Quake[] }).features;
  return features && features.length > 0 ? features : null;
}

export default async function render(config: Config): Promise<RootSpec | null> {
  const loc = JSON.parse(config.get("location", DEFAULT_LOCATION)!) as {
    lat: string | number;
    lng: string | number;
  };

  // Truncate coordinates to protect the user's privacy.
  const lat = parseFloat(String(loc.lat)).toFixed(2);
  const lng = parseFloat(String(loc.lng)).toFixed(2);

  const radius = config.get("radius", DEFAULT_RADIUS)!;
  const magnitude = config.get("magnitude", DEFAULT_MAGNITUDE)!;

  const earthquakes = await fetchEarthquakes(lat, lng, radius, magnitude);
  if (!earthquakes) return null;

  const width = config.width();
  const height = config.height();
  const nowMs = time.now().ms;

  const pages = earthquakes.map((q) => getPageFrames(q, nowMs, width, height));

  const frames: WidgetSpec[] = [];
  if (pages.length > 1) {
    pages.forEach((pageFrames, i) => {
      const nextPageFrames = pages[(i + 1) % pages.length];
      frames.push(...pageFrames);
      frames.push(...getScrollFrames(pageFrames[0], nextPageFrames[0], height));
    });
  } else {
    frames.push(...pages[0]);
  }

  return Root({
    child: Animation({ children: frames }),
    delay: DELAY_MS,
  });
}

export function getSchema(): Schema {
  const radiusOptions = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000].map((item) =>
    schema.option({ display: `${item}km`, value: String(item) }),
  );
  radiusOptions.push(schema.option({ display: "Unlimited", value: "0" }));

  const magnitudeOptions = [1, 2, 3, 4, 5].map((item) =>
    schema.option({ display: String(item), value: String(item) }),
  );

  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Location for which to find nearby earthquakes.",
        icon: "locationDot",
      }),
      schema.dropdown({
        id: "radius",
        name: "Radius",
        desc: "The radius from the location to find nearby earthquakes.",
        icon: "brush",
        default: DEFAULT_RADIUS,
        options: radiusOptions,
      }),
      schema.dropdown({
        id: "magnitude",
        name: "Magnitude",
        desc: "The minimum magnitude to show.",
        icon: "brush",
        default: DEFAULT_MAGNITUDE,
        options: magnitudeOptions,
      }),
    ],
  });
}

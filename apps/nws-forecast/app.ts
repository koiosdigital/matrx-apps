/**
 * NWS Live Forecast — hand port of `nws_live_forecast/nws_live_forecast.star`
 * (by Andrey Goder): current temperature plus the coming days' highs from
 * the free National Weather Service API (US locations only, no key).
 *
 * Differences from the Starlark original:
 *  - Fixed the icon-picker bug where `fc.find("Frost")` (without `>= 0`)
 *    made every unmatched forecast render as snow.
 *  - Sends an explicit User-Agent, which api.weather.gov requires.
 *  - Screen sizes: 3 columns on 64-wide panels (the original layout),
 *    5 columns on 128-wide.
 *
 * Weather icons from flaticon.com (free with attribution).
 */

import {
  Column,
  Config,
  Image,
  Root,
  Row,
  Text,
  WrappedText,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http, time } from "@koiosdigital/matrx-sdk/stdlib";

import SUNNY from "./sunny.png";
import PARTLY_SUNNY from "./partly_sunny.png";
import CLOUDY from "./cloudy.png";
import RAINY from "./rainy.png";
import SNOWY from "./snowy.png";
import FOG from "./fog.png";
import STORMY from "./stormy.png";

const WEATHER_URL = "https://api.weather.gov/points/";
const TTL_SECONDS = 300;
const USER_AGENT = "matrx-nws-forecast (koiosdigital.net)";

const DEFAULT_LOCATION = `{
  "lat": "37.27",
  "lng": "-121.9272",
  "timezone": "America/Los_Angeles"
}`;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface ForecastPeriod {
  startTime: string;
  endTime: string;
  temperature: number;
  shortForecast: string;
}

function getIcon(fc: string): Uint8Array {
  if (fc === "Partly Sunny" || fc === "Partly Cloudy") return PARTLY_SUNNY;
  if (fc.includes("Sunny") || fc === "Clear") return SUNNY;
  if (fc.includes("Cloudy")) return CLOUDY;
  if (fc.includes("Fog") || fc.includes("Haze")) return FOG;
  if (fc.includes("Rain")) return RAINY;
  if (fc.includes("Snow") || fc.includes("Frost")) return SNOWY;
  if (fc.toLowerCase().includes("storm")) return STORMY;
  return SUNNY; // not ideal as the default
}

function mode(lst: string[]): string {
  const count: Record<string, number> = {};
  for (const item of lst) count[item] = (count[item] ?? 0) + 1;
  let best = lst[0];
  let m = 0;
  for (const [item, n] of Object.entries(count)) {
    if (n > m) {
      m = n;
      best = item;
    }
  }
  return best;
}

function dayColumn(label: string, forecast: string, temp: number): WidgetSpec {
  return Column({
    crossAlign: "center",
    children: [
      Text({ content: label }),
      Image({ src: getIcon(forecast) }),
      Text({ content: ` ${Math.round(temp)}°` }),
    ],
  });
}

export default async function render(config: Config): Promise<RootSpec> {
  const location = JSON.parse(config.get("location") || DEFAULT_LOCATION) as {
    lat: string | number;
    lng: string | number;
  };

  const points = await http.get(`${WEATHER_URL}${location.lat},${location.lng}`, {
    headers: { "User-Agent": USER_AGENT },
    ttlSeconds: TTL_SECONDS,
  });
  if (points.status !== 200) {
    return Root({
      child: WrappedText({ content: "NWS unavailable (US locations only)", width: config.width() }),
    });
  }

  const forecastUrl = (points.json() as { properties: { forecastHourly: string } }).properties
    .forecastHourly;
  const forecastRes = await http.get(forecastUrl, {
    headers: { "User-Agent": USER_AGENT },
    ttlSeconds: TTL_SECONDS,
  });
  if (forecastRes.status !== 200) {
    return Root({
      child: WrappedText({ content: "NWS forecast unavailable", width: config.width() }),
    });
  }

  const periods = (forecastRes.json() as { properties: { periods: ForecastPeriod[] } }).properties
    .periods;
  const now = time.now();

  // Group hourly periods by calendar day and find the current one.
  const days: ForecastPeriod[][] = [];
  let rightNow: ForecastPeriod | null = null;
  let prevDay: string | null = null;
  for (const period of periods) {
    if (rightNow === null && time.parseTime(period.endTime).after(now)) {
      rightNow = period;
    }
    const day = time.parseTime(period.startTime).format("2006-01-02");
    if (prevDay === null || day !== prevDay) {
      days.push([]);
      prevDay = day;
    }
    days[days.length - 1].push(period);
  }
  if (rightNow === null) {
    return Root({ child: WrappedText({ content: "No forecast data", width: config.width() }) });
  }

  const maxDays = config.width() >= 128 ? 5 : 3;

  const cols: WidgetSpec[] = [dayColumn("Now", rightNow.shortForecast, rightNow.temperature)];
  for (const day of days) {
    if (cols.length >= maxDays) break;
    const dayStart = time.parseTime(day[0].startTime);
    const high = Math.max(...day.map((p) => p.temperature));
    const forecast = mode(day.map((p) => p.shortForecast));
    const label = dayStart.before(now) ? "Today" : DAY_LABELS[dayStart.weekday];
    cols.push(dayColumn(label, forecast, high));
  }

  return Root({
    child: Row({
      expanded: true,
      mainAlign: "space_around",
      crossAlign: "center",
      children: cols,
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        desc: "Location for which to display weather data.",
        icon: "locationDot",
      }),
    ],
  });
}

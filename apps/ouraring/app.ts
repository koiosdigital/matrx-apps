/**
 * Oura Ring — port of `ouraring/ouraring.star` (by Aiden Vigue), upgraded
 * from a pasted personal-access-token to a proper OAuth2 connection and a
 * size-aware UI redesign.
 *
 * Auth model (shared Koios OAuth client, like the netatmo original): the
 * client id ships in the schema and the client secret ships encrypted,
 * decrypted host-side via `secret.decrypt`. The oauth2 handler exchanges the
 * authorization code and persists just the refresh token as the connection
 * value.
 *
 * Oura rotates refresh tokens on every refresh-grant exchange, and the MATRX
 * config store is write-once/read-only — so the rotating chain lives in the
 * `cache` module keyed by the ORIGINAL refresh token: `refresh:<orig>` holds
 * the latest rotated refresh token and `access:<orig>` the minted access
 * token (~23h). If the chain cache is ever lost mid-rotation the user
 * reconnects; that's the best a write-once store allows.
 *
 * Metrics (multiselect-configurable): readiness, activity and sleep scores,
 * high-stress minutes (daily_stress) and average SpO2 %. Each metric shows
 * its icon + latest value (colored by its own good/warn/bad bands) and a
 * deviation bar chart of the past N days: the average is the center axis,
 * bars above/below are colored good-green/bad-red — inverted for stress,
 * where more-than-average is the bad direction. Newest day on the right.
 *
 * Layouts:
 *  - 64x32: a carousel of sliding screens (one per selected metric), each
 *    split 1/3 score panel | 2/3 bar chart.
 *  - 64x64: all selected metrics at once as stacked rows with mini charts.
 *  - 128x64: side-by-side panels with labels and tall charts (header art
 *    shrinks when >3 metrics squeeze the panels).
 */

import {
  animation,
  Box,
  Column,
  Config,
  Image,
  Padding,
  Root,
  Row,
  Sequence,
  Stack,
  Text,
  Transformation,
  WrappedText,
  schema,
  type Child,
  type Insets,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { cache, http, secret, time } from "@koiosdigital/matrx-sdk/stdlib";

import READINESS_ICON from "./readiness.png";
import ACTIVITY_ICON from "./activity.png";
import SLEEP_ICON from "./sleep.png";
import STRESS_ICON from "./stress.png";
import SPO2_ICON from "./spo2.png";

const CLIENT_ID = "8986c41d-5a1b-4f41-b661-557a08991fd0";
/** Koios's Oura client secret, decrypted host-side via secret.decrypt. */
const ENCRYPTED_CLIENT_SECRET =
  "MTX1:BNwGUdnQefv9eGAab9KIoK87Oc+BPRDgKe5JCiK/nAwbF/QN7cgTRoQ4aU9hgCwXJnu8bRSDsRTMnOqianzyfwGdMKHkssFg7tXOXwRJlJHLevFLfLZf0UeVOOW0ECFVWJDXc2Makm8FnrHvn5+IqhdayPAhkdL6vrdzF17uwXUUf3u1kNZyTQ==";

const TOKEN_ENDPOINT = "https://api.ouraring.com/oauth/token";
const API_BASE = "https://api.ouraring.com/v2/usercollection";

/** Oura access tokens live 24h; refresh a little early. */
const ACCESS_TOKEN_CACHE_SECONDS = 23 * 60 * 60;
/** Rotated-refresh-token chain entries are kept effectively forever. */
const REFRESH_CHAIN_CACHE_SECONDS = 180 * 24 * 60 * 60;
/** Score data cache (original app cached 30min). */
const DATA_TTL_SECONDS = 1800;

const GOOD_COLOR = "#0f0";
const WARN_COLOR = "#fc0";
const BAD_COLOR = "#f33";
const AXIS_COLOR = "#444";
const LABEL_COLOR = "#666";

/** All icons are 8x8; drawn at 2x (16x16) where space allows. */
const ICON_SIZE = 8;

/** Frames per carousel screen (50ms/frame → 5s each). */
const SLIDE_FRAMES = 100;

/** Oura's score bands: ≥85 optimal, 70–84 good, <70 pay attention. */
function scoreColor(score: number): string {
  if (score >= 85) return GOOD_COLOR;
  if (score >= 70) return WARN_COLOR;
  return BAD_COLOR;
}

interface DailyEntry {
  score?: number | null;
  stress_high?: number | null;
  spo2_percentage?: { average?: number | null } | null;
}

interface MetricDef {
  key: string;
  label: string;
  icon: Uint8Array;
  endpoint: string;
  /** Per-day numeric value, or null when absent that day. */
  extract: (day: DailyEntry) => number | null;
  color: (value: number) => string;
  /** True when above-average is the bad direction (stress). */
  invert?: boolean;
  /** Demo series so the app previews with no account connected. */
  example: number[];
}

const METRIC_DEFS: MetricDef[] = [
  {
    key: "readiness",
    label: "READY",
    icon: READINESS_ICON,
    endpoint: "daily_readiness",
    extract: (day) => (typeof day.score === "number" ? day.score : null),
    color: scoreColor,
    example: [62, 73, 68, 70, 88, 79, 61],
  },
  {
    key: "activity",
    label: "ACTIVE",
    icon: ACTIVITY_ICON,
    endpoint: "daily_activity",
    extract: (day) => (typeof day.score === "number" ? day.score : null),
    color: scoreColor,
    example: [76, 95, 71, 80, 66, 91, 83],
  },
  {
    key: "sleep",
    label: "SLEEP",
    icon: SLEEP_ICON,
    endpoint: "daily_sleep",
    extract: (day) => (typeof day.score === "number" ? day.score : null),
    color: scoreColor,
    example: [78, 86, 67, 92, 65, 82, 85],
  },
  {
    key: "stress",
    label: "STRESS",
    icon: STRESS_ICON,
    endpoint: "daily_stress",
    // Minutes of high stress; lower is better.
    extract: (day) => (typeof day.stress_high === "number" ? Math.round(day.stress_high / 60) : null),
    color: (minutes) => (minutes <= 30 ? GOOD_COLOR : minutes <= 90 ? WARN_COLOR : BAD_COLOR),
    invert: true,
    example: [55, 20, 90, 35, 130, 45, 30],
  },
  {
    key: "spo2",
    label: "SPO2",
    icon: SPO2_ICON,
    endpoint: "daily_spo2",
    extract: (day) => {
      const avg = day.spo2_percentage?.average;
      return typeof avg === "number" ? Math.round(avg) : null;
    },
    color: (pct) => (pct >= 95 ? GOOD_COLOR : pct >= 90 ? WARN_COLOR : BAD_COLOR),
    example: [97, 96, 98, 95, 97, 96, 97],
  },
];

const DEFAULT_METRIC_KEYS = ["readiness", "activity", "sleep"];

interface Metric {
  def: MetricDef;
  values: number[];
}

function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function latest(m: Metric): number {
  return m.values[m.values.length - 1];
}

function latestColor(m: Metric): string {
  return m.def.color(latest(m));
}

/** Selected metric keys from the multiselect, in canonical order. */
function selectedMetricDefs(config: Config): MetricDef[] {
  const raw = config.get("metrics");
  let keys = DEFAULT_METRIC_KEYS;
  if (raw) {
    try {
      const picked = (JSON.parse(raw) as { value: string }[]).map((o) => o.value);
      if (picked.length > 0) keys = picked;
    } catch {
      // malformed config — keep defaults
    }
  }
  const defs = METRIC_DEFS.filter((d) => keys.includes(d.key));
  return defs.length > 0 ? defs : METRIC_DEFS.filter((d) => DEFAULT_METRIC_KEYS.includes(d.key));
}

/**
 * Deviation bar chart: a dim center axis at the average of the shown days,
 * one bar per day (1px gaps, newest right), scaled so the largest deviation
 * fills the half. Above-axis bars are good-green (bad-red when `invert`).
 */
function barChart(m: Metric, width: number, height: number, days: number): WidgetSpec {
  const upColor = m.def.invert ? BAD_COLOR : GOOD_COLOR;
  const downColor = m.def.invert ? GOOD_COLOR : BAD_COLOR;
  const maxBars = Math.floor((width + 1) / 2); // keep bars ≥1px wide with gaps
  const shown = m.values.slice(-Math.min(days, maxBars));
  const n = shown.length;
  const half = Math.floor(height / 2);
  const avg = average(shown);
  const maxDev = Math.max(1, ...shown.map((s) => Math.abs(s - avg)));
  const barW = Math.max(1, Math.floor((width - (n - 1)) / n));
  const usedW = n * barW + (n - 1);
  const leftPad = Math.max(0, Math.floor((width - usedW) / 2));

  const bars: Child[] = [];
  shown.forEach((value, i) => {
    if (i > 0) bars.push(Box({ width: 1, height }));
    const dev = value - avg;
    const barH = Math.round((Math.abs(dev) / maxDev) * (half - 1));
    if (barH === 0) {
      bars.push(Box({ width: barW, height }));
    } else if (dev > 0) {
      bars.push(
        Column({
          children: [
            Box({ width: barW, height: half - barH }),
            Box({ width: barW, height: barH, color: upColor }),
          ],
        }),
      );
    } else {
      bars.push(
        Column({
          children: [
            Box({ width: barW, height: half + 1 }),
            Box({ width: barW, height: barH, color: downColor }),
          ],
        }),
      );
    }
  });

  return Box({
    width,
    height,
    child: Stack({
      children: [
        Column({
          children: [Box({ width, height: half }), Box({ width, height: 1, color: AXIS_COLOR })],
        }),
        Padding({ pad: pad(leftPad, 0, 0, 0), child: Row({ children: bars }) }),
      ],
    }),
  });
}

/** 1/3 panel for the carousel: 2x icon above a big band-colored value. */
function scorePanel(m: Metric, width: number, height: number): WidgetSpec {
  return Box({
    width,
    height,
    child: Column({
      mainAlign: "center",
      crossAlign: "center",
      children: [
        Image({ src: m.def.icon, width: ICON_SIZE * 2, height: ICON_SIZE * 2 }),
        Padding({
          pad: pad(0, 2, 0, 0),
          child: Text({ content: String(latest(m)), font: "6x13", color: latestColor(m) }),
        }),
      ],
    }),
  });
}

/** One carousel screen: 1/3 score panel | 2/3 bar chart. */
function slideScreen(m: Metric, width: number, height: number, days: number): WidgetSpec {
  const panelW = Math.floor(width / 3);
  return Row({
    children: [scorePanel(m, panelW, height), barChart(m, width - panelW, height, days)],
  });
}

/**
 * 64x32: sliding carousel — each metric screen eases in from the right,
 * holds, and eases out to the left. A single selected metric renders static.
 */
function carousel(metrics: Metric[], width: number, height: number, days: number): WidgetSpec {
  if (metrics.length === 1) return slideScreen(metrics[0], width, height, days);
  const keyframes = [
    animation.Keyframe({ percentage: 0, transforms: [animation.Translate(width, 0)], curve: "ease_out" }),
    animation.Keyframe({ percentage: 0.12, transforms: [animation.Translate(0, 0)], curve: "linear" }),
    animation.Keyframe({ percentage: 0.88, transforms: [animation.Translate(0, 0)], curve: "ease_in" }),
    animation.Keyframe({ percentage: 1, transforms: [animation.Translate(-width, 0)], curve: "linear" }),
  ];
  return Sequence({
    children: metrics.map((m) =>
      Transformation({
        duration: SLIDE_FRAMES,
        width,
        height,
        keyframes,
        child: slideScreen(m, width, height, days),
      }),
    ),
  });
}

/** 64x64: all selected metrics stacked, each row 1/3 icon+value | 2/3 chart. */
function stackedRows(metrics: Metric[], width: number, height: number, days: number): WidgetSpec {
  const rowH = Math.floor((height - 2) / metrics.length);
  const panelW = Math.floor(width / 3);
  return Column({
    expanded: true,
    mainAlign: "space_evenly",
    children: metrics.map((m) =>
      Row({
        children: [
          Box({
            width: panelW,
            height: rowH,
            child: Row({
              crossAlign: "center",
              children: [
                Image({ src: m.def.icon }),
                Padding({
                  pad: pad(2, 0, 0, 0),
                  child: Text({ content: String(latest(m)), font: "tom-thumb", color: latestColor(m) }),
                }),
              ],
            }),
          }),
          barChart(m, width - panelW - 1, rowH, days),
        ],
      }),
    ),
  });
}

/** 128x64: side-by-side panels — icon + value + label, tall chart. */
function widePanels(metrics: Metric[], width: number, height: number, days: number): WidgetSpec {
  const panelW = Math.floor(width / metrics.length);
  // With >3 metrics the panels get narrow — drop to 1x icons and small digits.
  const big = panelW >= 36;
  const headerH = big ? 17 : 10;
  const labelH = 6;
  const chartH = height - headerH - labelH - 2;
  return Row({
    mainAlign: "space_evenly",
    expanded: true,
    children: metrics.map((m) =>
      Column({
        crossAlign: "center",
        children: [
          Box({
            width: panelW,
            height: headerH,
            child: Row({
              crossAlign: "center",
              children: [
                Image({
                  src: m.def.icon,
                  width: ICON_SIZE * (big ? 2 : 1),
                  height: ICON_SIZE * (big ? 2 : 1),
                }),
                Padding({
                  pad: pad(2, 0, 0, 0),
                  child: Text({
                    content: String(latest(m)),
                    font: big ? "6x13" : "tom-thumb",
                    color: latestColor(m),
                  }),
                }),
              ],
            }),
          }),
          Text({ content: m.def.label, font: "tom-thumb", color: LABEL_COLOR }),
          Padding({ pad: pad(0, 2, 0, 0), child: barChart(m, panelW - 2, chartH, days) }),
        ],
      }),
    ),
  });
}

function errorView(message: string, width: number): RootSpec {
  return Root({ child: WrappedText({ content: message, width, color: "#fff" }) });
}

/**
 * Exchange the stored (possibly rotated) refresh token for an access token.
 * Returns null when the connection is gone and the user must reconnect.
 */
async function getAccessToken(originalRefreshToken: string): Promise<string | null> {
  const cached = await cache.get(`access:${originalRefreshToken}`);
  if (cached !== null) return cached;

  const clientSecret = await secret.decrypt(ENCRYPTED_CLIENT_SECRET);
  if (clientSecret === null) return null;

  const latestToken = (await cache.get(`refresh:${originalRefreshToken}`)) ?? originalRefreshToken;

  const exchange = (refreshToken: string) =>
    http.post(TOKEN_ENDPOINT, {
      headers: { Accept: "application/json" },
      auth: [CLIENT_ID, clientSecret],
      formBody: { grant_type: "refresh_token", refresh_token: refreshToken },
    });

  let res = await exchange(latestToken);
  if (res.status !== 200 && latestToken !== originalRefreshToken) {
    // Chain cache may be stale (e.g. rotation raced) — try the original.
    res = await exchange(originalRefreshToken);
  }
  if (res.status !== 200) return null;

  const body = res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
  const ttl = Math.min(ACCESS_TOKEN_CACHE_SECONDS, Math.max(300, (body.expires_in ?? 86400) - 300));
  await cache.set(`access:${originalRefreshToken}`, body.access_token, ttl);
  if (body.refresh_token) {
    await cache.set(`refresh:${originalRefreshToken}`, body.refresh_token, REFRESH_CHAIN_CACHE_SECONDS);
  }
  return body.access_token;
}

/** Fetch one metric's per-day series. Null = API error; [] = no data. */
async function fetchSeries(accessToken: string, def: MetricDef, days: number): Promise<number[] | null> {
  const now = time.now();
  const fromDate = now.add(time.parseDuration(`-${days * 24}h`)).format("2006-01-02");
  const toDate = now.format("2006-01-02");

  const res = await http.get(`${API_BASE}/${def.endpoint}`, {
    params: { start_date: fromDate, end_date: toDate },
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    ttlSeconds: DATA_TTL_SECONDS,
  });
  if (res.status !== 200) return null;

  const body = res.json() as { data?: DailyEntry[] };
  return (body.data ?? [])
    .map((day) => def.extract(day))
    .filter((value): value is number => value !== null);
}

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();
  const days = Math.max(1, Math.min(30, parseInt(config.get("days", "7")!, 10) || 7));
  const defs = selectedMetricDefs(config);

  let metrics: Metric[];
  const auth = config.get("auth");
  if (auth) {
    const accessToken = await getAccessToken(auth);
    if (accessToken === null) {
      return errorView("Oura auth expired - please reconnect", width);
    }

    const series = await Promise.all(defs.map((def) => fetchSeries(accessToken, def, days)));
    if (series.some((s) => s === null)) {
      return errorView("API error", width);
    }
    // Drop selected metrics the account has no data for (e.g. SpO2 sensing off).
    metrics = defs
      .map((def, i) => ({ def, values: series[i] as number[] }))
      .filter((m) => m.values.length > 0);
    if (metrics.length === 0) {
      return errorView("No Oura data yet", width);
    }
  } else {
    metrics = defs.map((def) => ({ def, values: def.example }));
  }

  if (width >= 128) {
    return Root({ child: widePanels(metrics, width, height, days) });
  }
  if (height >= 64) {
    return Root({ child: stackedRows(metrics, width, height, days) });
  }
  return Root({ delay: 50, child: carousel(metrics, width, height, days) });
}

/**
 * oauth2 handler: authorization_code exchange against the shared Koios Oura
 * client (secret decrypted host-side); persists the refresh token
 * (write-once) as the connection value.
 */
export async function oauthHandler(params: string): Promise<string> {
  const p = JSON.parse(params) as Record<string, string>;
  const clientSecret = await secret.decrypt(ENCRYPTED_CLIENT_SECRET);
  if (clientSecret === null) {
    throw new Error("client secret unavailable (secret.decrypt failed)");
  }
  const res = await http.post(TOKEN_ENDPOINT, {
    headers: { Accept: "application/json" },
    auth: [CLIENT_ID, clientSecret],
    formBody: p,
  });
  if (res.status !== 200) {
    throw new Error(`token request failed with status code: ${res.status} - ${res.body()}`);
  }
  const { refresh_token } = res.json() as { refresh_token: string };
  return refresh_token;
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.oauth2({
        id: "auth",
        icon: "cloud",
        name: "Oura",
        desc: "Connect your Oura account.",
        handler: "oauthHandler",
        clientId: CLIENT_ID,
        authorizationEndpoint: "https://cloud.ouraring.com/oauth/authorize",
        scopes: ["daily", "spo2", "stress"],
      }),
      schema.multiSelect({
        id: "metrics",
        name: "Metrics",
        desc: "Which metrics to show.",
        icon: "chartSimple",
        options: [
          schema.option({ display: "Readiness", value: "readiness" }),
          schema.option({ display: "Activity", value: "activity" }),
          schema.option({ display: "Sleep", value: "sleep" }),
          schema.option({ display: "Stress", value: "stress" }),
          schema.option({ display: "SpO2", value: "spo2" }),
        ],
        default: DEFAULT_METRIC_KEYS,
      }),
      schema.text({
        id: "days",
        name: "Graph Lookback",
        desc: "Number of previous days to graph",
        icon: "calendar",
        default: "7",
      }),
    ],
  });
}

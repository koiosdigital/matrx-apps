/**
 * The only file that knows where numbers come from.
 *
 * Everything downstream consumes `Quote`/`Feed` from `types.ts`, so moving
 * this app behind a Koios proxy — the recommended end state, since a
 * market-data key is a metered bearer credential and a bundle is a
 * distribution channel rather than a secret store — means reimplementing
 * `fetchFeed()` and `searchSymbols()` against the proxy and changing
 * `allowedHosts`. No render code moves.
 *
 * Provider: Alpha Vantage (https://www.alphavantage.co/documentation/).
 *
 * THE KEY BELOW IS PLAINTEXT IN THE BUNDLE. That is a deliberate interim
 * state, not a finished one: anyone with the bundle has the key and can
 * spend its quota. Before this ships, either move it behind a proxy or
 * bake it as ciphertext the way ouraring/spotify do —
 *
 *     npx matrx secret encrypt stocks '<key>'
 *
 * — and resolve it host-side with `secret.decrypt` instead of the constant.
 *
 * QUOTA. A free Alpha Vantage key allows 25 requests/day, and separately
 * throttles bursts to 1 request/second. The host TTL cache keys on the
 * outbound URL and the key is shared by every install, so upstream load is
 *
 *     distinct symbols x (86400 / TTL)     calls/day
 *
 * fleet-wide — one symbol at the 300s open-market TTL below is already 288
 * calls/day against a 25/day allowance. The free tier is a preview
 * credential: expect it to rate-limit, after which every symbol falls back
 * to its last good quote and the cards wear a STALE badge. A premium plan
 * (75+ req/min) is what makes the TTLs below mean anything.
 *
 * THE PER-SECOND LIMIT IS WHY THIS FILE MAKES ONE CALL PER SYMBOL. A render
 * isolate cannot sleep — the environment is frozen, `Date.now()` is the
 * quantized render time, and there is no `setTimeout` — so a watchlist's
 * fetches necessarily land inside the same second and everything after the
 * first is throttled. Cutting each symbol to a single request is the only
 * lever available. A cold multi-symbol watchlist therefore fills in over
 * successive renders rather than all at once: symbol 1 lands, the rest are
 * throttled onto their last good value, and the next render finds symbol 1
 * already in the TTL cache (no upstream call, so no throttle) and spends
 * its one live request on symbol 2. Three symbols converge in about three
 * renders and stay warm.
 *
 * IMPORTANT — one URL per symbol, never one per watchlist. Because the
 * cache keys on the outbound request, `?symbol=AAPL` collapses every device
 * watching AAPL onto a single upstream call per window, while
 * `?symbol=AAPL,NVDA` would only dedupe devices whose lists match exactly.
 * A single shared key is what makes that work: per-user keys would put a
 * different token in every URL and the cache would never hit.
 *
 * DAILY, NOT INTRADAY. Alpha Vantage gates `TIME_SERIES_INTRADAY` behind a
 * premium plan, so the sparkline is built from `TIME_SERIES_DAILY` closes —
 * a multi-week trend rather than one session. See `chartBase` in `types.ts`
 * for what that does to the chart's zero line.
 *
 * That same response is also the quote, which is what makes one call per
 * symbol possible: Alpha Vantage keeps the current day's daily bar live
 * during the session, so its close/high/low are identical to `GLOBAL_QUOTE`
 * price/high/low (verified field for field), and the day before it supplies
 * the previous close. `GLOBAL_QUOTE` is therefore not called at all — it
 * would double the request count to say the same thing.
 */

import { cache, http, time } from "@koiosdigital/matrx-sdk/stdlib";
import { schema, type Config, type SchemaOption } from "@koiosdigital/matrx-sdk";

import type { Feed, Quote } from "./types";
import { normaliseSymbol } from "./format";

/** Alpha Vantage is a single endpoint; the `function` param selects the call. */
const API_BASE = "https://www.alphavantage.co/query";

/** Interim plaintext credential — see the quota/secrecy note above. */
const API_KEY = "8BXF5AJP6QS3DQCE";

/** The current day's bar moves with the tape, so it is worth re-reading. */
const BAR_TTL_OPEN = 300;
/** Once the close is in, the bar is fixed until the next session opens. */
const BAR_TTL_CLOSED = 3600;
const SEARCH_TTL = 86400;

/** Sessions of daily closes charted, before downsampling to pixel columns. */
const SERIES_SESSIONS = 60;

/** How long a good response stays usable as the STALE fallback. */
const LAST_GOOD_TTL = 86400;

/** Exchange the CLOSED badge is reckoned against — see `deriveMarketOpen`. */
const MARKET_TZ = "America/New_York";

export const MAX_SYMBOLS = 6;

/** Alpha Vantage numbers its object keys ("4. close"), values included. */
type AvRecord = Record<string, string>;

const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Alpha Vantage answers 200 for everything, including quota exhaustion and
 * premium-only endpoints, and signals the problem in the body instead:
 * `Note` for the per-minute limit, `Information` for the daily limit and for
 * gated endpoints, `Error Message` for a bad symbol or call. Anything
 * carrying one of those is not data.
 */
function payload(res: { status: number; json: () => unknown }): Record<string, unknown> | null {
  if (res.status !== 200) return null;
  let body: unknown;
  try {
    body = res.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>;
  if (obj["Note"] || obj["Information"] || obj["Error Message"]) return null;
  return obj;
}

/**
 * Reduce a series to roughly one point per pixel column. Charting 60 bars
 * into 62px wastes payload and isolate CPU to draw the same line.
 */
export function downsample(values: number[], target: number): number[] {
  if (values.length <= target) return values;
  const out: number[] = [];
  const step = values.length / target;
  for (let i = 0; i < target; i++) out.push(values[Math.floor(i * step)]);
  out.push(values[values.length - 1]);
  return out;
}

/** Regular US session, holidays aside — also picks the TTL before a fetch. */
function inSessionHours(nowSec: number): boolean {
  const ny = time.fromUnix(nowSec).inLocation(MARKET_TZ);
  if (ny.weekday === 0 || ny.weekday === 6) return false;
  const minutes = ny.hour * 60 + ny.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Alpha Vantage carries no market-status flag, so the CLOSED badge is
 * reckoned from the US regular session (09:30–16:00 New York, weekdays)
 * intersected with the feed's own latest bar date: on a market holiday the
 * session clock says open while the feed still points at the previous
 * session, and the feed wins. Non-US listings keep their own hours, which
 * this does not model — their badge is approximate.
 */
function deriveMarketOpen(latestTradingDay: string, nowSec: number): boolean {
  if (!inSessionHours(nowSec)) return false;
  if (!latestTradingDay) return true;
  return latestTradingDay === time.fromUnix(nowSec).inLocation(MARKET_TZ).format("2006-01-02");
}

/**
 * One symbol, one request: the daily series doubles as the quote. `compact`
 * is the latest 100 sessions; the chart wants the newest `SERIES_SESSIONS`
 * of those, and the last two supply every price field on `Quote`.
 */
async function fetchSymbol(symbol: string, nowSec: number): Promise<Quote | null> {
  const res = await http.get(API_BASE, {
    params: {
      function: "TIME_SERIES_DAILY",
      symbol,
      outputsize: "compact",
      apikey: API_KEY,
    },
    ttlSeconds: inSessionHours(nowSec) ? BAR_TTL_OPEN : BAR_TTL_CLOSED,
  });
  const body = payload(res);
  if (!body) return null;

  const bars = body["Time Series (Daily)"] as Record<string, AvRecord> | undefined;
  if (!bars) return null;
  // Keys are `YYYY-MM-DD`, so lexical order is chronological order — sorted
  // rather than trusting the provider's (newest-first) key order.
  const days = Object.keys(bars).sort();
  if (days.length === 0) return null;

  const latestDay = days[days.length - 1];
  const today = bars[latestDay];
  const last = num(today["4. close"]);
  if (last <= 0) return null;
  // A brand-new listing can have a single bar; then there is no prior close
  // to measure the session against and the change is flat by construction.
  const prevDay = days.length > 1 ? bars[days[days.length - 2]] : undefined;
  const prevClose = prevDay ? num(prevDay["4. close"], last) : last;

  const closes = days
    .map((day) => num(bars[day]["4. close"]))
    .filter((v) => v > 0)
    .slice(-SERIES_SESSIONS);

  return {
    symbol,
    last,
    prevClose,
    change: last - prevClose,
    changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
    high: num(today["2. high"], last),
    low: num(today["3. low"], last),
    marketOpen: deriveMarketOpen(latestDay, nowSec),
    series: closes,
    chartBase: prevClose,
    ageSeconds: 0,
  };
}

/** Cache key for the last good quote. Per-installation, not fleet-wide. */
const lastGoodKey = (symbol: string) => `q:${symbol}`;

async function readLastGood(symbol: string, nowSec: number): Promise<Quote | null> {
  const raw = await cache.get(lastGoodKey(symbol));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { at: number; quote: Quote };
    const age = Math.max(0, nowSec - saved.at);
    return { ...saved.quote, ageSeconds: age };
  } catch {
    return null;
  }
}

async function writeLastGood(quote: Quote, nowSec: number): Promise<void> {
  await cache.set(
    lastGoodKey(quote.symbol),
    JSON.stringify({ at: nowSec, quote: { ...quote, ageSeconds: 0 } }),
    LAST_GOOD_TTL,
  );
}

/**
 * One request per symbol, each its own cacheable URL. A symbol that fails
 * falls back to its last good value rather than dropping out of the
 * rotation — an hour-old price is still useful, and on a free key a
 * throttled fetch is the common case rather than the rare one.
 */
export async function fetchFeed(symbols: string[], nowSec: number): Promise<Feed> {
  const quotes: Quote[] = [];
  for (const symbol of symbols) {
    let quote: Quote | null = null;
    try {
      quote = await fetchSymbol(symbol, nowSec);
    } catch {
      quote = null;
    }
    if (quote) {
      quote.series = downsample(quote.series, 48);
      // Over a multi-week window the zero line is where the window opened,
      // not yesterday's close — otherwise a stock that has climbed all
      // quarter draws almost entirely below its baseline and reads as red.
      quote.chartBase = quote.series.length > 0 ? quote.series[0] : quote.prevClose;
      await writeLastGood(quote, nowSec);
      quotes.push(quote);
      continue;
    }
    const stale = await readLastGood(symbol, nowSec);
    if (stale) quotes.push(stale);
  }

  if (quotes.length === 0) return { quotes: symbols.map(demoQuote), demo: true };
  return { quotes, demo: false };
}

/**
 * typeahead handler backing the symbol fields. Input is whatever the user
 * has typed; the display carries the instrument name so "AAPL" and
 * "AAPL34.SAO" are distinguishable in the picker.
 */
export async function searchSymbols(query: string): Promise<SchemaOption[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const res = await http.get(API_BASE, {
    params: { function: "SYMBOL_SEARCH", keywords: q, apikey: API_KEY },
    ttlSeconds: SEARCH_TTL,
  });
  const body = payload(res);
  if (!body) return [];

  const matches = (body["bestMatches"] as AvRecord[] | undefined) ?? [];
  const seen = new Set<string>();
  const out: SchemaOption[] = [];
  for (const row of matches) {
    const sym = row["1. symbol"] ? normaliseSymbol(row["1. symbol"]) : "";
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    const name = row["2. name"] ?? "";
    const region = row["4. region"] ? ` · ${row["4. region"]}` : "";
    out.push(
      schema.option({
        display: name ? `${sym} — ${name}${region}` : `${sym}${region}`,
        value: sym,
      }),
    );
    if (out.length >= 12) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Example data — shown when no symbol resolves, so an unconfigured or   */
/* rate-limited app looks like something in the gallery instead of an    */
/* error screen. Deterministic: same symbol always yields the same shape. */
/* ------------------------------------------------------------------ */

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function demoQuote(symbol: string): Quote {
  let s = seedOf(symbol) || 1;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const prevClose = 40 + rand() * 380;
  const drift = (rand() - 0.45) * 0.06;
  const vol = 0.3 + rand() * 0.9;
  const series: number[] = [];
  let v = prevClose;
  for (let i = 0; i < 48; i++) {
    v += (rand() - 0.5) * vol + drift;
    series.push(v);
  }
  const last = series[series.length - 1];
  return {
    symbol,
    last,
    prevClose,
    change: last - prevClose,
    changePct: ((last - prevClose) / prevClose) * 100,
    high: Math.max(...series),
    low: Math.min(...series),
    marketOpen: true,
    series,
    chartBase: series[0],
    ageSeconds: 0,
  };
}

/** Symbols to show when the user hasn't picked any yet. */
export function defaultSymbols(config: Config): string[] {
  const picked: string[] = [];
  for (let i = 1; i <= MAX_SYMBOLS; i++) {
    const v = config.get(`symbol_${i}`);
    if (v) {
      const sym = normaliseSymbol(v);
      if (sym && !picked.includes(sym)) picked.push(sym);
    }
  }
  return picked.length > 0 ? picked : ["AAPL", "NVDA", "MSFT"];
}

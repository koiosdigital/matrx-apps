/** Provider-neutral shapes. Swapping providers (or moving behind a Koios
 *  proxy) means reimplementing `api.ts` against these — nothing else. */

export interface Quote {
  symbol: string;
  /** Last traded price. */
  last: number;
  /** Previous session close — the baseline the chart is drawn against. */
  prevClose: number;
  /** Absolute change on the session. */
  change: number;
  /** Percent change on the session. */
  changePct: number;
  /** Session high/low, shown on 64x64 and taller. */
  high: number;
  low: number;
  /** True while the symbol's own exchange is open (crypto is always open). */
  marketOpen: boolean;
  /** Series closes, oldest first. Empty when the series call failed. */
  series: number[];
  /**
   * The chart's zero line — what `series` is plotted as a delta from, and
   * so what decides which parts of the sparkline draw green and which red.
   * It tracks the series' own span, not the session's: on a daily series
   * that is the first close in the window, on an intraday one it would be
   * `prevClose`. Distinct from `prevClose`, which stays the baseline for
   * the price odometer and the change figures no matter what is charted.
   */
  chartBase: number;
  /** Age of the data in seconds; drives the STALE banner. 0 when fresh. */
  ageSeconds: number;
}

/** What the render path needs regardless of where the numbers came from. */
export interface Feed {
  quotes: Quote[];
  /** True when no credential resolved — renders the labelled example card. */
  demo: boolean;
}

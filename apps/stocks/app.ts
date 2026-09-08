/**
 * Stocks — one symbol at a time on small panels, the whole watchlist on
 * large ones.
 *
 * A 64x32 panel can hold six numbers badly or one number well, and the
 * panel's real advantage is that it is ambient: you glance at it. So each
 * symbol owns the screen for a 50-frame slot — the chart draws itself in,
 * the price rolls up from the previous close, the card slides away — and
 * the loop brings the next one round. 128x64 has room for everything at
 * once, so it doesn't cycle at all.
 *
 * Loop length is `symbols x 50`, capped at six symbols (300 frames / 18s,
 * about as long as a device will dwell on one app).
 *
 * Data comes from `api.ts` and nothing else in this app knows the
 * provider — see the note there about moving behind a Koios proxy.
 */

import {
  Box,
  Column,
  Config,
  Padding,
  Root,
  Row,
  Sequence,
  Stack,
  Text,
  WrappedText,
  schema,
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import { MAX_SYMBOLS, defaultSymbols, fetchFeed, searchSymbols } from "./api";
import { board } from "./board";
import {
  SLIDE_FRAMES,
  SLOT_FRAMES,
  animatedCard,
  moverFlash,
  slide,
  staticCard,
  type CardOpts,
} from "./card";
import { palette } from "./palette";
import type { Quote } from "./types";

const FRAME_DELAY_MS = 60;
/** Quotes move faster than the render cadence; keep the app short-lived. */
const MAX_AGE = 120;

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();
  const redUp = config.str("up_color", "green") === "red";
  const moverThreshold = Math.max(0, config.int("mover_threshold", 3));

  const symbols = defaultSymbols(config).slice(0, MAX_SYMBOLS);
  const nowSec = time.now().unix;
  const feed = await fetchFeed(symbols, nowSec);

  if (feed.quotes.length === 0) {
    return Root({
      child: Padding({
        pad: 2,
        child: WrappedText({
          content: "No symbols — add one in settings",
          width: width - 4,
          color: "#8A9A93",
        }),
      }),
    });
  }

  // Muted whenever nothing on screen is live: every market closed, or the
  // whole feed is a fallback. A bright panel at 2am is a lie about liveness.
  const anyOpen = feed.quotes.some((q) => q.marketOpen && q.ageSeconds < 600);
  const pal = palette(redUp, !anyOpen);

  if (width >= 128 && height >= 64) {
    const label = feed.demo ? "EXAMPLE" : time.now().format("15:04");
    return Root({
      delay: FRAME_DELAY_MS,
      maxAge: MAX_AGE,
      child: Stack({
        children: [
          Box({ color: pal.ground }),
          board(feed.quotes, pal, width, height, label),
        ],
      }),
    });
  }

  const opts: CardOpts = { width, height, pal, muted: !anyOpen, demo: feed.demo };
  const cycle = cardCycle(feed.quotes, opts, moverThreshold);

  return Root({
    delay: FRAME_DELAY_MS,
    maxAge: MAX_AGE,
    child: Stack({ children: [Box({ color: pal.ground }), cycle] }),
  });
}

/**
 * Slots joined end to end. Sequence gives each child a frame index that
 * restarts at zero, which is what lets every slot replay its own draw-on.
 *
 * The last slot slides into the first, so frame N-1 hands off to frame 0
 * exactly the way every other boundary does and the loop seam disappears.
 */
function cardCycle(quotes: Quote[], o: CardOpts, moverThreshold: number): WidgetSpec {
  if (quotes.length === 1) {
    const q = quotes[0];
    const flash = moverFlash(q, o, moverThreshold);
    const body = animatedCard(q, o);
    return Sequence({
      children: [flash ? Stack({ children: [body, flash] }) : body],
      duration: SLOT_FRAMES,
    });
  }

  const children: WidgetSpec[] = [];
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const next = quotes[(i + 1) % quotes.length];
    const flash = moverFlash(q, o, moverThreshold);
    const body = animatedCard(q, o);
    children.push(flash ? Stack({ children: [body, flash] }) : body);
    children.push(slide(q, next, o));
  }
  return Sequence({ children, duration: quotes.length * SLOT_FRAMES });
}

/** typeahead handler — named export so the host can find it. */
export async function symbolSearch(query: string): Promise<SchemaOption[]> {
  return searchSymbols(query);
}

/**
 * Six typeahead slots rather than one multi-select: `schema.multiSelect`
 * takes a fixed option list and cannot search, and a watchlist can't be
 * enumerated ahead of time. Each slot is revealed only once the one before
 * it is filled, so a new install shows a single search box, not six.
 */
export function getSchema(): Schema {
  const fields = [];
  for (let i = 1; i <= MAX_SYMBOLS; i++) {
    fields.push(
      schema.typeahead({
        id: `symbol_${i}`,
        name: i === 1 ? "Symbol" : `Symbol ${i}`,
        desc:
          i === 1
            ? "Search for a ticker, fund or crypto pair."
            : `Optional. Shown for ${SLOT_FRAMES * FRAME_DELAY_MS / 1000}s each in rotation.`,
        icon: "chartLine",
        handler: "symbolSearch",
        ...(i > 1
          ? {
              visibility: {
                type: "invisible" as const,
                condition: {
                  variable: `symbol_${i - 1}`,
                  type: "eq" as const,
                  value: "",
                },
              },
            }
          : {}),
      }),
    );
  }

  fields.push(
    schema.dropdown({
      id: "up_color",
      name: "Rising prices",
      desc: "Green up is the Western convention; red up is standard in Japan, Korea and China.",
      icon: "palette",
      default: "green",
      options: [
        schema.option({ display: "Green", value: "green" }),
        schema.option({ display: "Red", value: "red" }),
      ],
    }),
    schema.dropdown({
      id: "mover_threshold",
      name: "Flash big moves",
      desc: "Percent change past which a card flashes its edges once as it arrives.",
      icon: "bolt",
      default: "3",
      options: [
        schema.option({ display: "Off", value: "999" }),
        schema.option({ display: "2%", value: "2" }),
        schema.option({ display: "3%", value: "3" }),
        schema.option({ display: "5%", value: "5" }),
      ],
    }),
  );

  return schema.schema({ version: "1", fields });
}

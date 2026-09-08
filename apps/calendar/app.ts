/**
 * Calendar — what's next, one event at a time.
 *
 * Every provider is reached the same way: a published iCal (.ics) URL.
 * Apple, Google and Microsoft all expose one, so the provider dropdown
 * changes the instructions rather than the protocol — there is a single
 * parser and a single fetch behind all of them. That also means no OAuth
 * to connect and no token to refresh.
 *
 * The `provider` dropdown drives a `generated` field that emits the URL
 * input with provider-specific help, the same pattern chargepoint uses.
 *
 * Loop is `events x 30` frames at 100ms, capped at five events.
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
  Transformation,
  WrappedText,
  animation,
  schema,
  type RootSpec,
  type Schema,
  type SchemaField,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http, time } from "@koiosdigital/matrx-sdk/stdlib";

import { parseIcs } from "./ics";
import { GOOGLE, MICROSOFT, exchangeCode } from "./oauth";
import { fetchGoogle, fetchMicrosoft } from "./remote";
import type { Event } from "./types";

const FRAME_DELAY_MS = 100;
const MAX_AGE = 600;
const TTL_SECONDS = 300;
const SLOT_FRAMES = 30;
const SLIDE_FRAMES = 6;
const MAX_EVENTS = 5;
const HORIZON_SECONDS = 7 * 86400;

const GROUND = "#04060A";
const INK = "#EDF1F6";
const INK2 = "#93A0B2";
const INK3 = "#4E5768";
const ACCENT = "#E0AE5C";
const NOW_COLOR = "#3DE0A0";
const SOON = "#FF9E4F";

interface Provider {
  id: string;
  label: string;
  /** "oauth" connects an account; "ical" takes a published feed URL. */
  kind: "oauth" | "ical";
  help: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "google",
    label: "Google Calendar",
    kind: "oauth",
    help: "Connect your Google account. Read-only access to your calendar; you can revoke it any time from your Google account settings.",
  },
  {
    id: "microsoft",
    label: "Microsoft Outlook",
    kind: "oauth",
    help: "Connect your Microsoft account. Read-only access to your calendar.",
  },
  {
    id: "apple",
    label: "Apple iCloud",
    kind: "ical",
    help: "iCloud has no public calendar API, so this uses a shared link. In Calendar on Mac, right-click the calendar, Share Calendar, tick Public Calendar and copy the link (webcal:// is fine).",
  },
  {
    id: "other",
    label: "Other iCal feed",
    kind: "ical",
    help: "Any published .ics URL. Only the calendar hosts this app already uses are reachable - a feed on another host is refused before the request leaves the device.",
  },
];

function providerById(id: string): Provider {
  for (const p of PROVIDERS) if (p.id === id) return p;
  return PROVIDERS[PROVIDERS.length - 1];
}

/** `webcal://` is just https with a scheme that opens a calendar app. */
function normaliseUrl(raw: string): string {
  const u = raw.trim();
  if (u.toLowerCase().startsWith("webcal://")) return `https://${u.slice(9)}`;
  return u;
}

const DEMO: Event[] = [];

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();
  const tz = config.str("timezone", "") || "UTC";
  const provider = providerById(config.str("provider", "google"));
  const nowSec = time.now().unix;

  let events: Event[] = DEMO;
  let problem = "";

  if (provider.kind === "oauth") {
    const refresh = config.str("auth", "");
    if (!refresh) {
      problem = `CONNECT YOUR ${provider.label.toUpperCase()} ACCOUNT IN SETTINGS`;
    } else {
      let fetched: Event[] | null = null;
      try {
        fetched =
          provider.id === "google"
            ? await fetchGoogle(refresh, nowSec, HORIZON_SECONDS, tz, MAX_EVENTS)
            : await fetchMicrosoft(refresh, nowSec, HORIZON_SECONDS, MAX_EVENTS);
      } catch {
        fetched = null;
      }
      // A null here means the refresh token no longer works, which the user
      // can only fix by reconnecting — say that rather than "unavailable".
      if (fetched === null) problem = "RECONNECT YOUR ACCOUNT IN SETTINGS";
      else if (fetched.length === 0) problem = "NOTHING IN THE NEXT 7 DAYS";
      else events = fetched;
    }
  } else {
    const url = normaliseUrl(config.str("url", ""));
    if (!url) {
      problem = "ADD YOUR CALENDAR URL IN SETTINGS";
    } else {
      try {
        const res = await http.get(url, { ttlSeconds: TTL_SECONDS });
        if (res.status === 200) {
          events = parseIcs(res.body(), nowSec, tz, HORIZON_SECONDS, MAX_EVENTS);
          if (events.length === 0) problem = "NOTHING IN THE NEXT 7 DAYS";
        } else {
          problem = `CALENDAR RETURNED ${res.status}`;
        }
      } catch {
        problem = "COULD NOT REACH THE CALENDAR";
      }
    }
  }

  if (problem) {
    return Root({
      maxAge: MAX_AGE,
      child: Stack({ children: [Box({ color: GROUND }), notice(problem, width)] }),
    });
  }

  const slots = events.map((e, i) => card(e, i, events.length, nowSec, tz, width, height));

  return Root({
    delay: FRAME_DELAY_MS,
    maxAge: MAX_AGE,
    child: Stack({ children: [Box({ color: GROUND }), cycle(slots, height)] }),
  });
}

function cycle(slots: WidgetSpec[], height: number): WidgetSpec {
  if (slots.length === 1) return slots[0];
  const children: WidgetSpec[] = [];
  for (let i = 0; i < slots.length; i++) {
    children.push(hold(slots[i], SLOT_FRAMES - SLIDE_FRAMES));
    children.push(slide(slots[i], slots[(i + 1) % slots.length], height));
  }
  return Sequence({ children, duration: slots.length * SLOT_FRAMES });
}

function hold(child: WidgetSpec, frames: number): WidgetSpec {
  return Transformation({
    child,
    duration: Math.max(1, frames),
    keyframes: [
      animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, 0)] }),
      animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, 0)] }),
    ],
  });
}

function slide(from: WidgetSpec, to: WidgetSpec, height: number): WidgetSpec {
  const leg = (child: WidgetSpec, a: number, b: number): WidgetSpec =>
    Transformation({
      child,
      duration: SLIDE_FRAMES,
      keyframes: [
        animation.Keyframe({ percentage: 0, transforms: [animation.Translate(0, a)], curve: "ease_in_out" }),
        animation.Keyframe({ percentage: 1, transforms: [animation.Translate(0, b)], curve: "ease_in_out" }),
      ],
      fillMode: "forwards",
    });
  return Stack({ children: [leg(from, 0, -height), leg(to, height, 0)] });
}

function notice(text: string, width: number): WidgetSpec {
  return Column({
    children: [
      Padding({
        pad: { left: 2, top: 1, right: 2, bottom: 0 },
        child: Text({ content: "CALENDAR", font: "tom-thumb", color: ACCENT }),
      }),
      Box({ width, height: 1, color: "#161C26" }),
      Padding({
        pad: { left: 2, top: 3, right: 2, bottom: 0 },
        child: WrappedText({ content: text, font: "tom-thumb", width: width - 4, color: INK2, lineSpacing: 1 }),
      }),
    ],
  });
}

/** "9:30A" — the meridiem costs four pixels instead of eight. */
function clock(sec: number, tz: string): string {
  return time.fromUnix(sec).inLocation(tz).format("3:04PM").replace("AM", "A").replace("PM", "P");
}

/** How far off it is, in the fewest characters that stay unambiguous. */
function relative(e: Event, nowSec: number, tz: string): { text: string; color: string } {
  if (nowSec >= e.start && nowSec < e.end) return { text: "NOW", color: NOW_COLOR };
  const delta = e.start - nowSec;
  if (delta < 0) return { text: "ENDED", color: INK3 };
  if (delta < 3600) return { text: `IN ${Math.max(1, Math.round(delta / 60))}M`, color: SOON };
  if (delta < 6 * 3600) return { text: `IN ${Math.round(delta / 3600)}H`, color: SOON };
  const day = time.fromUnix(e.start).inLocation(tz);
  const today = time.fromUnix(nowSec).inLocation(tz);
  const sameDay = day.format("2006-01-02") === today.format("2006-01-02");
  if (sameDay) return { text: "TODAY", color: ACCENT };
  const tomorrow = time.fromUnix(nowSec + 86400).inLocation(tz);
  if (day.format("2006-01-02") === tomorrow.format("2006-01-02")) {
    return { text: "TOMORROW", color: ACCENT };
  }
  return { text: day.format("Mon 2").toUpperCase(), color: ACCENT };
}

function card(
  e: Event,
  index: number,
  total: number,
  nowSec: number,
  tz: string,
  width: number,
  height: number,
): WidgetSpec {
  const wide = width >= 128;
  const font = wide ? "5x8" : "tom-thumb";
  const lineH = wide ? 8 : 6;
  const charW = wide ? 5 : 4;
  const rel = relative(e, nowSec, tz);
  const when = e.allDay ? "ALL DAY" : `${clock(e.start, tz)}-${clock(e.end, tz)}`;

  // Header, rule, when-line, and the body's own padding.
  const chrome = 7 + 1 + 1 + lineH + 2;
  const lines = Math.max(1, Math.floor((height - chrome) / (lineH + 1)));
  const perLine = Math.max(4, Math.floor((width - 4) / charW));

  const block = Column({
    children: [
      Padding({
        pad: { left: 2, top: 1, right: 2, bottom: 0 },
        child: Row({
          expanded: true,
          mainAlign: "space_between",
          children: [
            Text({ content: rel.text, font: "tom-thumb", color: rel.color }),
            total > 1
              ? Text({ content: `${index + 1}/${total}`, font: "tom-thumb", color: INK3 })
              : Box({ width: 1, height: 1 }),
          ],
        }),
      }),
      Box({ width, height: 1, color: "#161C26" }),
      Box({ height: 1 }),
      Padding({
        pad: { left: 2, top: 0, right: 2, bottom: 0 },
        child: Text({ content: when, font, color: INK2 }),
      }),
      Padding({
        pad: { left: 2, top: 2, right: 2, bottom: 0 },
        child: WrappedText({
          content: fitLines(e.summary, perLine, lines),
          font,
          width: width - 4,
          color: INK,
          lineSpacing: 1,
        }),
      }),
    ],
  });
  // A tall panel would otherwise leave the card hugging the top edge.
  return height < 64 ? block : Column({ expanded: true, mainAlign: "center", children: [block] });
}

/**
 * Truncate so the renderer's own word wrap lands within `maxLines`. Both
 * faces used here are monospace, so a character count is the pixel width
 * and this matches the renderer exactly.
 */
export function fitLines(text: string, perLine: number, maxLines: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > perLine) {
      if (line) {
        out.push(line);
        line = "";
      }
      let rest = word;
      while (rest.length > perLine && out.length < maxLines) {
        out.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      line = rest;
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length >= maxLines) break;
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length <= maxLines) return out.join(" ");
  const kept = out.slice(0, maxLines);
  const last = kept[kept.length - 1];
  kept[kept.length - 1] =
    last.length >= perLine ? `${last.slice(0, Math.max(0, perLine - 1))}…` : `${last}…`;
  return kept.join(" ");
}

/**
 * generated handler: emits whatever the chosen provider actually needs —
 * an OAuth connect button for Google and Microsoft, a URL box for Apple and
 * raw feeds. Input is the current value of the source field.
 *
 * Both branches write to a stable field id (`auth` / `url`) so the render
 * path reads one key regardless of how the user got there.
 */
export function providerFields(provider: string): SchemaField[] {
  const p = providerById(provider || "google");
  if (p.kind === "oauth") {
    const o = p.id === "google" ? GOOGLE : MICROSOFT;
    return [
      schema.oauth2({
        id: "auth",
        name: `${p.label} account`,
        desc: p.help,
        icon: "calendar",
        handler: p.id === "google" ? "googleAuthHandler" : "microsoftAuthHandler",
        clientId: o.clientId,
        authorizationEndpoint: o.authorizationEndpoint,
        scopes: o.scopes,
        pkce: true,
      }),
    ];
  }
  return [schema.text({ id: "url", name: "Calendar URL", desc: p.help, icon: "link" })];
}

/** oauth2 handlers — named exports so the host can find them. */
export async function googleAuthHandler(params: string): Promise<string> {
  return exchangeCode(GOOGLE, params);
}

export async function microsoftAuthHandler(params: string): Promise<string> {
  return exchangeCode(MICROSOFT, params);
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "provider",
        name: "Calendar provider",
        desc: "Google and Microsoft connect your account directly. Apple and other calendars use a published iCal link.",
        icon: "calendar",
        default: "google",
        options: PROVIDERS.map((p) => schema.option({ display: p.label, value: p.id })),
      }),
      schema.generated({
        id: "generated",
        source: "provider",
        handler: "providerFields",
      }),
      schema.text({
        id: "timezone",
        name: "Timezone",
        desc: "IANA name, e.g. America/New_York. Used for events that carry no timezone of their own.",
        icon: "globe",
      }),
    ],
  });
}

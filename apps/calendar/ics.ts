/**
 * iCalendar (RFC 5545) reader — the subset a display panel needs.
 *
 * This is deliberately a subset. It reads VEVENTs, resolves their start and
 * end in the right timezone, expands the common recurrence rules, and drops
 * anything it cannot understand rather than throwing. What it does NOT do
 * is claim to be a calendar engine: BYMONTHDAY, BYSETPOS, BYWEEKNO and
 * per-instance overrides beyond simple cancellation are not handled, and a
 * feed leaning on those will show its base occurrences instead.
 *
 * Timezones are handled properly rather than approximated: TZID values go
 * through the SDK's `time.time({... location})`, which resolves real IANA
 * rules, so a recurring event keeps its wall-clock time across a DST change.
 */

import { time } from "@koiosdigital/matrx-sdk/stdlib";

import { addMonths, civilFromDays, daysFromCivil, weekdayFromDays, type Civil } from "./civil";
import type { Event } from "./types";

/** Guard against a pathological RRULE spinning the isolate. */
const MAX_OCCURRENCES = 400;

/** Unfold continuation lines (RFC 5545 §3.1: leading space or tab). */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** `DTSTART;TZID=America/New_York:20260819T100000` */
function parseProp(line: string): Prop | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** The first colon outside a quoted parameter value. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) return i;
  }
  return -1;
}

/** RFC 5545 §3.3.11 TEXT escaping. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

interface Stamp {
  sec: number;
  allDay: boolean;
  civil: Civil;
  hour: number;
  minute: number;
  second: number;
  tz: string;
}

/**
 * Resolve a DATE or DATE-TIME to an instant.
 *
 * Three forms appear in the wild: a bare date (all-day), a UTC instant
 * ending in Z, and a wall time qualified by TZID. A wall time with no TZID
 * is "floating" and is interpreted in the viewer's timezone, which is what
 * the spec intends and what a user expects on a clock in their kitchen.
 */
function parseStamp(prop: Prop, defaultTz: string): Stamp | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params["VALUE"] === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const civil = { year: +m[1], month: +m[2], day: +m[3] };
    const t = time.time({ ...civil, hour: 0, minute: 0, second: 0, location: defaultTz });
    return { sec: t.unix, allDay: true, civil, hour: 0, minute: 0, second: 0, tz: defaultTz };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  const civil = { year: +dt[1], month: +dt[2], day: +dt[3] };
  const hour = +dt[4];
  const minute = +dt[5];
  const second = +dt[6];
  const tz = dt[7] ? "UTC" : prop.params["TZID"] || defaultTz;
  const t = time.time({ ...civil, hour, minute, second, location: tz });
  return { sec: t.unix, allDay: false, civil, hour, minute, second, tz };
}

const BYDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface Rule {
  freq: string;
  interval: number;
  count: number;
  until: number;
  byday: number[];
}

function parseRule(value: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1);
  }
  const freq = (parts["FREQ"] ?? "").toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  let until = 0;
  if (parts["UNTIL"]) {
    const u = parseStamp({ name: "UNTIL", params: {}, value: parts["UNTIL"] }, "UTC");
    if (u) until = u.sec;
  }
  const byday: number[] = [];
  for (const token of (parts["BYDAY"] ?? "").split(",")) {
    // Ordinal prefixes (2MO, -1FR) are out of scope; take the weekday and
    // let the base occurrence stand rather than inventing a wrong date.
    const key = token.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (key in BYDAY_INDEX && !/-?\d/.test(token)) byday.push(BYDAY_INDEX[key]);
  }
  return {
    freq,
    interval: Math.max(1, parseInt(parts["INTERVAL"] ?? "1", 10) || 1),
    count: Math.max(0, parseInt(parts["COUNT"] ?? "0", 10) || 0),
    until,
    byday,
  };
}

/** Rebuild an instant at the original wall time on a different civil date. */
function at(civil: Civil, s: Stamp): number {
  return time.time({
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: s.hour,
    minute: s.minute,
    second: s.second,
    location: s.tz,
  }).unix;
}

/**
 * Expand a rule into start instants inside [from, to]. Steps the civil
 * date and rebuilds the wall time each turn, so DST transitions do not
 * drag the event an hour either way.
 */
function expand(start: Stamp, rule: Rule, from: number, to: number): number[] {
  const out: number[] = [];
  let emitted = 0;
  let cursor = start.civil;

  for (let step = 0; step < MAX_OCCURRENCES; step++) {
    if (rule.freq === "WEEKLY" && rule.byday.length > 0) {
      // Walk the week the cursor sits in and emit each listed weekday.
      const cursorDays = daysFromCivil(cursor.year, cursor.month, cursor.day);
      const sunday = cursorDays - weekdayFromDays(cursorDays);
      for (const wd of rule.byday) {
        const civil = civilFromDays(sunday + wd);
        const sec = at(civil, start);
        if (sec < start.sec) continue;
        if (rule.until && sec > rule.until) return out;
        if (sec >= from && sec <= to) out.push(sec);
        emitted++;
        if (rule.count && emitted >= rule.count) return out;
      }
    } else {
      const sec = at(cursor, start);
      if (rule.until && sec > rule.until) return out;
      if (sec >= from && sec <= to) out.push(sec);
      emitted++;
      if (rule.count && emitted >= rule.count) return out;
    }

    if (at(cursor, start) > to) return out;

    if (rule.freq === "DAILY") {
      cursor = civilFromDays(daysFromCivil(cursor.year, cursor.month, cursor.day) + rule.interval);
    } else if (rule.freq === "WEEKLY") {
      cursor = civilFromDays(daysFromCivil(cursor.year, cursor.month, cursor.day) + 7 * rule.interval);
    } else if (rule.freq === "MONTHLY") {
      cursor = addMonths(cursor, rule.interval);
    } else {
      cursor = addMonths(cursor, 12 * rule.interval);
    }
  }
  return out;
}

/**
 * Every event overlapping [nowSec, nowSec + horizonSec], soonest first.
 * In-progress events are kept: "what am I in right now" is as useful as
 * "what is next".
 */
export function parseIcs(
  text: string,
  nowSec: number,
  defaultTz: string,
  horizonSec: number,
  limit: number,
): Event[] {
  const lines = unfold(text);
  const events: Event[] = [];
  const to = nowSec + horizonSec;

  let inEvent = false;
  let dtstart: Stamp | null = null;
  let dtend: Stamp | null = null;
  let summary = "";
  let rrule: Rule | null = null;
  let cancelled = false;
  let exdates: number[] = [];

  const flush = () => {
    if (!dtstart) return;
    const duration = Math.max(0, (dtend?.sec ?? dtstart.sec + (dtstart.allDay ? 86400 : 1800)) - dtstart.sec);
    const starts = rrule ? expand(dtstart, rrule, nowSec - duration, to) : [dtstart.sec];
    for (const s of starts) {
      if (exdates.includes(s)) continue;
      const e = s + duration;
      // Overlap test, not a start test — a meeting you are inside still counts.
      if (e < nowSec || s > to) continue;
      events.push({ start: s, end: e, allDay: dtstart.allDay, summary: summary || "(no title)" });
    }
  };

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      dtstart = null;
      dtend = null;
      summary = "";
      rrule = null;
      cancelled = false;
      exdates = [];
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (inEvent && !cancelled) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const prop = parseProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case "DTSTART":
        dtstart = parseStamp(prop, defaultTz);
        break;
      case "DTEND":
        dtend = parseStamp(prop, defaultTz);
        break;
      case "SUMMARY":
        summary = unescapeText(prop.value);
        break;
      case "RRULE":
        rrule = parseRule(prop.value);
        break;
      case "STATUS":
        if (prop.value.trim().toUpperCase() === "CANCELLED") cancelled = true;
        break;
      case "EXDATE": {
        for (const piece of prop.value.split(",")) {
          const ex = parseStamp({ name: "EXDATE", params: prop.params, value: piece }, defaultTz);
          if (ex) exdates.push(ex.sec);
        }
        break;
      }
      default:
        break;
    }
  }

  events.sort((a, b) => a.start - b.start || a.end - b.end);
  // Recurrences from different rules can land on the same instant.
  const seen = new Set<string>();
  const unique: Event[] = [];
  for (const e of events) {
    const key = `${e.start}:${e.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
    if (unique.length >= limit) break;
  }
  return unique;
}

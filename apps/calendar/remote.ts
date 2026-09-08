/**
 * The OAuth-backed calendar APIs.
 *
 * Both providers expand recurrences server-side — Google via
 * `singleEvents=true`, Microsoft via `calendarView` — so the RRULE engine
 * in `ics.ts` never runs on these paths. It exists for Apple and raw iCal
 * feeds, which hand over the rules unexpanded.
 */

import { http, time } from "@koiosdigital/matrx-sdk/stdlib";

import { GOOGLE, MICROSOFT, accessToken } from "./oauth";
import type { Event } from "./types";

const GOOGLE_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GRAPH_API = "https://graph.microsoft.com/v1.0/me/calendarView";
const TTL_SECONDS = 300;

/** RFC3339 in UTC, which both APIs accept for their window bounds. */
function rfc3339(sec: number): string {
  return time.fromUnix(sec).inLocation("UTC").format("2006-01-02T15:04:05Z");
}

const parseInstant = (s: string | undefined): number => {
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

interface GoogleItem {
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export async function fetchGoogle(
  refreshToken: string,
  nowSec: number,
  horizonSec: number,
  tz: string,
  limit: number,
): Promise<Event[] | null> {
  const token = await accessToken(GOOGLE, refreshToken);
  if (!token) return null;

  const res = await http.get(GOOGLE_API, {
    params: {
      timeMin: rfc3339(nowSec),
      timeMax: rfc3339(nowSec + horizonSec),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(Math.max(limit, 10)),
      timeZone: tz,
    },
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    ttlSeconds: TTL_SECONDS,
  });
  if (res.status !== 200) return null;

  const body = res.json() as { items?: GoogleItem[] };
  const out: Event[] = [];
  for (const item of body.items ?? []) {
    if (item.status === "cancelled") continue;
    const allDay = !item.start?.dateTime;
    // All-day events carry a bare date; anchor it in the display timezone
    // so "today" means the viewer's today.
    const start = allDay ? dayStart(item.start?.date, tz) : parseInstant(item.start?.dateTime);
    const end = allDay ? dayStart(item.end?.date, tz) : parseInstant(item.end?.dateTime);
    if (!start) continue;
    out.push({
      start,
      end: end || start + (allDay ? 86400 : 1800),
      allDay,
      summary: (item.summary ?? "(no title)").trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function dayStart(date: string | undefined, tz: string): number {
  if (!date) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  return time.time({ year: +m[1], month: +m[2], day: +m[3], hour: 0, minute: 0, location: tz }).unix;
}

interface GraphItem {
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

export async function fetchMicrosoft(
  refreshToken: string,
  nowSec: number,
  horizonSec: number,
  limit: number,
): Promise<Event[] | null> {
  const token = await accessToken(MICROSOFT, refreshToken);
  if (!token) return null;

  const res = await http.get(GRAPH_API, {
    params: {
      startDateTime: rfc3339(nowSec),
      endDateTime: rfc3339(nowSec + horizonSec),
      $orderby: "start/dateTime",
      $top: String(Math.max(limit, 10)),
    },
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Without this Graph returns wall times in the mailbox timezone with
      // no offset, which is unparseable as an instant.
      Prefer: 'outlook.timezone="UTC"',
    },
    ttlSeconds: TTL_SECONDS,
  });
  if (res.status !== 200) return null;

  const body = res.json() as { value?: GraphItem[] };
  const out: Event[] = [];
  for (const item of body.value ?? []) {
    if (item.isCancelled) continue;
    // Graph omits the zone designator even when the value is UTC.
    const start = parseInstant(withZone(item.start?.dateTime));
    const end = parseInstant(withZone(item.end?.dateTime));
    if (!start) continue;
    out.push({
      start,
      end: end || start + 1800,
      allDay: item.isAllDay === true,
      summary: (item.subject ?? "(no title)").trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function withZone(s: string | undefined): string | undefined {
  if (!s) return s;
  return /[Z+]|-\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
}

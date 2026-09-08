/**
 * ESPN scoreboard client.
 *
 * These endpoints power espn.com and need no key or signup, but they are
 * undocumented: ESPN can change or withdraw them without notice, and there
 * is no published rate limit. That is an accepted risk for a display app —
 * the failure mode is a panel that says NO GAMES rather than a wrong score
 * — but it is the reason every field below is read defensively and the
 * last good payload is cached.
 *
 * Every league path here was fetched and confirmed to return events.
 */

import { cache, http } from "@koiosdigital/matrx-sdk/stdlib";

const API = "https://site.api.espn.com/apis/site/v2/sports";
const UA = "matrx-sports (koiosdigital.net)";

/** Live scores go stale fast; everything else barely moves. */
const LIVE_TTL = 60;
const TEAMS_TTL = 86400;
const LAST_GOOD_TTL = 21600;

export interface League {
  id: string;
  label: string;
  /** ESPN's `{sport}/{league}` path segment. */
  path: string;
}

export const LEAGUES: League[] = [
  { id: "mlb", label: "MLB", path: "baseball/mlb" },
  { id: "nfl", label: "NFL", path: "football/nfl" },
  { id: "nba", label: "NBA", path: "basketball/nba" },
  { id: "nhl", label: "NHL", path: "hockey/nhl" },
  { id: "wnba", label: "WNBA", path: "basketball/wnba" },
  { id: "ncaaf", label: "College Football", path: "football/college-football" },
  { id: "ncaab", label: "College Basketball", path: "basketball/mens-college-basketball" },
  { id: "mls", label: "MLS", path: "soccer/usa.1" },
  { id: "epl", label: "Premier League", path: "soccer/eng.1" },
];

export function leagueById(id: string): League {
  for (const l of LEAGUES) if (l.id === id) return l;
  return LEAGUES[0];
}

/** pre = not started, in = playing, post = done. */
export type GameState = "pre" | "in" | "post";

export interface Game {
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
  state: GameState;
  /** "Final", "Top 3rd", "7:05 PM" — ESPN's own short form. */
  detail: string;
  /** Kickoff, as unix seconds. 0 when unparseable. */
  startSec: number;
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { abbreviation?: string };
}

interface EspnEvent {
  date?: string;
  competitions?: {
    competitors?: EspnCompetitor[];
    status?: { type?: { state?: string; shortDetail?: string; description?: string } };
  }[];
}

function toState(raw: string | undefined): GameState {
  if (raw === "in") return "in";
  if (raw === "post") return "post";
  return "pre";
}

function flatten(body: { events?: EspnEvent[] }): Game[] {
  const out: Game[] = [];
  for (const event of body.events ?? []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const away = (comp.competitors ?? []).find((c) => c.homeAway === "away");
    const home = (comp.competitors ?? []).find((c) => c.homeAway === "home");
    if (!away || !home) continue;
    const ms = event.date ? Date.parse(event.date) : NaN;
    out.push({
      awayAbbr: (away.team?.abbreviation ?? "???").slice(0, 4).toUpperCase(),
      homeAbbr: (home.team?.abbreviation ?? "???").slice(0, 4).toUpperCase(),
      awayScore: Number(away.score ?? 0) || 0,
      homeScore: Number(home.score ?? 0) || 0,
      state: toState(comp.status?.type?.state),
      detail: (comp.status?.type?.shortDetail ?? comp.status?.type?.description ?? "").slice(0, 16),
      startSec: Number.isFinite(ms) ? Math.floor(ms / 1000) : 0,
    });
  }
  return out;
}

/**
 * Today's slate, ordered so the interesting games come first: in progress,
 * then upcoming, then finals. A panel that leads with a game that ended
 * four hours ago is showing the least useful thing it has.
 */
export async function fetchGames(league: League, nowSec: number): Promise<Game[] | null> {
  let games: Game[] | null = null;
  try {
    const res = await http.get(`${API}/${league.path}/scoreboard`, {
      headers: { "User-Agent": UA },
      ttlSeconds: LIVE_TTL,
    });
    if (res.status === 200) games = flatten(res.json() as { events?: EspnEvent[] });
  } catch {
    games = null;
  }

  if (games && games.length > 0) {
    await cache.set(`sb:${league.id}`, JSON.stringify(games), LAST_GOOD_TTL);
    return sortGames(games);
  }
  if (games) return games; // a genuinely empty slate is not a failure

  const raw = await cache.get(`sb:${league.id}`);
  if (raw) {
    try {
      return sortGames(JSON.parse(raw) as Game[]);
    } catch {
      return null;
    }
  }
  return null;
}

const RANK: Record<GameState, number> = { in: 0, pre: 1, post: 2 };

function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    const r = RANK[a.state] - RANK[b.state];
    return r !== 0 ? r : a.startSec - b.startSec;
  });
}

export interface Team {
  abbr: string;
  name: string;
}

/** Team directory, for the follow-a-team picker. */
export async function fetchTeams(league: League, query: string): Promise<Team[]> {
  const res = await http.get(`${API}/${league.path}/teams`, {
    headers: { "User-Agent": UA },
    ttlSeconds: TEAMS_TTL,
  });
  if (res.status !== 200) return [];
  const body = res.json() as {
    sports?: { leagues?: { teams?: { team?: { abbreviation?: string; displayName?: string } }[] }[] }[];
  };
  const rows = body.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const needle = query.trim().toLowerCase();
  const out: Team[] = [];
  for (const row of rows) {
    const abbr = row.team?.abbreviation;
    const name = row.team?.displayName;
    if (!abbr || !name) continue;
    if (needle && !name.toLowerCase().includes(needle) && !abbr.toLowerCase().includes(needle)) continue;
    out.push({ abbr: abbr.toUpperCase(), name });
    if (out.length >= 25) break;
  }
  return out;
}

/** Example slate for an unconfigured install and the gallery preview. */
export function demoGames(): Game[] {
  return [
    { awayAbbr: "NYY", homeAbbr: "BAL", awayScore: 3, homeScore: 1, state: "post", detail: "Final", startSec: 0 },
    { awayAbbr: "LAD", homeAbbr: "SF", awayScore: 2, homeScore: 2, state: "in", detail: "Top 7th", startSec: 0 },
    { awayAbbr: "CHC", homeAbbr: "STL", awayScore: 0, homeScore: 0, state: "pre", detail: "7:05 PM", startSec: 0 },
  ];
}

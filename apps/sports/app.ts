/**
 * Sports Scores — one game at a time.
 *
 * Away over home, scores right-aligned in a fixed column so the digits line
 * up between the two rows and between games. State is carried three ways —
 * the status text, the colour of the status, and a dot for a game actually
 * in progress — so a glance tells you whether this is live without reading.
 *
 * Loop is `games x 30` frames at 100ms, capped at five games (15s). With a
 * team followed there is exactly one slot and it holds the whole loop.
 */

import {
  Animation,
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
  animation,
  schema,
  type RootSpec,
  type Schema,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

import {
  LEAGUES,
  demoGames,
  fetchGames,
  fetchTeams,
  leagueById,
  type Game,
  type League,
} from "./espn";

const FRAME_DELAY_MS = 100;
const MAX_AGE = 120;
const SLOT_FRAMES = 30;
const SLIDE_FRAMES = 6;
const MAX_GAMES = 5;

const GROUND = "#04060A";
const INK = "#EDF1F6";
const INK2 = "#8E9AAC";
const INK3 = "#4E5768";
const ACCENT = "#E0AE5C";
const LIVE = "#3DE0A0";
const WIN = "#FFFFFF";

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();

  const league = leagueById(config.str("league", "mlb"));
  const follow = config.str("team", "").trim().toUpperCase();

  const nowSec = time.now().unix;
  const fetched = await fetchGames(league, nowSec);
  const demo = fetched === null;
  let games = fetched ?? demoGames();

  if (follow) {
    const mine = games.filter((g) => g.awayAbbr === follow || g.homeAbbr === follow);
    // Following a team that isn't playing should say so, not silently show
    // somebody else's game.
    if (mine.length > 0) games = mine;
    else return Root({ child: message(`${follow} NOT PLAYING TODAY`, league.label, width) });
  }

  if (games.length === 0) {
    return Root({ child: message("NO GAMES TODAY", league.label, width) });
  }

  const slots = games.slice(0, MAX_GAMES).map((g) => card(g, league, follow, demo, width, height));

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

function message(text: string, league: string, width: number): WidgetSpec {
  return Stack({
    children: [
      Box({ color: GROUND }),
      Column({
        children: [
          Padding({
            pad: { left: 2, top: 1, right: 2, bottom: 0 },
            child: Text({ content: league.toUpperCase(), font: "tom-thumb", color: ACCENT }),
          }),
          Box({ width, height: 1, color: "#161C26" }),
          Padding({
            pad: { left: 2, top: 4, right: 2, bottom: 0 },
            child: Text({ content: text, font: "tom-thumb", color: INK2 }),
          }),
        ],
      }),
    ],
  });
}

/**
 * A live game gets a blinking dot beside the status. It is the cheapest
 * possible "this is happening now" signal — a handful of 2px Box specs —
 * and it survives being seen from across a room, which the status text
 * does not.
 */
function liveDot(): WidgetSpec {
  const frames: WidgetSpec[] = [];
  for (let f = 0; f < SLOT_FRAMES; f++) {
    const on = f % 10 < 6;
    frames.push(Box({ width: 2, height: 2, color: on ? LIVE : "#00000000" }));
  }
  return Animation({ children: frames });
}

function teamRow(
  abbr: string,
  score: number,
  state: string,
  winning: boolean,
  followed: boolean,
  scoreFont: string,
  rowH: number,
  width: number,
): WidgetSpec {
  // Scores sit in a fixed-width cell so digits align between the two rows
  // and from one game to the next.
  const scoreCell = Math.max(18, Math.round(width * 0.28));
  const showScore = state !== "pre";
  return Padding({
    pad: { left: 2, top: 0, right: 2, bottom: 0 },
    child: Row({
      expanded: true,
      crossAlign: "center",
      mainAlign: "space_between",
      children: [
        Text({
          content: abbr,
          font: scoreFont,
          color: followed ? ACCENT : winning ? WIN : INK,
        }),
        Box({
          width: scoreCell,
          // Explicit height: a Box with height 0 expands to the remaining
          // bounds, which pushed the home row off the bottom of the panel.
          height: rowH,
          child: Row({
            expanded: true,
            mainAlign: "end",
            children: [
              Text({
                content: showScore ? String(score) : "-",
                font: scoreFont,
                color: showScore ? (winning ? WIN : INK2) : INK3,
              }),
            ],
          }),
        }),
      ],
    }),
  });
}

function card(
  g: Game,
  league: League,
  follow: string,
  demo: boolean,
  width: number,
  height: number,
): WidgetSpec {
  const scoreFont = height >= 64 ? "6x13" : "6x10";
  const rowH = height >= 64 ? 13 : 10;
  const done = g.state === "post";
  const live = g.state === "in";
  const awayWins = done && g.awayScore > g.homeScore;
  const homeWins = done && g.homeScore > g.awayScore;

  // A finished game still needs its status legible: INK3 on black is
  // effectively invisible at LED gamma.
  const statusColor = live ? LIVE : done ? "#6E7A8C" : INK2;
  const label = demo ? "EXAMPLE" : league.label.toUpperCase();
  // The top bar is shared: label, an optional live dot, and the status.
  // tom-thumb is 4px monospace, so this is an exact character budget.
  const budget = Math.max(4, Math.floor(((width - 4) - label.length * 4 - (live ? 4 : 0)) / 4) - 1);
  const detail = fitStatus(g.detail, budget);

  const block = Column({
    children: [
      Padding({
        pad: { left: 2, top: 1, right: 2, bottom: 0 },
        child: Row({
          expanded: true,
          mainAlign: "space_between",
          crossAlign: "center",
          children: [
            Text({ content: label, font: "tom-thumb", color: ACCENT }),
            Row({
              crossAlign: "center",
              // Falsy children are skipped by the builders. A zero-width
              // Box would EXPAND to the remaining bounds and push the
              // status clean off the panel.
              children: [
                live && liveDot(),
                live && Box({ width: 2, height: 1 }),
                Text({ content: detail, font: "tom-thumb", color: statusColor }),
              ],
            }),
          ],
        }),
      }),
      Box({ width, height: 1, color: "#161C26" }),
      Box({ height: 1 }),
      teamRow(g.awayAbbr, g.awayScore, g.state, awayWins, follow === g.awayAbbr, scoreFont, rowH, width),
      Box({ height: 1 }),
      teamRow(g.homeAbbr, g.homeScore, g.state, homeWins, follow === g.homeAbbr, scoreFont, rowH, width),
    ],
  });
  return centre(block, height);
}

/**
 * On a tall panel the card is far shorter than the canvas. Centring it
 * beats letting it hug the top edge with a dark half beneath.
 */
function centre(block: WidgetSpec, height: number): WidgetSpec {
  if (height < 64) return block;
  return Column({ expanded: true, mainAlign: "center", children: [block] });
}

/**
 * ESPN's short detail runs from "Final" to "Delayed, Bottom 9th". Uppercase
 * to match the rest of the panel, and clip to what the top bar can hold.
 */
function fitStatus(detail: string, budget: number): string {
  const s = detail.toUpperCase().trim();
  if (s.length <= budget) return s;
  return `${s.slice(0, Math.max(1, budget - 1))}…`;
}

/** typeahead handler for the follow-a-team field. */
export async function teamSearch(query: string, config: Config): Promise<SchemaOption[]> {
  const league = leagueById(config.str("league", "mlb"));
  const teams = await fetchTeams(league, query);
  return teams.map((t) => schema.option({ display: `${t.abbr} — ${t.name}`, value: t.abbr }));
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.dropdown({
        id: "league",
        name: "League",
        desc: "Which league's scoreboard to show.",
        icon: "trophy",
        default: "mlb",
        options: LEAGUES.map((l) => schema.option({ display: l.label, value: l.id })),
      }),
      schema.typeahead({
        id: "team",
        name: "Follow a team",
        desc: "Optional. Shows only this team's game, and says so when they aren't playing.",
        icon: "shield",
        handler: "teamSearch",
      }),
    ],
  });
}

/**
 * Word Clock — hand port of `wordclock/word_clock.star` (by Jeffrey
 * Lancaster), kept structurally line-for-line: same minute/hour/special
 * tables, random phrasing selection, military mode, time-of-day subtext and
 * Game of Thrones hours.
 *
 * Screen sizes: the vertical centering math uses the actual canvas height;
 * 128-wide panels step the main lines up to the 6x13 font.
 */

import {
  Column,
  Config,
  Padding,
  Root,
  Text,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

const DEFAULT_TIMEZONE = "US/Eastern";

// h is whether to use the subsequent hour word
// o is whether the text comes before (1) or after (2) the hour word
interface MinuteEntry {
  text: string[];
  h: number;
  o: number;
  military?: boolean;
}

function entry(text: string[], h: number, o: number, military = false): MinuteEntry {
  return { text, h, o, military };
}

/** Number words for the "past/after/til/to" phrasings. */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TENS_WORDS: Record<number, string> = {
  10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen",
  16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
};

function minuteWord(min: number): string {
  if (min < 10) return ONES[min];
  if (min < 20) return TENS_WORDS[min];
  const tens = ["twenty", "thirty", "forty", "fifty"][Math.floor(min / 10) - 2];
  return min % 10 === 0 ? tens : `${tens}-${ONES[min % 10]}`;
}

/** en-US minute table, generated to match the original's entries exactly. */
function buildMinutes(): Record<number, MinuteEntry[]> {
  const minutes: Record<number, MinuteEntry[]> = {};
  minutes[0] = [entry(["hundred"], 0, 2, true), entry(["o'clock"], 0, 2), entry([], 0, 1)];
  for (let m = 1; m <= 9; m++) {
    minutes[m] = [
      entry([`zero ${ONES[m]}`], 0, 2, true),
      entry([`oh ${ONES[m]}`], 0, 2),
      entry([ONES[m], "past"], 0, 1),
      entry([ONES[m], "after"], 0, 1),
    ];
  }
  for (let m = 10; m <= 59; m++) {
    minutes[m] = [entry([minuteWord(m)], 0, 2)];
  }
  minutes[10].push(entry(["ten", "past"], 0, 1), entry(["ten", "after"], 0, 1));
  minutes[15].push(entry(["quarter", "past"], 0, 1), entry(["quarter", "after"], 0, 1));
  minutes[30] = [entry(["thirty"], 0, 2), entry(["half", "past"], 0, 1), entry(["half"], 0, 1)];
  minutes[40].push(entry(["twenty", "til"], 1, 1), entry(["twenty", "to"], 1, 1));
  minutes[45].push(entry(["quarter", "til"], 1, 1), entry(["quarter", "to"], 1, 1));
  for (let m = 50; m <= 59; m++) {
    const remaining = minuteWord(60 - m);
    minutes[m].push(entry([remaining, "til"], 1, 1), entry([remaining, "to"], 1, 1));
  }
  return minutes;
}

const minutesObj = buildMinutes();

const timeOfDayObj: { hourMin: number; hourMax: number; text: string[][] }[] = [
  { hourMin: 0, hourMax: 12, text: [["in the", "morning"], ["AM"]] },
  { hourMin: 12, hourMax: 17, text: [["in the", "afternoon"], ["PM"]] },
  { hourMin: 17, hourMax: 21, text: [["in the", "evening"], ["PM"]] },
  { hourMin: 21, hourMax: 24, text: [["at night"], ["PM"]] },
];

const hoursObj: Record<number, string[]> = {
  0: ["twelve", "zero"],
  1: ["one"], 2: ["two"], 3: ["three"], 4: ["four"], 5: ["five"], 6: ["six"],
  7: ["seven"], 8: ["eight"], 9: ["nine"], 10: ["ten"], 11: ["eleven"], 12: ["twelve"],
  13: ["one", "thirteen"], 14: ["two", "fourteen"], 15: ["three", "fifteen"],
  16: ["four", "sixteen"], 17: ["five", "seventeen"], 18: ["six", "eighteen"],
  19: ["seven", "nineteen"], 20: ["eight", "twenty"], 21: ["nine", "twenty-one"],
  22: ["ten", "twenty-two"], 23: ["eleven", "twenty-three"],
};

const gameOfThronesObj: Record<number, string> = {
  0: "owl", 1: "owl", 2: "wolf", 3: "wolf", 4: "nightengale", 5: "nightengale",
  18: "bat", 19: "bat", 20: "eel", 21: "eel", 22: "ghosts", 23: "ghosts",
};

const specialObj: Record<string, string[][]> = {
  "0:0": [["midnight"], ["twelve"], ["twelve", "o'clock"]],
  "12:0": [["noon"], ["twelve"], ["twelve", "o'clock"]],
};

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function militaryTime(hour: number, min: number): string[] {
  const returnTime: string[] = [];
  let hourText = "";
  if (hour < 10 && hour > 0) hourText += "zero ";
  hourText += hoursObj[hour][hoursObj[hour].length - 1];
  returnTime.push(hourText);
  returnTime.push(...minutesObj[min][0].text);
  return returnTime;
}

function displayTime(hour: number, min: number, config: Config): string[] {
  if (config.get("display", "random") === "random") {
    // Handle noon and midnight.
    if (hour % 12 === 0 && min === 0) {
      const options = specialObj[`${hour}:${min}`];
      return [...options[randInt(0, options.length - 1)]];
    }
    // Handle all other times.
    const thisHourText = hoursObj[hour][0];
    const nextHourIndex = hour === 23 ? 0 : hour + 1;
    const nextHourText = hoursObj[nextHourIndex][0];

    // Get a random entry of the minute (that isn't military time).
    const minuteMinimum = min < 10 ? 1 : 0;
    const minuteMaximum = minutesObj[min].length - 1;
    const minuteObj = minutesObj[min][randInt(minuteMinimum, minuteMaximum)];

    const hourWord = minuteObj.h === 0 ? thisHourText : nextHourText;
    const words = minuteObj.text;
    if (minuteObj.o === 1) {
      if (words.length > 1) {
        return [words[0], `${words[1]} ${hourWord}`];
      }
      return words.length > 0 ? [...words, hourWord] : [hourWord];
    }
    return words.length > 0 ? [hourWord, ...words] : [hourWord];
  }

  // Basic mode.
  if (hour % 12 === 0 && min === 0) {
    return [...specialObj[`${hour}:${min}`][0]];
  }
  const returnTime = [hoursObj[hour][0]];
  const minIndex = min < 10 ? 1 : 0; // avoid military times
  returnTime.push(...minutesObj[min][minIndex].text);
  return returnTime;
}

function gameOfThrones(hour: number): string[] {
  const label = gameOfThronesObj[hour];
  return label ? ["hour of the ", label] : [];
}

function timeOfDay(hour: number, config: Config): string[] {
  if (config.bool("military", false)) return [];
  if (config.get("display", "") === "basic") {
    return hour < 12 ? ["AM"] : ["PM"];
  }
  for (const timeRange of timeOfDayObj) {
    if (hour >= timeRange.hourMin && hour < timeRange.hourMax) {
      return [...timeRange.text[randInt(0, timeRange.text.length - 1)]];
    }
  }
  return [];
}

export default function render(config: Config): RootSpec {
  const locationRaw = config.get("location");
  let timezone = DEFAULT_TIMEZONE;
  if (locationRaw) {
    try {
      timezone = (JSON.parse(locationRaw) as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE;
    } catch {
      // keep default
    }
  }
  const now = time.now().inLocation(timezone);
  const hour = now.hour;
  const min = now.minute;

  let showTime: string[];
  if (config.bool("military")) {
    showTime = militaryTime(hour, min);
  } else {
    showTime = displayTime(hour, min, config);
  }

  let subTime: string[] = [];
  if (config.bool("game_of_thrones")) {
    subTime = gameOfThrones(hour);
  }
  if (config.bool("time_of_day") && subTime.length === 0) {
    subTime = timeOfDay(hour, config);
  }

  if (config.get("caps", "caps") === "caps") {
    showTime = showTime.map((s) => s.toUpperCase());
    subTime = subTime.map((s) => s.toUpperCase());
  }

  const width = config.width();
  const height = config.height();
  const big = width >= 128;
  const font = big ? "6x13" : "tb-8";
  const bigH = big ? 13 : 8;
  const littleH = 7;

  const textTime: WidgetSpec[] = showTime.map((s, i) => Text({ content: " ".repeat(i) + s, font }));
  textTime.push(
    ...subTime.map((s, i) =>
      Padding({
        pad: { left: 0, top: 1, right: 0, bottom: 1 },
        child: Text({
          content: " ".repeat(showTime.length) + " ".repeat(i) + s,
          font: "CG-pixel-3x5-mono",
        }),
      }),
    ),
  );

  // Center the text vertically.
  const topMargin = Math.max(
    0,
    Math.ceil((height - bigH * showTime.length - littleH * subTime.length) / 2),
  );

  return Root({
    maxAge: 120,
    child: Padding({
      pad: { left: 1, top: topMargin, right: 0, bottom: 1 },
      child: Column({ children: textTime }),
    }),
  });
}

export function getSchema(): Schema {
  const dialectOptions = [schema.option({ display: "American English", value: "en-US" })];
  const displayOptions = [
    schema.option({ display: "Basic", value: "basic" }),
    schema.option({ display: "Random", value: "random" }),
  ];
  const capsOptions = [
    schema.option({ display: "CAPS", value: "caps" }),
    schema.option({ display: "lowercase", value: "lower" }),
  ];

  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        icon: "locationDot",
        desc: "Location for which to display time",
      }),
      schema.dropdown({
        id: "dialect",
        name: "Language",
        icon: "language",
        desc: "Language in which to display time",
        default: dialectOptions[0].value,
        options: dialectOptions,
      }),
      schema.dropdown({
        id: "caps",
        name: "Text Case",
        icon: "font",
        desc: "CAPS vs. lowercase",
        default: capsOptions[0].value,
        options: capsOptions,
      }),
      schema.dropdown({
        id: "display",
        name: "Display",
        icon: "shuffle",
        desc: "Basic times vs. surprise me",
        default: displayOptions[1].value,
        options: displayOptions,
      }),
      schema.toggle({
        id: "time_of_day",
        name: "Time of Day",
        desc: "Indication of AM/PM",
        icon: "moon",
        default: false,
      }),
      schema.toggle({
        id: "game_of_thrones",
        name: "Game of Thrones",
        desc: "Nighttime hour descriptions",
        icon: "chessRook",
        default: false,
      }),
      schema.toggle({
        id: "military",
        name: "Military Time",
        desc: "24-hour times",
        icon: "jetFighter",
        default: false,
      }),
    ],
  });
}

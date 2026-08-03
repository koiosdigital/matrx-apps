/**
 * Beat Time — hand port of `beattime/beat_time.star`: Swatch Internet Time
 * (Biel Mean Time, UTC+1, no DST; the day is 1000 ".beats" of 86.4s each),
 * animated one centibeat (864ms) per frame.
 *
 * Screen sizes: 6x13 as in the original, stepping up to 10x20 on 128x64.
 */

import {
  Animation,
  Box,
  Config,
  Root,
  Text,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time, type Time } from "@koiosdigital/matrx-sdk/stdlib";

const DEFAULT_SHOW_CENTIBEATS = true;
const CENTIBEAT_MS = 864;

function timeInBeats(now: Time): [string, string] {
  // Biel Mean Time is UTC+1, ignoring daylight savings.
  const timeInMilliseconds =
    now.millisecond + (now.second + (now.minute * 60 + ((now.hour + 1) % 24) * 3600)) * 1000;
  const beats = timeInMilliseconds / 86400;

  const integral = String(Math.floor(beats)).padStart(3, "0");
  const fractional = beats.toFixed(6).split(".")[1].slice(0, 2);
  return [integral, fractional];
}

function generateFrame(integral: string, fractional: string, showCentibeats: boolean, font: string): WidgetSpec {
  const content = showCentibeats ? `@${integral}.${fractional}` : `@${integral}`;
  return Text({ content, font });
}

export default function render(config: Config): RootSpec {
  const showCentibeats = config.bool("show_centibeats", DEFAULT_SHOW_CENTIBEATS);
  const font = config.width() >= 128 && config.height() >= 64 ? "10x20" : "6x13";

  let now = time.now().inLocation("UTC");
  const frames: WidgetSpec[] = [];
  for (let i = 0; i < 30; i++) {
    const [integral, fractional] = timeInBeats(now);
    frames.push(generateFrame(integral, fractional, showCentibeats, font));
    now = now.add(time.parseDuration(`${CENTIBEAT_MS}ms`));
  }

  return Root({
    delay: CENTIBEAT_MS, // the length of one centibeat
    maxAge: 120,
    child: Box({ child: Animation({ children: frames }) }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.toggle({
        id: "show_centibeats",
        name: "Show Centibeats",
        desc: "Show the centibeats after the decimal place",
        icon: "clock",
        default: true,
      }),
    ],
  });
}

/**
 * Countdown Clock — hand port of the corpus app
 * `countdownclock/countdown_clock.star` (by CubsAaron), kept structurally
 * line-for-line: same fonts, colors, fade cadence, layout and day/hour/
 * minute arithmetic.
 *
 * Uses the host-injected stdlib (`@koiosdigital/matrx-sdk/stdlib`): `time.now()` is the
 * quantized render time (§8.1), so this render is a pure function of
 * (config, timeBucket) — exactly like the Starlark original under pixlet.
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Marquee,
  Root,
  Text,
  schema,
  type Schema,
  type RootSpec,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

const colorOpt = [
  schema.option({ display: "Red", value: "#FF0000" }),
  schema.option({ display: "Orange", value: "#FFA500" }),
  schema.option({ display: "Yellow", value: "#FFFF00" }),
  schema.option({ display: "Green", value: "#008000" }),
  schema.option({ display: "Blue", value: "#0000FF" }),
  schema.option({ display: "Indigo", value: "#4B0082" }),
  schema.option({ display: "Violet", value: "#EE82EE" }),
];

/** Port of appendFadeList: fade in → hold `cycles` frames → fade out. */
function appendFadeList(fadeList: WidgetSpec[], text: string, cycles: number): void {
  for (let x = 0; x < 10; x += 2) {
    const c = `#${String(x).repeat(6)}`;
    fadeList.push(Text({ content: text, font: "CG-pixel-4x5-mono", color: c }));
  }
  for (let i = 0; i < cycles; i++) {
    fadeList.push(
      Text({ content: text, font: "CG-pixel-4x5-mono", color: "#888888" }),
    );
  }
  for (let x = 8; x > 0; x -= 2) {
    const c = `#${String(x).repeat(6)}`;
    fadeList.push(Text({ content: text, font: "CG-pixel-4x5-mono", color: c }));
  }
}

export default function render(config: Config): RootSpec {
  const timezone = config.get("$tz", "America/Chicago")!; // special timezone variable
  const DEFAULT_TIME = time.now().inLocation(timezone).format(time.RFC3339);

  const future = time.parseTime(config.str("event_time", DEFAULT_TIME));
  const dateDiff = future.sub(time.now().inLocation(timezone));
  const days = Math.floor(dateDiff.hours / 24);
  const hours = Math.floor(dateDiff.hours - days * 24);
  const minutes = Math.floor(dateDiff.minutes - (days * 24 * 60 + hours * 60));

  const fadeList: WidgetSpec[] = [];
  let dayString = "IS HERE!";
  if (time.now().before(future)) {
    dayString = `${days} ${days === 1 ? "Day" : "Days"}`;
    appendFadeList(fadeList, `${hours} ${hours === 1 ? "hour" : "hours"}`, 30);
    appendFadeList(fadeList, `${minutes} ${minutes === 1 ? "minute" : "minutes"}`, 20);
  } else {
    fadeList.push(
      Text({
        content: future.format("01-02-2006"),
        font: "CG-pixel-4x5-mono",
        color: "#888888",
      }),
    );
  }

  // Event text widget based on text length.
  const eventText = config.str("event", "Event");
  const eventColor = config.str("eventColor", colorOpt[3].value);
  const eventWidget =
    eventText.length < 14
      ? Text({ content: eventText, font: "5x8", color: eventColor })
      : Marquee({
          width: 64,
          child: Text({ content: eventText, font: "5x8", color: eventColor }),
        });

  return Root({
    delay: 100,
    child: Column({
      expanded: true,
      mainAlign: "center",
      crossAlign: "center",
      children: [
        eventWidget,
        Text({ content: dayString, font: "6x13" }),
        Box({ width: 64, height: 1 }),
        Animation({ children: fadeList }),
      ],
    }),
  });
}

/** Port of get_schema(). */
export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "event",
        name: "Event",
        desc: "The event text to display.",
        icon: "gear",
      }),
      schema.dateTime({
        id: "event_time",
        name: "Event Time",
        desc: "The time of the event.",
        icon: "gear",
      }),
      schema.dropdown({
        id: "eventColor",
        name: "Text Color",
        desc: "The color of the event text.",
        icon: "brush",
        default: colorOpt[3].value,
        options: colorOpt,
      }),
    ],
  });
}

/**
 * Countdown — quantized-clock reference app (handoff §11). `nowMs` is an
 * explicit input (the M4 stdlib's time.now() will supply the quantized
 * render time); rendering is a pure function of (now, target, label).
 */

import {
  Animation,
  Box,
  Column,
  Config,
  Marquee,
  Padding,
  Root,
  Row,
  Text,
  type RootSpec,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export default function render(config: Config): RootSpec {
  const nowMs = time.now().ms; // quantized render time
  const remainingSec = Math.max(0, Math.floor((config.int("targetMs") - nowMs) / 1000));
  const days = Math.floor(remainingSec / 86400);
  const hours = Math.floor((remainingSec % 86400) / 3600);
  const mins = Math.floor((remainingSec % 3600) / 60);
  const secs = remainingSec % 60;

  const big = `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
  const bigBlink = `${pad2(hours)} ${pad2(mins)} ${pad2(secs)}`;

  return Root({
    delay: 500,
    child: Column({
      expanded: true,
      mainAlign: "space_evenly",
      children: [
        Padding({
          pad: { left: 1, top: 1, right: 1, bottom: 0 },
          child: Marquee({
            width: 62,
            child: Text({ content: config.str("label"), font: "tom-thumb", color: "#ffaa00" }),
          }),
        }),
        Row({
          expanded: true,
          mainAlign: "center",
          children: [
            // Blinking colons: two alternating frames.
            Animation({
              children: [
                Text({ content: big, font: "6x13" }),
                Text({ content: bigBlink, font: "6x13" }),
              ],
            }),
          ],
        }),
        Row({
          expanded: true,
          mainAlign: "center",
          children: [
            days > 0
              ? Text({ content: `+${days}d`, font: "tom-thumb", color: "#1DB954" })
              : Box({ height: 5 }),
          ],
        }),
      ],
    }),
  });
}

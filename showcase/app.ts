/** Showcase — animated tour of the AA/geometry widgets. */

import {
  Box,
  Circle,
  Column,
  Marquee,
  Padding,
  PieChart,
  Plot,
  Root,
  Row,
  Stack,
  Text,
  Transformation,
  animation,
  Config,
  type RootSpec,
} from "@koiosdigital/matrx-sdk";

export default function render(_config?: Config): RootSpec {
  // A pie-chart "clock face" with a rotating hand.
  const dial = Stack({
    children: [
      PieChart({
        colors: ["#16324f", "#2a5c8a", "#1d4568"],
        weights: [120, 120, 120],
        diameter: 28,
      }),
      Transformation({
        child: Box({
          width: 28,
          height: 28,
          child: Box({ width: 2, height: 12, color: "#ffd166" }),
        }),
        duration: 64,
        delay: 0,
        width: 28,
        height: 28,
        origin: animation.Origin(0.5, 0.5),
        keyframes: [
          animation.Keyframe({
            percentage: 0,
            transforms: [animation.Rotate(0)],
          }),
          animation.Keyframe({
            percentage: 1,
            transforms: [animation.Rotate(360)],
          }),
        ],
      }),
      // Hub.
      Padding({
        pad: { left: 11, top: 11, right: 0, bottom: 0 },
        child: Circle({ color: "#ef476f", diameter: 6 }),
      }),
    ],
  });

  const sine: [number, number][] = [];
  for (let i = 0; i <= 32; i++) {
    sine.push([i, Math.sin((i / 32) * Math.PI * 2)]);
  }

  const panel = Column({
    children: [
      Plot({
        data: sine,
        width: 34,
        height: 22,
        color: "#06d6a0",
        colorInverted: "#ef476f",
        fill: true,
      }),
      Box({ height: 1 }),
      Marquee({
        width: 34,
        child: Text({ content: "matrx-ts render engine", color: "#ffd166" }),
      }),
    ],
  });

  return Root({
    delay: 50,
    showFullAnimation: true,
    child: Padding({
      pad: { left: 1, top: 2, right: 1, bottom: 2 },
      child: Row({
        expanded: true,
        mainAlign: "space_between",
        children: [dial, panel],
      }),
    }),
  });
}

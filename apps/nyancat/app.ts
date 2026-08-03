/**
 * Nyan Cat — hand port of `nyancat/nyan_cat.star` (by Mack Ward): the
 * classic 12-frame loop, extracted to PNG assets.
 *
 * Screen sizes: the 64x32 frames center on 64x64 and scale 2x on 128x64
 * (nearest neighbor keeps the pixels crisp).
 */

import {
  Animation,
  Box,
  Config,
  Image,
  Root,
  schema,
  type RootSpec,
  type Schema,
} from "@koiosdigital/matrx-sdk";

import F00 from "./frame00.png";
import F01 from "./frame01.png";
import F02 from "./frame02.png";
import F03 from "./frame03.png";
import F04 from "./frame04.png";
import F05 from "./frame05.png";
import F06 from "./frame06.png";
import F07 from "./frame07.png";
import F08 from "./frame08.png";
import F09 from "./frame09.png";
import F10 from "./frame10.png";
import F11 from "./frame11.png";

const FRAMES = [F00, F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11];

export default function render(config: Config): RootSpec {
  const scale = config.width() >= 128 && config.height() >= 64 ? 2 : 1;
  return Root({
    child: Box({
      child: Animation({
        children: FRAMES.map((f) => Image({ src: f, width: 64 * scale, height: 32 * scale })),
      }),
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({ version: "1", fields: [] });
}

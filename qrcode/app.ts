/**
 * QR Code — npm-dependency reference app: uses the `qrcode-generator`
 * package (declared in manifest "dependencies") instead of a bespoke
 * stdlib qrcode module. Pure computation → deterministic by construction.
 */

import qrcode from "qrcode-generator";
import {
  Box,
  Column,
  Config,
  Padding,
  Root,
  Row,
  Text,
  WrappedText,
  schema,
  type Schema,
  type RootSpec,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "url",
        name: "URL",
        desc: "The link to encode.",
        icon: "gear",
        default: "https://matrx.dev",
      }),
      schema.text({
        id: "label",
        name: "Label",
        desc: "Text next to the code.",
        icon: "gear",
        default: "SCAN ME",
      }),
    ],
  });
}

export default function render(config: Config): RootSpec {
  const url = config.str("url", "https://matrx.dev");

  const qr = qrcode(0, "L"); // type 0 = auto-size
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();

  // Run-length encode each row into Boxes: dark modules black, light
  // modules inherit the white quiet-zone box behind them.
  const rows: WidgetSpec[] = [];
  for (let r = 0; r < n; r++) {
    const runs: WidgetSpec[] = [];
    let c = 0;
    while (c < n) {
      const dark = qr.isDark(r, c);
      let len = 1;
      while (c + len < n && qr.isDark(r, c + len) === dark) len++;
      runs.push(Box({ width: len, height: 1, ...(dark ? { color: "#000" } : {}) }));
      c += len;
    }
    rows.push(Row({ children: runs }));
  }

  return Root({
    child: Row({
      expanded: true,
      mainAlign: "space_between",
      crossAlign: "center",
      children: [
        Padding({
          pad: { left: 2, top: 0, right: 0, bottom: 0 },
          // Quiet zone: white border around the code.
          child: Box({
            width: n + 2,
            height: n + 2,
            color: "#fff",
            child: Column({ children: rows }),
          }),
        }),
        Padding({
          pad: { left: 0, top: 0, right: 2, bottom: 0 },
          child: WrappedText({
            content: config.str("label", "SCAN ME"),
            width: 64 - n - 8,
            font: "tom-thumb",
            color: "#1DB954",
            align: "center",
          }),
        }),
      ],
    }),
  });
}

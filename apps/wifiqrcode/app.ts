/**
 * WiFi QR Code — hand port of `wifiqrcode/wifi_qr_code.star` (by misusage):
 * renders a scannable WIFI: QR code plus a WiFi icon.
 *
 * Differences from the Starlark original:
 *  - pixlet's `qrcode` module became the `qrcode-generator` npm package
 *    (already a repo dependency), drawn as RLE rows of Boxes.
 *  - Screen sizes: the module pixel size scales up when the panel allows
 *    (2x on 64-tall panels), instead of the original's fixed size.
 *  - The 56-char payload limit was pixlet's image-width constraint; here the
 *    QR version grows as needed, so the error only triggers when the code
 *    can't fit the panel at 1px per module.
 */

import {
  Box,
  Column,
  Config,
  Image,
  Marquee,
  Padding,
  Root,
  Row,
  WrappedText,
  schema,
  type Child,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import qrcode from "qrcode-generator";

import WIFI_ICON from "./wifi.png";

function centeredMessage(content: string, width: number): WidgetSpec {
  return Column({
    mainAlign: "center",
    expanded: true,
    children: [
      Row({
        mainAlign: "space_around",
        expanded: true,
        children: [WrappedText({ align: "center", content, width })],
      }),
    ],
  });
}

/** The QR code as RLE rows of boxes, white modules on black. */
function qrWidget(payload: string, pixel: number): WidgetSpec | null {
  const qr = qrcode(0, "L");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();

  const rows: WidgetSpec[] = [];
  for (let r = 0; r < n; r++) {
    const row: WidgetSpec[] = [];
    let run = qr.isDark(r, 0);
    let runLength = 1;
    for (let c = 1; c < n; c++) {
      const dark = qr.isDark(r, c);
      if (dark !== run) {
        row.push(Box({ width: runLength * pixel, height: pixel, color: run ? "#fff" : "#000" }));
        run = dark;
        runLength = 0;
      }
      runLength += 1;
    }
    row.push(Box({ width: runLength * pixel, height: pixel, color: run ? "#fff" : "#000" }));
    rows.push(Row({ children: row }));
  }
  return Column({ children: rows });
}

export default function render(config: Config): RootSpec {
  const ssid = config.str("ssid", "");
  const password = config.str("password", "");
  const encryption = config.get("encryption", "WPA")!;
  const width = config.width();
  const height = config.height();

  let show: Child;
  if (!ssid) {
    show = centeredMessage("WiFi QR Code Generator", width);
  } else {
    const payload = `WIFI:T:${encryption};S:${ssid};P:${password};;`;

    const qr = qrcode(0, "L");
    qr.addData(payload);
    qr.make();
    const modules = qr.getModuleCount();
    const pixel = Math.max(1, Math.floor((height - 2) / modules));

    if (modules > height - 2) {
      show = Column({
        mainAlign: "center",
        expanded: true,
        children: [
          Row({
            mainAlign: "space_around",
            expanded: true,
            children: [
              Marquee({
                width,
                child: WrappedText({ content: "ERROR: Your network is not compatible." }),
                offsetStart: Math.floor(width / 2),
                offsetEnd: Math.floor(width / 2),
              }),
            ],
          }),
        ],
      });
    } else {
      const iconSize = Math.min(32, width - modules * pixel - 4);
      show = Row({
        mainAlign: "space_around",
        crossAlign: "center",
        expanded: true,
        children: [
          Padding({ pad: { left: 0, top: 1, right: 0, bottom: 0 }, child: qrWidget(payload, pixel)! },),
          iconSize >= 8 && Image({ src: WIFI_ICON, width: iconSize, height: iconSize }),
        ],
      });
    }
  }

  return Root({ child: show as WidgetSpec });
}

export function getSchema(): Schema {
  const options = [
    schema.option({ display: "WEP", value: "WEP" }),
    schema.option({ display: "WPA/WPA2/WPA3 - Personal", value: "WPA" }),
  ];

  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "ssid",
        name: "SSID",
        desc: "What is your network name/SSID?",
        icon: "wifi",
        default: "",
      }),
      schema.text({
        id: "password",
        name: "Password",
        desc: "What is your WiFi Password?",
        icon: "key",
        default: "",
      }),
      schema.dropdown({
        id: "encryption",
        name: "Authentication Method",
        desc: "What is the authentication method for your WiFi?",
        icon: "lock",
        default: options[1].value,
        options,
      }),
    ],
  });
}

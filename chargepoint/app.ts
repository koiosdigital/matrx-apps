/**
 * ChargePoint — hand port of `chargepoint/chargepoint.star` from
 * koiosdigital/matrx-apps (by acvigue), kept structurally line-for-line:
 * same layouts, colors, fonts and status logic.
 *
 * Exercises the conditional schema chain (§7): an oauth2 field feeds a
 * generated field (source: "auth"), whose handler emits a locationbased
 * station picker; that picker's handler reads the OAuth token back out of
 * config to authenticate the station search. Handlers are named exports,
 * invoked by the host via the isolate handler op (§9.3).
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
  Text,
  schema,
  type Insets,
  type RootSpec,
  type Schema,
  type SchemaField,
  type SchemaOption,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http } from "@koiosdigital/matrx-sdk/stdlib";

import BOLT from "./bolt.png";
import BOLT_GREY from "./bolt_grey.png";
import BOLT_ANIMATED from "./bolt_animated.gif";

const API_BASE = "https://chargepoint-api.koiosdigital.net";

const EXAMPLE_DATA = `{"stationStatus": "available", "lat": 12.22, "name": "Log In Below", "deviceId": 1234, "address": "1234 Anytown", "ports": {"ports": [{"level": "L2", "connectorList": [{"status": "available", "statusV2": "available", "displayPlugType": "J1772", "plugType": "J1772"}], "outletNumber": 1.0, "distanceRange": {"unit": "Mile", "max": 19.799999999999997}, "statusV2": "available", "capabilities": ["WAITLIST_MODE1"], "parkingAccessibility": "NONE", "powerRange": {"max": "6.6", "unit": "kW"}, "status": "available", "displayLevel": "AC"}, {"statusV2": "available", "displayLevel": "AC", "connectorList": [{"status": "available", "statusV2": "available", "displayPlugType": "J1772", "plugType": "J1772"}], "distanceRange": {"unit": "Mile", "max": 19.799999999999997}, "powerRange": {"unit": "kW", "max": "6.6"}, "status": "available", "level": "L2", "capabilities": ["WAITLIST_MODE1"], "parkingAccessibility": "NONE", "outletNumber": 2.0}], "portCount": 2.0, "dc": false}, "lng": 12.22, "description": "Description", "network": {"displayName": "ChargePoint Network", "logoUrl": "https://mc.chargepoint.com/images/network/2/ic_network_chargepoint.png"}, "openCloseStatus": "open", "hostName": "Charger Host"}`;

interface StationPort {
  status: string;
  displayLevel?: string;
  powerRange: { max: string; unit: string };
}

interface StationData {
  stationStatus: string;
  name: string;
  address?: string;
  ports: { ports: StationPort[] };
}

interface StatusInfo {
  taken: number;
  total: number;
  ports: StationPort[];
  image: Uint8Array;
  text: string;
  color: string;
}

/** Pixlet pad tuple (left, top, right, bottom). */
function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

/**
 * Cache window for a minted access token. Kept under the API's access-token
 * lifetime (1h) so the host TTL cache serves most renders from one refresh
 * exchange rather than refreshing on every render.
 */
const ACCESS_TOKEN_CACHE_SECONDS = 50 * 60;

/**
 * Exchange the stored refresh token for a fresh access token.
 *
 * The MATRX config store is write-once and read-only, so we persist the
 * long-lived, non-rotating refresh token as `auth` and derive a short-lived
 * access token on demand here. Returns null when the session is gone (refresh
 * token revoked/expired) — the caller should fall back to the logged-out state.
 */
async function getAccessToken(config: Config): Promise<string | null> {
  const refreshToken = config.get("auth") ?? "";
  if (!refreshToken) return null;

  const res = await http.post(`${API_BASE}/api/oauth/token`, {
    headers: { Accept: "application/json" },
    formBody: { grant_type: "refresh_token", refresh_token: refreshToken },
    ttlSeconds: ACCESS_TOKEN_CACHE_SECONDS,
  });
  if (res.status !== 200) {
    // 400 invalid_grant => session ended; anything else is transient.
    return null;
  }
  const { access_token } = res.json() as { access_token?: string };
  return access_token ?? null;
}

async function getStationData(config: Config): Promise<StationData> {
  const station = config.get("station") ?? "";

  let data = JSON.parse(EXAMPLE_DATA) as StationData;
  if (station) {
    const accessToken = await getAccessToken(config);
    // No token => not connected (or session expired); show the placeholder.
    if (!accessToken) return data;

    const stationJson = JSON.parse(station) as { value?: string };
    const stationId = stationJson.value;

    const url = `${API_BASE}/api/v1/stations/${stationId}`;
    const res = await http.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      ttlSeconds: 120,
    });
    if (res.status !== 200) {
      throw new Error(`GET ${url} failed with status ${res.status}: ${res.body()}`);
    }
    data = res.json() as StationData;
  }

  return data;
}

function getStatusInfo(data: StationData): StatusInfo {
  const ports = data.ports.ports;
  let taken = 0;
  for (const port of ports) {
    if (port.status !== "available") taken++;
  }
  const total = ports.length;

  // "in_use_by_driver" = the account holder's own charging session.
  const charging = ports.some((port) => port.status === "in_use_by_driver");

  const base = { taken, total, ports };
  if (
    data.stationStatus !== "available" &&
    data.stationStatus !== "in_use" &&
    data.stationStatus !== "in_use_by_driver"
  ) {
    return { ...base, image: BOLT, text: "Station Down", color: "#ff2222" };
  } else if (charging) {
    return { ...base, image: BOLT_ANIMATED, text: "Charging", color: "#22ff22" };
  } else if (taken === 0) {
    return {
      ...base,
      image: BOLT_ANIMATED,
      text: `Open: ${ports[0].powerRange.max}${ports[0].powerRange.unit}`,
      color: "#22ff22",
    };
  } else if (taken === total) {
    return { ...base, image: BOLT_GREY, text: "Occupied", color: "#ff2222" };
  }
  return { ...base, image: BOLT_ANIMATED, text: `${taken}/${total} in use`, color: "#ffff22" };
}

function brandRow(): WidgetSpec {
  return Row({
    children: [
      Text({ content: "Charge", color: "#ff7a14" }),
      Text({ content: "Point", color: "#7a9caf" }),
      Text({ content: "+", color: "#ff7a14" }),
    ],
  });
}

function autoText(text: string, maxWidth: number, color = "#fff", font = ""): WidgetSpec {
  const charWidth = font === "6x13" ? 6 : 5;
  const widget =
    font !== ""
      ? Text({ content: text, color, font })
      : Text({ content: text, color });
  if (text.length * charWidth <= maxWidth) {
    return widget;
  }
  return Marquee({ width: maxWidth, child: widget });
}

function portIndicators(ports: StationPort[], dotSize: number): WidgetSpec {
  const dots: WidgetSpec[] = [];
  for (const port of ports) {
    let c: string;
    if (port.status === "available") {
      c = "#22ff22";
    } else if (port.status === "in_use" || port.status === "in_use_by_driver") {
      c = "#ffff22";
    } else {
      c = "#ff2222";
    }
    dots.push(Box({ width: dotSize, height: dotSize, color: c }));
    dots.push(Box({ width: 2, height: dotSize }));
  }
  return Row({ children: dots });
}

function layoutCompact(width: number, name: string, status: StatusInfo): WidgetSpec {
  const mw = width - 4;
  return Column({
    children: [
      Marquee({
        width: mw,
        child: Padding({ pad: pad(2, 2, 0, 0), child: brandRow() }),
      }),
      Marquee({
        width: mw,
        child: Padding({ pad: pad(2, 2, 0, 0), child: Text({ content: name }) }),
      }),
      Padding({
        pad: pad(2, 2, 2, 0),
        child: Row({
          children: [
            Text({ content: status.text, color: status.color }),
            Image({ src: status.image }),
          ],
          expanded: true,
          mainAlign: "space_between",
        }),
      }),
    ],
  });
}

function layoutVertical(
  width: number,
  name: string,
  address: string,
  status: StatusInfo,
): WidgetSpec {
  const mw = width - 4;
  const ports = status.ports;
  return Column({
    children: [
      Padding({ pad: pad(2, 2, 0, 0), child: brandRow() }),
      Padding({ pad: pad(2, 1, 0, 0), child: autoText(name, mw, "#fff") }),
      Padding({ pad: pad(2, 1, 0, 0), child: autoText(address, mw, "#888") }),
      Padding({ pad: pad(2, 3, 0, 0), child: portIndicators(ports, 5) }),
      Padding({
        pad: pad(2, 2, 0, 0),
        child: Row({
          children: [
            Text({ content: status.text, color: status.color, font: "6x13" }),
            Image({ src: status.image }),
          ],
          expanded: true,
          mainAlign: "space_between",
        }),
      }),
      Padding({
        pad: pad(2, 1, 0, 0),
        child: Text({
          content: `${ports[0].displayLevel ?? ""} | ${ports[0].powerRange.max}${ports[0].powerRange.unit}`,
          color: "#888",
          font: "tom-thumb",
        }),
      }),
    ],
  });
}

function layoutWide(
  width: number,
  height: number,
  name: string,
  address: string,
  status: StatusInfo,
): WidgetSpec {
  const leftW = height;
  const rightW = width - leftW - 4;
  const boltSize = Math.min(leftW - 8, 24);
  const ports = status.ports;

  const left = Box({
    width: leftW,
    height,
    color: "#111111",
    child: Column({
      mainAlign: "center",
      crossAlign: "center",
      expanded: true,
      children: [
        brandRow(),
        Padding({
          pad: pad(0, 4, 0, 0),
          child: Image({ src: status.image, width: boltSize, height: boltSize }),
        }),
        Padding({ pad: pad(0, 4, 0, 0), child: portIndicators(ports, 6) }),
      ],
    }),
  });

  const right = Padding({
    pad: pad(4, 4, 2, 0),
    child: Column({
      children: [
        autoText(name, rightW, "#fff", "6x13"),
        Padding({ pad: pad(0, 2, 0, 0), child: autoText(address, rightW, "#888") }),
        Padding({
          pad: pad(0, 4, 0, 0),
          child: Text({ content: status.text, color: status.color, font: "6x13" }),
        }),
        Column({
          expanded: true,
          mainAlign: "end",
          children: [
            Padding({
              pad: pad(0, 0, 0, 2),
              child: Text({
                content: `${status.total - status.taken}/${status.total} ports available`,
                color: "#aaa",
                font: "tom-thumb",
              }),
            }),
          ],
        }),
      ],
    }),
  });

  return Row({ children: [left, right] });
}

export default async function render(config: Config): Promise<RootSpec> {
  const width = config.width();
  const height = config.height();
  const data = await getStationData(config);
  const name = data.name;
  const address = data.address ?? "";
  const status = getStatusInfo(data);

  let child: WidgetSpec;
  if (height >= 64 && width >= 128) {
    child = layoutWide(width, height, name, address, status);
  } else if (height >= 64) {
    child = layoutVertical(width, name, address, status);
  } else {
    child = layoutCompact(width, name, status);
  }

  return Root({ delay: 32, child });
}

/**
 * locationbased handler for the generated "station" field. Receives the
 * device location as input and the current config as second argument
 * (Koios fork parity) — the OAuth token flows in via config["auth"].
 */
export async function locationBasedHandler(
  location: string,
  config: Config,
): Promise<SchemaOption[]> {
  const accessToken = await getAccessToken(config);
  if (!accessToken) return [];

  const loc = JSON.parse(location) as { lat: string | number; lng: string | number };
  const res = await http.post(`${API_BASE}/api/v1/stations/search`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    jsonBody: { lat: Number(loc.lat), lng: Number(loc.lng), radius: 5 },
    ttlSeconds: 86400,
  });

  if (res.status !== 200) {
    return [schema.option({ display: "Error fetching stations", value: "" })];
  }

  const response = res.json() as {
    stations?: Array<{ name: string; device_id: number }>;
  };
  return (response.stations ?? []).map((station) =>
    schema.option({ display: station.name, value: String(station.device_id) }),
  );
}

/**
 * generated handler: input is the current value of the source field
 * ("auth") — no station picker until the OAuth flow has produced a token.
 */
export function generatedHandler(auth: string): SchemaField[] {
  if (!auth) return [];

  return [
    schema.locationBased({
      id: "station",
      name: "ChargePoint Station",
      desc: "Select a ChargePoint station near the provided location.",
      icon: "train",
      handler: "locationBasedHandler",
    }),
  ];
}

/**
 * oauth2 handler: runs the authorization_code exchange and persists the
 * REFRESH token as the connection's stored value (`auth`).
 *
 * The host stores whatever this returns once, and config is read-only
 * thereafter — so we keep the durable, non-rotating refresh token (not the
 * 1-hour access token). Access tokens are minted on demand from it via
 * getAccessToken().
 */
export async function oauthHandler(params: string): Promise<string> {
  const p = JSON.parse(params) as Record<string, string>;
  const res = await http.post(`${API_BASE}/api/oauth/token`, {
    headers: { Accept: "application/json" },
    formBody: p,
  });
  if (res.status !== 200) {
    throw new Error(
      `token request failed with status code: ${res.status} - ${res.body()}`,
    );
  }
  const tokenParams = res.json() as {
    access_token: string;
    refresh_token?: string;
  };
  // Prefer the refresh token; fall back to the access token if the API ever
  // omits it, so the connection still works (degraded to no auto-refresh).
  return tokenParams.refresh_token ?? tokenParams.access_token;
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.oauth2({
        id: "auth",
        icon: "cloud",
        name: "ChargePoint Account",
        desc: "Connect your ChargePoint account.",
        handler: "oauthHandler",
        clientId: "matrx",
        pkce: true,
        authorizationEndpoint: `${API_BASE}/oauth/authorize`,
        scopes: ["chargepoint"],
      }),
      schema.generated({
        id: "generated",
        source: "auth",
        handler: "generatedHandler",
      }),
    ],
  });
}

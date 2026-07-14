/**
 * Last.fm — now scrobbling / latest scrobble, with album art. Spotify
 * parity: the same responsive compact / vertical / wide layout selection
 * and the same Album Art Only option, in last.fm red. The compact layout
 * additionally squeezes in a SCROBBLING / LAST TRACK status line — unlike
 * spotify (which skips the render when nothing is playing), last.fm always
 * has a most recent scrobble, so the app always renders and the status is
 * the only playing/not-playing signal.
 *
 * Exercises the `webcallback` schema field (§7): last.fm's auth handshake
 * predates OAuth2 — the login popup opens last.fm/api/auth with our callback
 * URL in the `cb` query param, last.fm redirects back with a one-use
 * `?token=`, and `sessionHandler` exchanges it for a session key via the
 * signed auth.getSession call. To the end user it looks exactly like an
 * OAuth2 login.
 *
 * Every authenticated call carries an `api_sig`: the request params sorted
 * by name, concatenated as <name><value>, the shared secret appended, and
 * the whole string md5-hashed (`format` is excluded from the signature per
 * the API docs). md5 comes from the vetted `blueimp-md5` npm dependency —
 * the stdlib deliberately ships no hashing module (see qrcode).
 *
 * The session key is stored as `{name, key}` JSON: last.fm session keys
 * never expire, and the username riding along means the user only logs in —
 * no username field to fill. With no connected account the app renders the
 * bundled example data so it previews (spotify parity).
 *
 * To run this yourself, register an API account at
 * https://www.last.fm/api/account/create and fill in LASTFM_API_KEY /
 * LASTFM_SHARED_SECRET below. No callback URL registration is needed — the
 * webcallback field passes ours via `cb`.
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
  Stack,
  Text,
  WrappedText,
  schema,
  type Insets,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http } from "@koiosdigital/matrx-sdk/stdlib";
import md5 from "blueimp-md5";

import LASTFM_LOGO from "./logo.png";

const LASTFM_API_KEY = "8628f6af50f2ede37d25f93a1abd3338";
const LASTFM_SHARED_SECRET = "7318e8331f1eb8296a61a8cc6be392f9";

const API_BASE = "https://ws.audioscrobbler.com/2.0/";

/** Last.fm brand red. */
const PRIMARY_COLOR = "#d51007";

/** Pixlet pad tuple (left, top, right, bottom). */
function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

interface LastfmImage {
  size: string;
  "#text": string;
}

interface LastfmTrack {
  name: string;
  artist: { "#text": string };
  album: { "#text": string };
  image: LastfmImage[];
  "@attr"?: { nowplaying?: string };
}

interface RecentTracksResponse {
  recenttracks?: { track: LastfmTrack[] };
  error?: number;
  message?: string;
}

function errorView(message: string, width: number): WidgetSpec {
  return WrappedText({ content: message, width, color: "#fff" });
}

/** Album art at the given square size; dark placeholder when last.fm has none. */
function artWidget(art: Uint8Array | null, size: number): WidgetSpec {
  if (art === null) return Box({ width: size, height: size, color: "#222" });
  return Image({ src: art, height: size, width: size });
}

function albumArtOnly(config: Config, art: Uint8Array | null): WidgetSpec {
  const width = config.width();
  const height = config.height();
  const size = Math.min(width, height);
  return Box({ width, height, child: artWidget(art, size) });
}

function autoText(text: string, marqueeWidth: number, color = "#fff", font = ""): WidgetSpec {
  const charWidth = font === "6x13" ? 6 : 5;
  const display = text.toUpperCase();
  const widget =
    font !== "" ? Text({ content: display, color, font }) : Text({ content: display, color });
  if (display.length * charWidth <= marqueeWidth) {
    return Row({ expanded: true, mainAlign: "center", children: [widget] });
  }
  return Marquee({ width: marqueeWidth, child: widget });
}

function layoutCompact(
  trackTitle: string,
  artist: string,
  art: Uint8Array | null,
  nowPlaying: boolean,
): WidgetSpec {
  return Column({
    children: [
      Padding({
        pad: pad(1, 0, 0, 0),
        child: Marquee({
          width: 60,
          child: Padding({
            pad: pad(0, 1, 0, 0),
            child: Text({ content: trackTitle.toUpperCase(), color: PRIMARY_COLOR }),
          }),
        }),
      }),
      Padding({
        pad: pad(1, 1, 0, 0),
        child: Row({
          children: [
            artWidget(art, 21),
            Padding({
              pad: pad(2, 2, 0, 0),
              child: Column({
                children: [
                  Marquee({ width: 40, child: Text({ content: artist.toUpperCase() }) }),
                  Padding({
                    pad: pad(0, 2, 0, 0),
                    child: Text({
                      content: nowPlaying ? "SCROBBLING" : "LAST TRACK",
                      color: "#777",
                      font: "tom-thumb",
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    ],
  });
}

function layoutVertical(
  trackTitle: string,
  artist: string,
  art: Uint8Array | null,
  width: number,
): WidgetSpec {
  const artSize = 47;
  return Padding({
    pad: pad(0, 1, 0, 0),
    child: Column({
      crossAlign: "center",
      children: [
        artWidget(art, artSize),
        Padding({ pad: pad(2, 0, 0, 0), child: autoText(trackTitle, width, PRIMARY_COLOR) }),
        Padding({ pad: pad(2, 0, 0, 0), child: autoText(artist, width) }),
      ],
    }),
  });
}

function layoutWide(
  width: number,
  height: number,
  trackTitle: string,
  artist: string,
  art: Uint8Array | null,
): WidgetSpec {
  const artSize = height;
  const gap = 4;
  const textWidth = width - artSize - gap;

  return Stack({
    children: [
      Row({
        children: [
          artWidget(art, artSize),
          Padding({
            pad: pad(2, 0, 0, 0),
            child: Column({
              children: [
                Marquee({
                  width: textWidth,
                  child: Text({
                    content: trackTitle.toUpperCase(),
                    font: "6x13",
                    color: PRIMARY_COLOR,
                  }),
                }),
                Marquee({
                  width: textWidth,
                  child: Text({ content: artist.toUpperCase(), font: "6x13" }),
                }),
              ],
            }),
          }),
        ],
      }),
      Row({
        mainAlign: "end",
        crossAlign: "end",
        expanded: true,
        children: [
          Padding({
            pad: pad(0, 0, 1, 1),
            child: Column({
              mainAlign: "end",
              crossAlign: "end",
              expanded: true,
              children: [Image({ src: LASTFM_LOGO, width: 16, height: 16 })],
            }),
          }),
        ],
      }),
    ],
  });
}

/**
 * Sign params per the last.fm scheme (sorted <name><value> concat + secret,
 * md5-hexed) and append `format=json` — format is excluded from the
 * signature, so it goes on after signing.
 */
function signed(params: Record<string, string>): Record<string, string> {
  const base = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join("");
  return { ...params, api_sig: md5(base + LASTFM_SHARED_SECRET), format: "json" };
}

/**
 * Fetch the user's most recent scrobble. Signed with the session key so
 * private listening histories work too. Returns `{ error }` on API failure
 * or null when the account has no scrobbles; with no connected account,
 * falls back to the bundled example so the app previews.
 */
async function getRecentTrack(
  config: Config,
): Promise<LastfmTrack | { error: string } | null> {
  const auth = config.get("auth");
  const data = auth
    ? await fetchRecentTracks(JSON.parse(auth) as { name: string; key: string })
    : (JSON.parse(EXAMPLE_DATA) as RecentTracksResponse);

  if (data.error) return { error: `Last.fm error ${data.error}: ${data.message}` };
  const track = data.recenttracks?.track?.[0];
  return track ?? null;
}

async function fetchRecentTracks(session: {
  name: string;
  key: string;
}): Promise<RecentTracksResponse> {
  const res = await http.get(API_BASE, {
    params: signed({
      method: "user.getrecenttracks",
      api_key: LASTFM_API_KEY,
      sk: session.key,
      user: session.name,
      limit: "1",
    }),
    ttlSeconds: 30, // near-live: one origin hit per ~30s window across renders
  });
  if (res.status !== 200) return { error: res.status, message: res.body() };
  return res.json() as RecentTracksResponse;
}

/**
 * Fetch album art as raw bytes for Image (7d host-cached); null when the
 * track has no art. Prefers the largest size so the vertical/wide layouts
 * downscale instead of upscaling.
 */
async function fetchArt(track: LastfmTrack): Promise<Uint8Array | null> {
  const bySize = (size: string) => track.image.find((i) => i.size === size)?.["#text"];
  const url =
    bySize("extralarge") || bySize("large") || track.image.find((i) => i["#text"])?.["#text"];
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { "x-matrx-ttl": "604800" } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function render(config: Config): Promise<RootSpec | null> {
  const track = await getRecentTrack(config);

  // No scrobbles yet — skip this render (null → 0 frames → device skips).
  if (track === null) return null;

  if ("error" in track) {
    return Root({ child: errorView(track.error, config.width()) });
  }

  const art = await fetchArt(track);

  if (config.bool("album_art_only")) {
    return Root({ child: albumArtOnly(config, art) });
  }

  const trackTitle = track.name;
  const artist = track.artist["#text"];
  const nowPlaying = track["@attr"]?.nowplaying === "true";
  const width = config.width();
  const height = config.height();

  let child: WidgetSpec;
  if (height >= 64 && width >= 128) {
    child = layoutWide(width, height, trackTitle, artist, art);
  } else if (height >= 64) {
    child = layoutVertical(trackTitle, artist, art, width);
  } else {
    child = layoutCompact(trackTitle, artist, art, nowPlaying);
  }

  return Root({ child });
}

/**
 * webcallback handler: last.fm redirected to our callback with a one-use
 * `?token=`; exchange it for a permanent session via the signed
 * auth.getSession call. The host stores whatever this returns once, and
 * config is read-only after that — session keys never expire, so unlike
 * spotify there is no refresh dance.
 */
export async function sessionHandler(param: string): Promise<string> {
  const p = JSON.parse(param) as Record<string, string>;
  if (!p.token) throw new Error("last.fm callback did not include a token");
  const res = await http.get(API_BASE, {
    params: signed({
      method: "auth.getSession",
      api_key: LASTFM_API_KEY,
      token: p.token,
    }),
    ttlSeconds: 0, // tokens are one-use; never serve a cached exchange
  });
  if (res.status !== 200) {
    throw new Error(`auth.getSession failed with status code: ${res.status} - ${res.body()}`);
  }
  const { session } = res.json() as { session: { name: string; key: string } };
  return JSON.stringify({ name: session.name, key: session.key });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.webCallback({
        id: "auth",
        icon: "music",
        name: "Last.fm",
        desc: "Connect your Last.fm account.",
        handler: "sessionHandler",
        authorizationEndpoint: `https://www.last.fm/api/auth/?api_key=${LASTFM_API_KEY}`,
        redirectParam: "cb",
        successParam: "token",
      }),
      schema.toggle({
        id: "album_art_only",
        icon: "eye",
        name: "Album Art Only",
        desc: "If enabled, only the album art will be displayed.",
        default: false,
      }),
    ],
  });
}

const EXAMPLE_DATA = `{
  "recenttracks": {
    "track": [
      {
        "artist": { "#text": "Boards of Canada" },
        "name": "Roygbiv",
        "album": { "#text": "Music Has the Right to Children" },
        "image": [
          { "size": "small", "#text": "https://lastfm.freetls.fastly.net/i/u/34s/2a96cbd8b46e442fc41c2b86b821562f.png" },
          { "size": "large", "#text": "https://lastfm.freetls.fastly.net/i/u/174s/2a96cbd8b46e442fc41c2b86b821562f.png" }
        ],
        "@attr": { "nowplaying": "true" }
      }
    ]
  }
}`;

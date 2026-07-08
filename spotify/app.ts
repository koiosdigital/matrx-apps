/**
 * Spotify — hand port of `spotify/spotify.star` from koiosdigital/matrx-apps,
 * kept structurally line-for-line: same layouts, colors, fonts and the
 * responsive compact / vertical / wide selection.
 *
 * Auth model (user-defined OAuth client, §7 Koios fork parity): the user
 * supplies their own Spotify client id/secret, so the token exchange runs
 * directly against accounts.spotify.com. The oauth2 handler persists
 * `client_id:client_secret<SEP>refresh_token` as the connection value; each
 * render mints a short-lived access token from it (host-TTL-cached like
 * chargepoint, since the MATRX config store is write-once/read-only).
 *
 * Differences from the Starlark original, forced by the SDK surface:
 *  - No `secret.encrypt` in the SDK (only `secret.decrypt`); the handler
 *    returns the auth string as-is and the host stores it (see chargepoint).
 *  - The `http` wrapper is text-only, so album art is fetched with raw
 *    `fetch()` + arrayBuffer() and handed to Image as bytes. The 24h TTL is
 *    set explicitly via the `x-matrx-ttl` header the host cache consumes.
 *  - Spotify serves album art as JPEG, which matrx-render can't decode (PNG/
 *    GIF/WebP only — pixlet's decoder did JPEG). Art is routed through the
 *    images.weserv.nl proxy, which transcodes to PNG and downscales to the
 *    panel, so the isolate only egresses to that one host.
 *  - `return []` (pixlet "skip this render") becomes an empty Root — a blank
 *    frame — which is the closest type-safe equivalent.
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

import SPOTIFY_LOGO from "./logo.png";

/** Separator between "client_id:client_secret" and the refresh token. */
const SPOTIFY_AUTH_SEPARATOR = "   ";

const PRIMARY_COLOR = "#1db954";

/**
 * Cache window for a minted access token. Kept under Spotify's access-token
 * lifetime (1h) so the host TTL cache serves most renders from one refresh
 * exchange rather than refreshing on every render.
 */
const ACCESS_TOKEN_CACHE_SECONDS = 50 * 60;

/** Pixlet pad tuple (left, top, right, bottom). */
function pad(left: number, top: number, right: number, bottom: number): Insets {
  return { left, top, right, bottom };
}

interface SpotifyArtist {
  name: string;
}

interface SpotifyTrack {
  name: string;
  artists: SpotifyArtist[];
  album: { name: string; images: { url: string }[] };
}

interface NowPlaying {
  item?: SpotifyTrack | null;
  error?: string;
}

function primaryText(text: string): WidgetSpec {
  return Padding({
    pad: pad(1, 0, 0, 0),
    child: Marquee({
      width: 60,
      child: Padding({
        pad: pad(0, 1, 0, 0),
        child: Text({ content: text.toUpperCase(), color: PRIMARY_COLOR }),
      }),
    }),
  });
}

function detailText(text: string): WidgetSpec {
  return Marquee({ width: 41, child: Text({ content: text.toUpperCase() }) });
}

function errorView(message: string, width: number): WidgetSpec {
  return WrappedText({ content: message, width, color: "#fff" });
}

function albumArtOnly(config: Config, image: Uint8Array): WidgetSpec {
  const width = config.width();
  const height = config.height();
  const size = Math.min(width, height);
  return Box({
    width,
    height,
    child: Image({ src: image, height: size, width: size }),
  });
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

function layoutCompact(trackTitle: string, artist: string, trackImage: Uint8Array): WidgetSpec {
  return Column({
    children: [
      primaryText(trackTitle),
      Padding({
        pad: pad(1, 0, 0, 0),
        child: Row({
          children: [
            Image({ src: trackImage, height: 22, width: 22 }),
            Padding({ pad: pad(1, 0, 0, 0), child: detailText(artist) }),
          ],
        }),
      }),
    ],
  });
}

function layoutVertical(
  trackTitle: string,
  artist: string,
  trackImage: Uint8Array,
  width: number,
): WidgetSpec {
  const artSize = 47;
  return Padding({
    pad: pad(0, 1, 0, 0),
    child: Column({
      crossAlign: "center",
      children: [
        Image({ src: trackImage, height: artSize, width: artSize }),
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
  trackImage: Uint8Array,
): WidgetSpec {
  const artSize = height;
  const gap = 4;
  const textWidth = width - artSize - gap;

  return Stack({
    children: [
      Row({
        children: [
          Image({ src: trackImage, height: artSize, width: artSize }),
          Padding({
            pad: pad(2, 0, 0, 0),
            child: Column({
              children: [
                Marquee({
                  width: textWidth,
                  child: Text({ content: trackTitle.toUpperCase(), font: "6x13", color: PRIMARY_COLOR }),
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
              children: [Image({ src: SPOTIFY_LOGO, width: 16, height: 16 })],
            }),
          }),
        ],
      }),
    ],
  });
}

/** Exchange the stored refresh token for a fresh access token. */
async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await http.post("https://accounts.spotify.com/api/token", {
    headers: { Accept: "application/json" },
    auth: [clientId, clientSecret],
    formBody: { grant_type: "refresh_token", refresh_token: refreshToken },
    ttlSeconds: ACCESS_TOKEN_CACHE_SECONDS,
  });
  if (res.status !== 200) {
    throw new Error(
      `token exchange request failed with status code: ${res.status} - ${res.body()}`,
    );
  }
  const { access_token } = res.json() as { access_token: string };
  return access_token;
}

/**
 * Fetch the currently playing track. Returns null when nothing is playing
 * (204), an `{ error }` shape on non-200, or the parsed API body. With no
 * connected account, falls back to the bundled example so the app previews.
 */
async function getCurrentlyPlaying(config: Config): Promise<NowPlaying | null> {
  const data = config.get("auth");
  if (!data) return JSON.parse(EXAMPLE_DATA) as NowPlaying;

  const parts = data.split(SPOTIFY_AUTH_SEPARATOR);
  const credentials = parts[0];
  const refreshToken = parts[1];
  const [clientId, clientSecret] = credentials.split(":");

  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  const res = await http.get("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204) return null; // nothing playing
  if (res.status !== 200) return { error: `Spotify API error: ${res.status}` };
  return res.json() as NowPlaying;
}

/**
 * Fetch remote album art as raw bytes for Image (24h host-cached).
 *
 * Spotify art is JPEG, which the renderer can't decode, so it's proxied
 * through images.weserv.nl, transcoded to PNG and capped at 128px (the
 * largest panel dimension) to keep the payload small.
 */
async function fetchImage(url: string): Promise<Uint8Array> {
  const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=png&w=128&h=128`;
  const res = await fetch(proxied, { headers: { "x-matrx-ttl": "86400" } });
  return new Uint8Array(await res.arrayBuffer());
}

export default async function render(config: Config): Promise<RootSpec> {
  const currentlyPlaying = await getCurrentlyPlaying(config);

  // Nothing playing (204) — skip display (pixlet returned []).
  if (currentlyPlaying === null) return Root({ child: Box({}) });

  // API error — show error message.
  if (currentlyPlaying.error) {
    return Root({ child: errorView(currentlyPlaying.error, config.width()) });
  }

  // No track item — skip display.
  const item = currentlyPlaying.item;
  if (!item) return Root({ child: Box({}) });

  const trackTitle = item.name;
  const trackImage = await fetchImage(item.album.images[0].url);

  if (config.bool("album_art_only")) {
    return Root({ child: albumArtOnly(config, trackImage) });
  }

  const artist = item.artists[0].name;
  const width = config.width();
  const height = config.height();

  let child: WidgetSpec;
  if (height >= 64 && width >= 128) {
    child = layoutWide(width, height, trackTitle, artist, trackImage);
  } else if (height >= 64) {
    child = layoutVertical(trackTitle, artist, trackImage, width);
  } else {
    child = layoutCompact(trackTitle, artist, trackImage);
  }

  return Root({ child });
}

/**
 * oauth2 handler: runs the authorization_code exchange (user-defined client,
 * so Basic auth uses the user's own id/secret) and persists
 * `client_id:client_secret<SEP>refresh_token` as the connection value.
 *
 * The Starlark original returned `secret.encrypt(...)`; the SDK exposes only
 * `secret.decrypt`, so — like chargepoint — the handler returns the value and
 * the host takes custody of it.
 */
export async function oauthHandler(params: string): Promise<string> {
  const p = JSON.parse(params) as Record<string, string>;
  const res = await http.post("https://accounts.spotify.com/api/token", {
    headers: { Accept: "application/json" },
    auth: [p.client_id, p.client_secret],
    formBody: p,
  });
  if (res.status !== 200) {
    throw new Error(
      `token request failed with status code: ${res.status} - ${res.body()}`,
    );
  }
  const { refresh_token } = res.json() as { refresh_token: string };
  return `${p.client_id}:${p.client_secret}${SPOTIFY_AUTH_SEPARATOR}${refresh_token}`;
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.oauth2({
        id: "auth",
        icon: "cloud",
        name: "Spotify",
        desc: "Connect your Spotify account.",
        handler: "oauthHandler",
        userDefinedClient: true,
        authorizationEndpoint: "https://accounts.spotify.com/authorize",
        scopes: ["user-read-currently-playing"],
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
  "is_playing": true,
  "item": {
    "album": {
      "images": [
        { "height": 640, "url": "https://i.scdn.co/image/ab67616d0000b273b0ce5cacc1047fe929e8f7e7", "width": 640 },
        { "height": 300, "url": "https://i.scdn.co/image/ab67616d00001e02b0ce5cacc1047fe929e8f7e7", "width": 300 },
        { "height": 64, "url": "https://i.scdn.co/image/ab67616d00004851b0ce5cacc1047fe929e8f7e7", "width": 64 }
      ],
      "name": "On My Knees"
    },
    "artists": [{ "name": "RÜFÜS DU SOL" }],
    "name": "Alive"
  },
  "currently_playing_type": "track"
}`;

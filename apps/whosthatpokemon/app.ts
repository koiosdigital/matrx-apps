/**
 * Who's That Pokemon — hand port of `whosthatpokemon/whosthatpokemon.star`
 * (by Nicole Brooks): a random Pokemon silhouette, then the reveal, using
 * the free PokeAPI plus the imgix darkened-sprite trick for the silhouette.
 *
 * Sprites are binary, so they're fetched with raw fetch() + the x-matrx-ttl
 * header (60-day cache like the original). The random pick uses the frozen
 * per-render Math.random, so a new Pokemon appears each render window.
 *
 * Screen sizes: the 64x32 composition centers on 64x64 and doubles (images
 * and offsets, fonts unchanged) on 128x64.
 */

import {
  Box,
  Column,
  Config,
  Image,
  Padding,
  Root,
  Row,
  Stack,
  Text,
  Animation,
  schema,
  type RootSpec,
  type Schema,
  type WidgetSpec,
} from "@koiosdigital/matrx-sdk";
import { http } from "@koiosdigital/matrx-sdk/stdlib";

import BACKGROUND from "./background.png";

const ALL_POKEMON = 1000;
const CLASSIC_POKEMON = 386;
const POKEAPI_URL = "https://pokeapi.co/api/v2/pokemon/";
const IMGIX_URL = "https://pokesprites.imgix.net/";
const CACHE_TTL_SECONDS = 3600 * 24 * 60; // 60 days

const NAMES_WITH_SPACES = [
  "mr-mime", "mime-jr", "type-null", "tapu-koko", "tapu-lele", "tapu-bulu", "tapu-fini",
  "mr-rime", "great-tusk", "scream-tail", "brute-bonnet", "flutter-mane", "slither-wing",
  "sandy-shocks", "iron-treads", "iron-bundle", "iron-hands", "iron-jugulis", "iron-moth",
  "iron-thorns", "roaring-moon", "iron-valiant", "walking-wake", "iron-leaves",
];
const NAMES_WITH_HYPHENS = [
  "ho-oh", "porygon-z", "jangmo-o", "hakamo-o", "kommo-o", "wo-chien", "chien-pao", "chi-yu",
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format API names: keep legit hyphens/spaces, drop form suffixes. */
function formatName(name: string): string {
  if (NAMES_WITH_HYPHENS.includes(name)) return capitalize(name);
  if (NAMES_WITH_SPACES.includes(name)) {
    return name.split("-").map(capitalize).join(" ");
  }
  if (name.includes("-")) return capitalize(name.split("-")[0]);
  return capitalize(name);
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { headers: { "x-matrx-ttl": String(CACHE_TTL_SECONDS) } });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Layout with the "Who's That Pokemon?" text beside the silhouette. */
function fullLayoutHidden(image: Uint8Array, width: number, s: number): WidgetSpec {
  return Row({
    expanded: true,
    mainAlign: "center",
    children: [
      Box({
        width: 30 * s,
        height: 30 * s,
        child: Padding({
          pad: { left: 5 * s, top: 0, right: 0, bottom: 0 },
          child: Image({ src: image, width: width * s, height: 30 * s }),
        }),
      }),
      Box({
        width: 32 * s,
        height: 32 * s,
        child: Column({
          crossAlign: "center",
          children: [
            Text({ content: "Who's", color: "#3B0301", font: "tom-thumb" }),
            Box({ height: 3 * s }),
            Text({ content: "That", color: "#3B0301", font: "tom-thumb" }),
            Box({ height: 3 * s }),
            Text({ content: "Pokemon?", color: "#3B0301", font: "tom-thumb" }),
          ],
        }),
      }),
    ],
  });
}

/** Layout with the name under the revealed sprite. */
function fullLayoutRevealed(image: Uint8Array, width: number, text: string, s: number): WidgetSpec {
  return Stack({
    children: [
      Box({
        width: 38 * s,
        height: 30 * s,
        child: Image({ src: image, width: width * s, height: 30 * s }),
      }),
      Padding({
        pad: { left: 0, top: 24 * s, right: 0, bottom: 0 },
        child: Box({
          height: 9 * s,
          child: Text({ content: text, offset: 0, color: "#240109" }),
        }),
      }),
    ],
  });
}

const TRANSITION_WIDTHS = [18, 12, 6, 1, 1, 6, 12, 18];

function compileFrames(
  name: string,
  silhouette: Uint8Array,
  revealedImage: Uint8Array,
  speed: number,
  s: number,
): WidgetSpec[] {
  const frames: WidgetSpec[] = [];
  const frameCount = Math.floor(speed * 8);
  const startTransition = frameCount / 2 - 4;
  const endTransition = frameCount / 2 + 4;
  let transitionFrame = 0;
  for (let frame = 1; frame < frameCount; frame++) {
    if (frame < startTransition) {
      frames.push(fullLayoutHidden(silhouette, 30, s));
    } else if (frame >= endTransition) {
      frames.push(fullLayoutRevealed(revealedImage, 30, name, s));
    } else {
      const width = TRANSITION_WIDTHS[transitionFrame];
      if (transitionFrame > 3) {
        frames.push(fullLayoutRevealed(revealedImage, width, name, s));
      } else {
        frames.push(fullLayoutHidden(silhouette, width, s));
      }
      transitionFrame += 1;
    }
  }
  return frames;
}

export default async function render(config: Config): Promise<RootSpec | null> {
  const allPokemon = config.bool("classics_only", true) ? CLASSIC_POKEMON : ALL_POKEMON;
  const chosenId = 1 + Math.floor(Math.random() * allPokemon);
  const speed = parseFloat(config.get("speed", "15")!);

  const res = await http.get(`${POKEAPI_URL}${chosenId}`, { ttlSeconds: CACHE_TTL_SECONDS });
  if (res.status !== 200) return null;
  const pokemon = res.json() as { name: string; sprites: { front_default: string | null } };

  const spriteUrl = pokemon.sprites.front_default;
  if (!spriteUrl) return null;

  const name = formatName(pokemon.name);
  const [revealedImage, silhouette] = await Promise.all([
    fetchImage(spriteUrl),
    fetchImage(`${IMGIX_URL}${chosenId}.png?bri=-100`),
  ]);

  // If something went wrong with the API, skip the app completely.
  if (revealedImage === null || silhouette === null) return null;

  const width = config.width();
  const height = config.height();
  const s = width >= 128 && height >= 64 ? 2 : 1;

  const frames = compileFrames(name, silhouette, revealedImage, speed, s);

  return Root({
    delay: 125,
    child: Box({
      child: Stack({
        children: [
          Image({ src: BACKGROUND, width: 64 * s, height: 32 * s }),
          Animation({ children: frames }),
        ],
      }),
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.toggle({
        id: "classics_only",
        name: "Classic Mode",
        desc: "Only use Pokemon from generations 1-3. On by default.",
        icon: "dragon",
        default: true,
      }),
      schema.dropdown({
        id: "speed",
        name: "Speed",
        desc: "How long the silhouette is displayed.",
        icon: "stopwatch",
        default: "15",
        options: [
          schema.option({ display: "Normal", value: "15" }),
          schema.option({ display: "Quick", value: "10" }),
          schema.option({ display: "Turbo", value: "7.5" }),
          schema.option({ display: "Plaid", value: "5" }),
        ],
      }),
    ],
  });
}

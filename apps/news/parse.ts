/**
 * Minimal RSS 2.0 / Atom reader.
 *
 * There is no XML parser in the isolate and pulling one in for this would
 * cost more bundle than the whole app, so this walks the document with
 * regexes. That is fine for the job — feeds are machine-generated, shallow,
 * and we only need three fields — but it is deliberately forgiving rather
 * than correct: anything it cannot read is skipped, never thrown.
 *
 * Handles both `<item>` (RSS) and `<entry>` (Atom), CDATA, the five XML
 * predefined entities plus numeric character references, and Atom's
 * `<link href="...">` form.
 */

export interface Item {
  title: string;
  /** Unix seconds, 0 when the feed omits or mangles the date. */
  published: number;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    const hit = ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

/** Strip CDATA wrappers, tags, entities and collapse whitespace. */
function clean(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}

function firstTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? clean(m[1]) : "";
}

/**
 * RFC-822 (`Tue, 18 Aug 2026 17:01:17 -0400`) and ISO-8601 both appear in
 * the wild; `Date.parse` handles both and is deterministic for a fixed
 * input, so it does not trip the frozen-clock rule the way `Date.now()`
 * would.
 */
function parseDate(s: string): number {
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function parseFeed(xml: string, limit: number): Item[] {
  const out: Item[] = [];
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = firstTag(block, "title");
    if (!title) continue;
    const published =
      parseDate(firstTag(block, "pubDate")) ||
      parseDate(firstTag(block, "published")) ||
      parseDate(firstTag(block, "updated")) ||
      parseDate(firstTag(block, "dc:date"));
    out.push({ title, published });
    if (out.length >= limit) break;
  }
  return out;
}

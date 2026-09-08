/**
 * Curated sources.
 *
 * These are a dropdown rather than a free-text URL because `allowedHosts`
 * is an egress allowlist: a feed on any other host is refused by the fetch
 * adapter, not by this app. The custom-URL field still exists for the
 * hosts listed in the manifest (a self-hosted feed behind one of them, a
 * different NPR or BBC section), and the field description says so.
 *
 * Every URL here was fetched and parsed before being listed.
 */

export interface Source {
  id: string;
  label: string;
  url: string;
}

export const SOURCES: Source[] = [
  { id: "npr", label: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
  { id: "bbc", label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "nyt", label: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { id: "sky", label: "Sky News World", url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { id: "ars", label: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { id: "verge", label: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { id: "hn", label: "Hacker News", url: "https://hnrss.org/frontpage" },
];

export function sourceById(id: string): Source {
  for (const s of SOURCES) if (s.id === id) return s;
  return SOURCES[0];
}

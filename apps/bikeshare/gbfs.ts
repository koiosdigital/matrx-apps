/**
 * GBFS client.
 *
 * GBFS is the reason this app needs no credential at all: every system
 * publishes the same documented JSON at a discovery URL, so there is no
 * key to bake, no quota to exhaust and no proxy to stand up — the failure
 * modes that dog the stocks and weather apps simply do not exist here.
 *
 * Systems below were each fetched and confirmed to serve stations before
 * being listed. Most resolve to gbfs.lyft.com, which operates the majority
 * of large North American systems; the manifest allowlists both the
 * discovery hosts and the hosts the feeds actually live on.
 */

import { http } from "@koiosdigital/matrx-sdk/stdlib";

export interface System {
  id: string;
  label: string;
  discovery: string;
}

export const SYSTEMS: System[] = [
  { id: "nyc", label: "Citi Bike (New York)", discovery: "https://gbfs.citibikenyc.com/gbfs/gbfs.json" },
  { id: "chi", label: "Divvy (Chicago)", discovery: "https://gbfs.divvybikes.com/gbfs/gbfs.json" },
  { id: "sfo", label: "Bay Wheels (San Francisco)", discovery: "https://gbfs.baywheels.com/gbfs/gbfs.json" },
  { id: "bos", label: "Bluebikes (Boston)", discovery: "https://gbfs.bluebikes.com/gbfs/gbfs.json" },
  { id: "dca", label: "Capital Bikeshare (Washington DC)", discovery: "https://gbfs.capitalbikeshare.com/gbfs/gbfs.json" },
  { id: "pdx", label: "Biketown (Portland)", discovery: "https://gbfs.biketownpdx.com/gbfs/gbfs.json" },
  { id: "yul", label: "Bixi (Montreal)", discovery: "https://gbfs.velobixi.com/gbfs/gbfs.json" },
];

export function systemById(id: string): System {
  for (const s of SYSTEMS) if (s.id === id) return s;
  return SYSTEMS[0];
}

/** Discovery is static in practice; a day of caching is generous and safe. */
const DISCOVERY_TTL = 86400;
/** Station names and capacities change on the order of months. */
const INFORMATION_TTL = 86400;
/** The spec's own `ttl` on status feeds is 60s. */
const STATUS_TTL = 60;

interface FeedEntry {
  name?: string;
  url?: string;
}

/**
 * Resolve a named feed from the discovery document. Language keys vary by
 * system (`en`, `fr`, sometimes only one), so this prefers English and
 * falls back to whatever the system publishes first.
 */
async function feedUrl(discovery: string, want: string): Promise<string | null> {
  const res = await http.get(discovery, { ttlSeconds: DISCOVERY_TTL });
  if (res.status !== 200) return null;
  const body = res.json() as { data?: Record<string, { feeds?: FeedEntry[] }> };
  const langs = body.data ?? {};
  const key = langs.en ? "en" : Object.keys(langs)[0];
  if (!key) return null;
  for (const feed of langs[key]?.feeds ?? []) {
    if (feed.name === want && feed.url) return feed.url;
  }
  return null;
}

export interface StationInfo {
  id: string;
  name: string;
}

/** Station directory — only used by the config-time search, never at render. */
export async function searchStations(discovery: string, query: string): Promise<StationInfo[]> {
  const url = await feedUrl(discovery, "station_information");
  if (!url) return [];
  const res = await http.get(url, { ttlSeconds: INFORMATION_TTL });
  if (res.status !== 200) return [];
  const body = res.json() as { data?: { stations?: { station_id?: string; name?: string }[] } };
  const needle = query.trim().toLowerCase();
  const out: StationInfo[] = [];
  for (const s of body.data?.stations ?? []) {
    if (!s.station_id || !s.name) continue;
    if (needle && !s.name.toLowerCase().includes(needle)) continue;
    out.push({ id: s.station_id, name: s.name });
    if (out.length >= 25) break;
  }
  return out;
}

export interface Status {
  bikes: number;
  ebikes: number;
  docks: number;
  /** Bikes and docks that exist but are out of service. */
  disabled: number;
  /** Derived: everything the rack physically holds. */
  capacity: number;
  renting: boolean;
  returning: boolean;
  installed: boolean;
  found: boolean;
}

/**
 * One station's live status.
 *
 * Only `station_status` is fetched at render time. The station's NAME is
 * carried in the config value instead of being looked up, which skips the
 * `station_information` file entirely — on a system like Citi Bike that is
 * 2500 stations of static JSON parsed on every single render, to recover
 * one string the user already chose.
 */
export async function fetchStatus(discovery: string, stationId: string): Promise<Status | null> {
  const url = await feedUrl(discovery, "station_status");
  if (!url) return null;
  const res = await http.get(url, { ttlSeconds: STATUS_TTL });
  if (res.status !== 200) return null;
  const body = res.json() as {
    data?: {
      stations?: {
        station_id?: string;
        num_bikes_available?: number;
        num_ebikes_available?: number;
        num_bikes_disabled?: number;
        num_docks_available?: number;
        num_docks_disabled?: number;
        is_renting?: number | boolean;
        is_returning?: number | boolean;
        is_installed?: number | boolean;
      }[];
    };
  };
  for (const s of body.data?.stations ?? []) {
    if (s.station_id !== stationId) continue;
    const bikes = s.num_bikes_available ?? 0;
    const docks = s.num_docks_available ?? 0;
    const disabled = (s.num_bikes_disabled ?? 0) + (s.num_docks_disabled ?? 0);
    return {
      bikes,
      ebikes: Math.min(bikes, s.num_ebikes_available ?? 0),
      docks,
      disabled,
      capacity: Math.max(1, bikes + docks + disabled),
      renting: s.is_renting !== 0 && s.is_renting !== false,
      returning: s.is_returning !== 0 && s.is_returning !== false,
      installed: s.is_installed !== 0 && s.is_installed !== false,
      found: true,
    };
  }
  return null;
}

/** Example data for an unconfigured install and the gallery preview. */
export function demoStatus(): Status {
  return {
    bikes: 12,
    ebikes: 3,
    docks: 7,
    disabled: 1,
    capacity: 20,
    renting: true,
    returning: true,
    installed: true,
    found: false,
  };
}

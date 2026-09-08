/**
 * OAuth2 for the providers that actually offer it.
 *
 * Google and Microsoft both expose a real calendar API behind OAuth, which
 * is strictly better than an iCal feed: the server expands recurrences, the
 * user grants access with a click instead of hunting for a secret URL, and
 * revoking it is a normal account action rather than rotating a link.
 *
 * Apple is deliberately absent. iCloud has no public OAuth calendar API —
 * "Sign in with Apple" is identity only — so Apple calendars are reached
 * through a published .ics feed, and that is a limitation of the platform
 * rather than of this app.
 *
 * The flow mirrors apps/chargepoint: PKCE public clients, the handler
 * forwards the exchange and stores the REFRESH token as the connection's
 * value, and access tokens are minted on demand and cached. Refresh-token
 * rotation is handled the way apps/ouraring does it.
 */

import { cache, http, secret } from "@koiosdigital/matrx-sdk/stdlib";

export interface OAuthProvider {
  id: string;
  clientId: string;
  /** Output of `npx matrx secret encrypt calendar '<secret>'`, or "" for a
   *  pure PKCE public client that needs none. */
  encryptedSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

export const GOOGLE: OAuthProvider = {
  id: "google",
  clientId: "REPLACE_ME.apps.googleusercontent.com",
  encryptedSecret: "MTX1:REPLACE_ME",
  // access_type/prompt are required to be issued a refresh token at all.
  authorizationEndpoint:
    "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
};

export const MICROSOFT: OAuthProvider = {
  id: "microsoft",
  clientId: "REPLACE_ME",
  // Microsoft public clients work on PKCE alone; no secret to bake.
  encryptedSecret: "",
  authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["offline_access", "Calendars.Read"],
};

const ACCESS_CACHE_SECONDS = 3000;
const REFRESH_CHAIN_SECONDS = 86400 * 14;

async function clientSecret(p: OAuthProvider): Promise<string | null> {
  if (!p.encryptedSecret) return null;
  try {
    return await secret.decrypt(p.encryptedSecret);
  } catch {
    return null;
  }
}

/**
 * Complete the authorization-code exchange and return the refresh token.
 *
 * The host stores whatever this returns once and config is read-only after,
 * so it must be the durable credential — the refresh token, never the
 * hour-long access token.
 */
export async function exchangeCode(p: OAuthProvider, params: string): Promise<string> {
  const form = JSON.parse(params) as Record<string, string>;
  const body: Record<string, string> = { ...form, client_id: p.clientId };
  const cs = await clientSecret(p);
  if (cs) body["client_secret"] = cs;
  if (!body["grant_type"]) body["grant_type"] = "authorization_code";

  const res = await http.post(p.tokenEndpoint, {
    headers: { Accept: "application/json" },
    formBody: body,
  });
  if (res.status !== 200) {
    throw new Error(`token exchange failed: ${res.status} ${res.body()}`);
  }
  const token = res.json() as { refresh_token?: string; access_token?: string };
  const refresh = token.refresh_token ?? token.access_token;
  if (!refresh) throw new Error("token response carried neither refresh nor access token");
  return refresh;
}

/**
 * Mint an access token from the stored refresh token, cached for its
 * lifetime. Providers that rotate refresh tokens hand back a new one, so
 * the chain is followed and the original stays the cache key — the config
 * value can never be rewritten.
 */
export async function accessToken(p: OAuthProvider, storedRefresh: string): Promise<string | null> {
  if (!storedRefresh) return null;
  const key = `access:${p.id}:${storedRefresh}`;
  const cached = await cache.get(key);
  if (cached !== null) return cached;

  const chainKey = `refresh:${p.id}:${storedRefresh}`;
  const latest = (await cache.get(chainKey)) ?? storedRefresh;
  const cs = await clientSecret(p);

  const exchange = (refresh: string) => {
    const body: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: p.clientId,
    };
    if (cs) body["client_secret"] = cs;
    if (p.scopes.length > 0) body["scope"] = p.scopes.join(" ");
    return http.post(p.tokenEndpoint, { headers: { Accept: "application/json" }, formBody: body });
  };

  let res = await exchange(latest);
  if (res.status !== 200 && latest !== storedRefresh) {
    // The rotation cache can be stale; the original still works until the
    // provider retires it.
    res = await exchange(storedRefresh);
  }
  if (res.status !== 200) return null;

  const body = res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  const ttl = Math.min(ACCESS_CACHE_SECONDS, Math.max(300, (body.expires_in ?? 3600) - 300));
  await cache.set(key, body.access_token, ttl);
  if (body.refresh_token && body.refresh_token !== latest) {
    await cache.set(chainKey, body.refresh_token, REFRESH_CHAIN_SECONDS);
  }
  return body.access_token;
}

/**
 * HMAC-SHA256 request signing for the aeronav flights API. Mirrors the
 * server's `signing.ts` (koiosdigital/flights-api): the canonical message is
 * `${METHOD}\n${PATH + QUERY}\n${RAW_BODY}` and the hex digest travels in the
 * `X-Request-Signature` header.
 *
 * The shared secret is baked into the bundle — the API gates on possession of
 * the key, not on it being private to each device. WebCrypto (`crypto.subtle`)
 * is available as a platform global inside the render isolate.
 */

const REQUEST_SIGNING_SECRET =
  "2fb30a0807dd17451248eea38b939946057d4fe36b80005f1b360967e6ea4f288a72e520394c5d24b11afe4eecfd32074dd07605c586ad2f316bdce320f1376d";

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Hex-encoded HMAC signature for a request, matching the server's scheme. */
export async function computeSignature(
  method: string,
  pathWithQuery: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(REQUEST_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new Uint8Array(encoder.encode(`${method}\n${pathWithQuery}\n${body}`));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return bytesToHex(new Uint8Array(sig));
}

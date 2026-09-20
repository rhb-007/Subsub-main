// Cloudflare Access — edge authentication for the internal console.
//
// Access sits in front of admin.subsub.work and will not pass a request
// through until the person has signed in with Google Workspace. When it does,
// it adds a signed JWT naming who they are. Verifying that here means the
// console needs no login of its own: an unauthenticated stranger never
// reaches this Worker at all, and a request that does arrive has already been
// vouched for by Cloudflare.
//
// The header has to be verified rather than read. It is only trustworthy
// because Access signed it -- an unsigned request carrying the same header,
// arriving at a hostname Access does not cover, is just a claim.

// Cached per isolate. The keys rotate, so this is a short-lived cache and not
// a permanent one; a key that has rotated shows up as a failed verification,
// which refetches.
let jwksCache = { at: 0, teamDomain: "", keys: null };
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getKeys(teamDomain) {
  const fresh = jwksCache.keys
    && jwksCache.teamDomain === teamDomain
    && Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access_certs_${res.status}`);
  const body = await res.json();
  jwksCache = { at: Date.now(), teamDomain, keys: body.keys || [] };
  return jwksCache.keys;
}

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};
const b64urlToString = (s) => new TextDecoder().decode(b64urlToBytes(s));

// Returns the claims, or null. Null means "not from Access", and the caller
// must treat the request as anonymous -- never as merely unverified.
export async function verifyAccessJwt(env, token) {
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").trim();
  const audience = String(env.ACCESS_AUD || "").trim();
  if (!token || !teamDomain || !audience) return null;

  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  let header, claims;
  try {
    header = JSON.parse(b64urlToString(headerB64));
    claims = JSON.parse(b64urlToString(payloadB64));
  } catch { return null; }
  if (header.alg !== "RS256") return null;

  let keys;
  try { keys = await getKeys(teamDomain); } catch { return null; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
  } catch { return null; }
  if (!ok) return null;

  // A valid signature over the wrong audience is somebody else's token: every
  // Access application in the account is signed by the same keys, so without
  // this check a token minted for any other app would pass here.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) return null;
  if (claims.iss !== `https://${teamDomain}`) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
  if (!claims.email) return null;

  return claims;
}

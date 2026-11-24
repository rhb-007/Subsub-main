// The front door of subsub.work.
//
// The site is static files, and until this existed they were served exactly
// as asked: http://subsub.work answered over plain HTTP with no redirect and
// no HSTS, which is what a browser draws as "Not secure". So every request
// passes through here first (run_worker_first in wrangler.jsonc):
//
//   - plain HTTP is sent to the same address over HTTPS (301);
//   - www.subsub.work is sent to subsub.work, one address for one site;
//   - every answer carries HSTS, so a browser that has been here once never
//     asks over HTTP again, and the ordinary security headers.
//
// HSTS deliberately does NOT carry includeSubDomains or preload. Every
// *.subsub.work host is on Cloudflare and answers over HTTPS today, but
// includeSubDomains is a promise about hosts this file does not serve, and a
// preload is close to impossible to take back. Turning either on is a decision
// for the whole domain, not for the marketing site.
//
// Not published as an asset: .assetsignore is an allow-list and names no .js.

export const HSTS = "max-age=31536000";

export const SECURITY_HEADERS = {
  "Strict-Transport-Security": HSTS,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  // Only what cannot break a page: upgrade anything still asked for over HTTP,
  // and refuse to be framed by another site. A full script policy would have to
  // name the Google tag, Cal and every inline script, and a wrong one blanks
  // pages silently.
  "Content-Security-Policy": "upgrade-insecure-requests; frame-ancestors 'self'",
};

export function redirectFor(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal) return null;
  let move = false;
  if (url.protocol === "http:") { url.protocol = "https:"; move = true; }
  if (host === "www.subsub.work") { url.hostname = "subsub.work"; move = true; }
  if (!move) return null;
  url.port = "";
  return new Response(null, { status: 301, headers: { Location: url.toString(), ...SECURITY_HEADERS } });
}

export function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    const moved = redirectFor(request);
    if (moved) return moved;
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};

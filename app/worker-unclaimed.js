// *.subsub.work, for the addresses nothing else answers.
//
// A Scale account's branded address is a CNAME this API provisions plus a
// custom domain on the Pages project. Every other name under the domain had
// no DNS record at all, so a Basic account's address, or a mistyped one,
// failed in the browser with "server can't be found". With a proxied
// wildcard DNS record and this Worker on the *.subsub.work/* route, those
// addresses get a page instead (shared/unclaimed.js).
//
// What it must never do is stand in front of something real. So:
//   - reserved names (app, api, admin, www...) and anything not one label
//     under the domain pass straight through, without asking anybody;
//   - a branded address on Scale passes through to the app;
//   - and when the answer cannot be had -- the API down, a timeout, a
//     shape it does not know -- it passes through as well. Failing open
//     costs an unclaimed address the old browser error; failing closed
//     would put this page over a paying customer's sign-in.
//
// fetch(request) from a route Worker goes to the hostname's own origin and
// does not run this Worker again.
import { NEVER_PROVISION } from "./worker/hostnames.js";
import { hostDecision, unclaimedPage } from "./shared/unclaimed.js";

export async function decide(request, env) {
  const url = new URL(request.url);
  const d = hostDecision(url.hostname, env.APP_DOMAIN || "subsub.work", NEVER_PROVISION);
  if (d.pass) return "pass";
  try {
    const r = await env.API.fetch(new Request(
      `https://api.subsub.work/api/account-by-subdomain/${encodeURIComponent(d.sub)}/live`,
      { signal: AbortSignal.timeout(4000) }));
    if (!r.ok) return "pass";
    const b = await r.json();
    if (b?.live === true) return "pass";
    if (b?.live === false) return "page";
    return "pass";
  } catch {
    return "pass";
  }
}

export default {
  async fetch(request, env) {
    if (await decide(request, env) === "pass") return fetch(request);
    return new Response(unclaimedPage(new URL(request.url).hostname), {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  },
};

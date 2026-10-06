// The probes behind the console's three system lights. The rule for what a
// light means is shared/syshealth.js; this is only the measuring.
//
// Each host is asked over the PUBLIC internet, which is what a customer's
// browser does -- the console's own /api calls arrive over a service binding
// and say nothing about whether api.subsub.work answers from outside. That
// needs `global_fetch_strictly_public` (wrangler.toml): without it Cloudflare
// refuses a Worker's fetch to another Worker in the same zone, and the probe
// would report its own restriction as the site being down. looksBlocked()
// still catches that refusal if the flag is ever removed, and says so rather
// than drawing red.
import { HEALTH_HOSTS, TIMEOUT_MS, lightFor, looksBlocked } from "../shared/syshealth.js";

async function probe(h, domain, fetchImpl, now) {
  const host = domain === "subsub.work" ? h.host : h.host.replace(/subsub\.work$/, domain);
  const url = `https://${host}${h.path}${h.path.includes("?") ? "&" : "?"}_health=${now()}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = now();
  let r;
  try {
    // Manual redirects: the console answers an Access-less request with a
    // redirect to the login, and following it would time the login page.
    const res = await fetchImpl(url, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "SubSub health check" } });
    const ms = now() - t0;
    let body = "";
    if (res.status >= 400) body = await res.text().catch(() => "");
    r = looksBlocked(res.status, body) ? { blocked: true, status: res.status, ms } : { status: res.status, ms };
  } catch (e) {
    r = { error: e?.name === "AbortError" ? "" : String(e?.message || e).slice(0, 160), timedOut: e?.name === "AbortError" };
  } finally {
    clearTimeout(timer);
  }
  return { id: h.id, host, label: h.label, ...r, ...lightFor(h, r) };
}

// All three at once, so the slowest decides how long the panel waits rather
// than the sum of them. And the database, timed, beside the API: a ping that
// answers over a database that does not is an API nobody can use.
export async function systemHealth(env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const domain = env.APP_DOMAIN || "subsub.work";
  const hosts = await Promise.all(HEALTH_HOSTS.map((h) => probe(h, domain, fetchImpl, now)));

  let db;
  const t0 = now();
  try {
    await env.DB.prepare("SELECT 1 AS one").first();
    db = { ok: true, ms: now() - t0 };
  } catch (e) {
    db = { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
  const api = hosts.find((h) => h.id === "api");
  if (api) {
    api.db = db;
    if (!db.ok) { api.light = "red"; api.say = "The API answered, but its database did not."; }
  }
  return { checkedAt: new Date(now()).toISOString(), hosts };
}

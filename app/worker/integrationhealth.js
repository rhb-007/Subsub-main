// The live half of the console's integration lights: one read-only call per
// provider, made with the credentials the Worker actually holds. The rule for
// turning an answer into a light is shared/syshealth.js.
//
// Every call here READS. Nothing is created, sent or charged: a check that
// texted somebody or opened a Stripe object every time Health was opened would
// be worse than no check. That is why some integrations have no probe at all
// -- the licence verifiers bill per lookup, the cron secret has nothing
// upstream to ask, and Connect's webhook secret is only ever proven by Stripe
// signing an event with it -- and those report "Configured", not "Working".
import { TIMEOUT_MS } from "../shared/syshealth.js";
import { smsConfig } from "./sms.js";
import { diagnose } from "./hostnames.js";
import { calConfigured, fetchSlots } from "./demo.js";
import { ANTHROPIC_API, ANTHROPIC_VERSION } from "./ai.js";

const clean = (v) => String(v ?? "").trim();

async function timed(fetchImpl, now, url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = now();
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, json, text, ms: now() - t0 };
  } catch (e) {
    return { failed: true, timedOut: e?.name === "AbortError", error: e?.name === "AbortError" ? "" : String(e?.message || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
const asProbe = (r, okSay, refusedSay) => {
  if (r.failed) return { error: r.error, timedOut: r.timedOut };
  if (r.status === 401 || r.status === 403) return { refused: true, status: r.status, ms: r.ms, say: refusedSay };
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return { ms: r.ms, say: okSay };
};

export const PROBES = {
  // The health endpoint answers only with the anon key attached, so a 200 is
  // both "Supabase is up" and "this key belongs to this project".
  auth: async (env, f, now) => {
    const url = clean(env.SUPABASE_URL).replace(/\/+$/, "");
    const r = await timed(f, now, `${url}/auth/v1/health`, { headers: { apikey: clean(env.SUPABASE_ANON_KEY) } });
    return asProbe(r, "Supabase answered and accepted the key.",
      "Supabase refused SUPABASE_ANON_KEY. It may belong to a different project than SUPABASE_URL.");
  },
  // Google sign-in. Google's own client id and secret are held by Supabase,
  // not by this Worker, so nothing here can test them directly -- but the
  // settings endpoint says whether Supabase has the Google provider switched
  // on, which is the failure that actually happens: a provider toggled off,
  // or a project rebuilt without it, and every "Continue with Google" button
  // on every sign-in page answers an error while email sign-in works and the
  // Supabase light above stays green. Read-only, and the same anon key.
  google: async (env, f, now) => {
    const url = clean(env.SUPABASE_URL).replace(/\/+$/, "");
    const r = await timed(f, now, `${url}/auth/v1/settings`, { headers: { apikey: clean(env.SUPABASE_ANON_KEY) } });
    const p = asProbe(r, "Supabase has Google sign-in switched on.",
      "Supabase refused SUPABASE_ANON_KEY, so it could not say whether Google sign-in is on.");
    if (p.refused || p.error !== undefined || p.timedOut) return p;
    const g = r.json?.external?.google;
    if (g === false) {
      return { off: true, ms: r.ms,
        say: "Google sign-in is switched off in Supabase, so the Continue with Google button on every sign-in page fails. Email sign-in still works." };
    }
    if (g !== true) return { warn: true, ms: r.ms, say: "Supabase answered without saying whether Google sign-in is on." };
    return p;
  },
  // A sending-only key cannot list domains and Resend says exactly that, in a
  // 401 named restricted_api_key. That is a key Resend recognised, which is
  // the question, so it is green -- reading it as refused would draw red over
  // the safest kind of key to have.
  mail: async (env, f, now) => {
    const base = (env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "");
    const r = await timed(f, now, `${base}/domains`, { headers: { Authorization: `Bearer ${clean(env.RESEND_API_KEY)}` } });
    if (!r.failed && r.status === 401 && r.json?.name === "restricted_api_key") {
      return { ms: r.ms, say: "Resend accepted the key (it is a sending-only key)." };
    }
    return asProbe(r, "Resend accepted the key.", "Resend refused RESEND_API_KEY.");
  },
  // The balance is the cheapest authenticated read Stripe has. A test-mode key
  // in production works perfectly and takes no real money, which is the one
  // way this can be wrong while every call succeeds -- so it is amber.
  billing: async (env, f, now) => {
    const base = (env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");
    const r = await timed(f, now, `${base}/v1/balance`, { headers: { Authorization: `Bearer ${clean(env.STRIPE_SECRET_KEY)}` } });
    const p = asProbe(r, "Stripe accepted the key (live mode).", "Stripe refused STRIPE_SECRET_KEY.");
    if (!p.refused && p.error === undefined && !p.timedOut && r.json && r.json.livemode === false) {
      return { warn: true, ms: r.ms, say: "Stripe accepted the key, but it is a TEST-mode key: no real payment can be taken." };
    }
    return p;
  },
  // The account record, which also says whether Twilio has suspended it.
  sms: async (env, f, now) => {
    const cfg = smsConfig(env);
    if (!cfg) return { error: "settings incomplete" };
    const auth = btoa(`${cfg.sid}:${cfg.token}`);
    const r = await timed(f, now, `${cfg.base}/Accounts/${cfg.sid}.json`, { headers: { Authorization: `Basic ${auth}` } });
    const p = asProbe(r, "Twilio accepted the account and token.", "Twilio refused TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN.");
    const status = r.json?.status;
    if (!p.refused && p.error === undefined && !p.timedOut && status && status !== "active") {
      return { refused: true, ms: r.ms, say: `Twilio says the account is ${status}: no text will send.` };
    }
    return p;
  },
  // The same three probes the branded-address diagnosis already makes, so a
  // green here is the same evidence that panel gives.
  hostnames: async (env, f, now) => {
    const t0 = now();
    let d;
    try { d = await diagnose(env); } catch (e) { return { error: String(e?.message || e).slice(0, 160) }; }
    const bad = (d.checks || []).find((ch) => !ch.ok);
    if (bad) return { refused: true, ms: now() - t0, say: `${bad.label}: ${bad.detail || "failed"}` };
    return { ms: now() - t0, say: "The token, the zone's DNS and the Pages project all answered." };
  },
  // Public, and exactly what staff sign-in fetches to verify a request.
  staff: async (env, f, now) => {
    const team = clean(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const r = await timed(f, now, `https://${team}/cdn-cgi/access/certs`);
    const p = asProbe(r, "Access published its signing keys.", "Access refused the request.");
    if (!p.refused && p.error === undefined && !p.timedOut && !(r.json?.keys?.length)) {
      return { refused: true, ms: r.ms, say: "That team domain published no signing keys. ACCESS_TEAM_DOMAIN may be wrong." };
    }
    return p;
  },
  // The model list: free, read-only, and refused outright for a bad key. The
  // drafting call itself costs money per press, so it is never the probe.
  ai: async (env, f, now) => {
    const base = (env.ANTHROPIC_API_BASE || ANTHROPIC_API).replace(/\/+$/, "");
    const r = await timed(f, now, `${base}/models?limit=1`, {
      headers: { "x-api-key": clean(env.ANTHROPIC_API_KEY), "anthropic-version": ANTHROPIC_VERSION },
    });
    return asProbe(r, "Anthropic accepted the key.", "Anthropic refused ANTHROPIC_API_KEY.");
  },
  // The very call the demo form makes: a week of real availability. It
  // creates nothing.
  demo: async (env, f, now) => {
    if (!calConfigured(env)) return { error: "settings incomplete" };
    const t0 = now();
    const start = new Date(now()).toISOString().slice(0, 10);
    const end = new Date(now() + 7 * 86400000).toISOString().slice(0, 10);
    let r;
    try { r = await fetchSlots(env, { start, end, timeZone: "UTC" }); }
    catch (e) { return { error: String(e?.message || e).slice(0, 160) }; }
    if (!r.ok) return { refused: true, ms: now() - t0, say: r.reason === "shape" ? "Cal answered in a shape SubSub does not read." : "Cal refused the request for times." };
    return { ms: now() - t0, say: "Cal answered with the week's times." };
  },
};

// Only for groups whose settings are all there: asking a provider with half a
// credential tells you nothing the settings check has not already said.
export async function integrationHealth(env, groups, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const out = {};
  await Promise.all(groups.map(async (g) => {
    if (g.state !== "ok" || !PROBES[g.id]) return;
    try { out[g.id] = await PROBES[g.id](env, fetchImpl, now); }
    catch (e) { out[g.id] = { error: String(e?.message || e).slice(0, 160) }; }
  }));
  return { checkedAt: new Date(now()).toISOString(), probes: out };
}

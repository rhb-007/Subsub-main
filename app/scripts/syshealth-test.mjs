// The console's three system lights: what each answer turns into, and that
// the probes ask the right addresses the right way.
//
//   node scripts/syshealth-test.mjs
import { lightFor, looksBlocked, HEALTH_HOSTS, SLOW_MS, integrationLight } from "../shared/syshealth.js";
import { integrationHealth } from "../worker/integrationhealth.js";
import { systemHealth } from "../worker/syshealth.js";
import { readFileSync } from "node:fs";

let failed = 0;
const ok = (label, cond, detail = "") => {
  console.log(cond ? `  ok   ${label}` : `  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  if (!cond) { failed++; process.exitCode = 1; }
};
const H = Object.fromEntries(HEALTH_HOSTS.map((h) => [h.id, h]));

console.log("lightFor");
ok("a quick 200 is green", lightFor(H.app, { status: 200, ms: 120 }).light === "green");
ok("a redirect is green -- the site answered", lightFor(H.app, { status: 302, ms: 80 }).light === "green");
ok("a slow 200 is amber", lightFor(H.app, { status: 200, ms: SLOW_MS + 1 }).light === "amber");
ok("just under the line is still green", lightFor(H.app, { status: 200, ms: SLOW_MS - 1 }).light === "green");
ok("a 404 is amber, not green", lightFor(H.app, { status: 404, ms: 50 }).light === "amber");
ok("a 500 is red", lightFor(H.api, { status: 503, ms: 50 }).light === "red");
ok("no answer is red", lightFor(H.api, { error: "fetch failed" }).light === "red");
ok("a timeout is red and says so", /within/.test(lightFor(H.api, { timedOut: true, error: "" }).say)
  && lightFor(H.api, { timedOut: true, error: "" }).light === "red");
// The console is behind Access: a 403 with no Access cookie IS it answering.
ok("admin behind Access: 403 is green", lightFor(H.admin, { status: 403, ms: 60 }).light === "green");
ok("but a 403 from the app is amber", lightFor(H.app, { status: 403, ms: 60 }).light === "amber");
ok("a check Cloudflare refused is unknown, not red", lightFor(H.app, { blocked: true, status: 403 }).light === "unknown");
ok("never checked is unknown", lightFor(H.app, null).light === "unknown");
ok("1042 reads as blocked", looksBlocked(403, "error code: 1042"));
ok("an ordinary 403 does not", !looksBlocked(403, "Forbidden"));

console.log("systemHealth");
const asked = [];
let answers;
const fetchImpl = async (url, init) => {
  asked.push({ url, init });
  const host = new URL(url).hostname;
  const a = answers[host];
  if (a instanceof Error) throw a;
  return new Response(a.body || "", { status: a.status });
};
let clock = 1000;
const now = () => clock;
const db = (good) => ({ prepare: () => ({ first: async () => { if (!good) throw new Error("D1 down"); return { one: 1 }; } }) });

answers = {
  "admin.subsub.work": { status: 302 },
  "api.subsub.work": { status: 200 },
  "app.subsub.work": { status: 200 },
};
let r = await systemHealth({ DB: db(true) }, { fetchImpl, now });
const by = (id) => r.hosts.find((h) => h.id === id);
ok("three hosts, in order", r.hosts.map((h) => h.id).join() === "admin,api,app");
ok("all green", r.hosts.every((h) => h.light === "green"), JSON.stringify(r.hosts.map((h) => h.light)));
ok("the API asks its PUBLIC ping, not the binding", asked.some((a) => /^https:\/\/api\.subsub\.work\/api\/ping\?_health=/.test(a.url)));
ok("redirects are not followed", asked.every((a) => a.init.redirect === "manual"));
ok("each probe can be cut off", asked.every((a) => a.init.signal));
ok("the database is reported on the API box", by("api").db?.ok === true);

asked.length = 0;
answers = {
  "admin.subsub.work": { status: 403, body: "error code: 1042" },
  "api.subsub.work": new Error("connect ECONNREFUSED"),
  "app.subsub.work": { status: 502 },
};
r = await systemHealth({ DB: db(true) }, { fetchImpl, now });
ok("Cloudflare refusing the check is unknown", by("admin").light === "unknown");
ok("the API not answering is red", by("api").light === "red");
ok("a 502 from the app is red", by("app").light === "red");

answers = {
  "admin.subsub.work": { status: 200 }, "api.subsub.work": { status: 200 }, "app.subsub.work": { status: 200 },
};
r = await systemHealth({ DB: db(false) }, { fetchImpl, now });
ok("a ping over a dead database is red", by("api").light === "red" && /database/.test(by("api").say));

// A test domain moves every probe with it.
asked.length = 0;
await systemHealth({ DB: db(true), APP_DOMAIN: "example.test" }, {
  fetchImpl: async (url, init) => { asked.push({ url, init }); return new Response("", { status: 200 }); }, now,
});
ok("APP_DOMAIN moves the hosts", asked.every((a) => /\.example\.test\//.test(a.url)), asked.map((a) => a.url).join(" "));

console.log("wiring");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const route = worker.slice(worker.indexOf('app.get("/api/platform/system-health"'), worker.indexOf('app.get("/api/ping"'));
ok("the route is staff-only", /requireStaff\(c\)/.test(route));
ok("and superadmin, like the settings check beside it", /requireSuperadmin\(c, staff\)/.test(route));
ok("the ping is on the public list", /c\.req\.path === "\/api\/ping"/.test(worker));
const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
ok("the API fetches same-zone hosts over the public internet",
  /compatibility_flags\s*=\s*\[[^\]]*"global_fetch_strictly_public"/.test(toml));


console.log("integrationLight");
const IL = (st, p) => integrationLight(st, p);
ok("no settings is grey, not red", IL("off", undefined).light === "off" && IL("off", undefined).word === "Not set up");
ok("half the settings is red whatever a probe says", IL("partial", { ms: 10 }).light === "red");
ok("still being asked is unknown", IL("ok", null).light === "unknown");
ok("configured with nothing to test says Configured, not Working",
  IL("ok", undefined).light === "green" && IL("ok", undefined).word === "Configured");
ok("a quick read is Working", IL("ok", { ms: 90 }).word === "Working" && IL("ok", { ms: 90 }).light === "green");
ok("refused credentials are red", IL("ok", { refused: true, say: "no" }).light === "red");
ok("no answer is red", IL("ok", { error: "x" }).light === "red");
ok("a warning is amber", IL("ok", { warn: true, ms: 5, say: "test mode" }).light === "amber");
ok("slow is amber", IL("ok", { ms: SLOW_MS + 5 }).light === "amber");

console.log("integrationHealth");
const ENV = {
  SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon",
  RESEND_API_KEY: "re_x", STRIPE_SECRET_KEY: "sk_x",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550000000",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
};
let replies;
const calls = [];
const stub = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {} });
  const u = new URL(url);
  const key = u.hostname + u.pathname;
  const hit = Object.entries(replies).find(([k]) => key.startsWith(k));
  if (!hit) throw new Error("unexpected " + key);
  const [status, body] = typeof hit[1] === "function" ? hit[1](init) : hit[1];
  if (status === "throw") throw new Error(body);
  return new Response(JSON.stringify(body), { status });
};
const groups = (ids, state = "ok") => ids.map((id) => ({ id, state }));
replies = {
  "sb.test/auth/v1/health": [200, { name: "GoTrue" }],
  "api.resend.com/domains": [401, { name: "restricted_api_key", message: "This API key is restricted to only send emails" }],
  "api.stripe.com/v1/balance": [200, { object: "balance", livemode: true }],
  "api.twilio.com/2010-04-01/Accounts/AC1.json": [200, { sid: "AC1", status: "active" }],
  "team.cloudflareaccess.com/cdn-cgi/access/certs": [200, { keys: [{ kid: "a" }] }],
};
let ih = await integrationHealth(ENV, groups(["auth", "mail", "billing", "sms", "staff", "licenses", "cron"]), { fetchImpl: stub, now: () => Date.now() });
const L = (id) => integrationLight("ok", ih.probes[id]);
ok("Supabase answering is Working", L("auth").word === "Working", JSON.stringify(ih.probes.auth));
ok("the anon key travels as apikey", calls.some((c) => /auth\/v1\/health/.test(c.url) && c.headers.apikey === "anon"));
ok("a sending-only Resend key is a recognised key, not a refusal", L("mail").light === "green", JSON.stringify(ih.probes.mail));
ok("Stripe live key is Working", L("billing").word === "Working");
ok("Twilio active is Working", L("sms").word === "Working");
ok("Access publishing keys is Working", L("staff").word === "Working");
ok("no probe for the licence verifiers -- they bill per lookup", ih.probes.licenses === undefined);
ok("and none for the cron secret", ih.probes.cron === undefined);
ok("every call READS", calls.every((c) => c.method === "GET"), JSON.stringify(calls.map((c) => c.method)));
ok("no Stripe call creates anything", !calls.some((c) => /stripe/.test(c.url) && !/\/v1\/balance/.test(c.url)));

calls.length = 0;
replies = {
  "sb.test/auth/v1/health": [401, { message: "Invalid API key" }],
  "api.resend.com/domains": [401, { name: "validation_error", message: "API key is invalid" }],
  "api.stripe.com/v1/balance": [200, { object: "balance", livemode: false }],
  "api.twilio.com/2010-04-01/Accounts/AC1.json": [200, { sid: "AC1", status: "suspended" }],
  "team.cloudflareaccess.com/cdn-cgi/access/certs": [200, { keys: [] }],
};
ih = await integrationHealth(ENV, groups(["auth", "mail", "billing", "sms", "staff"]), { fetchImpl: stub, now: () => Date.now() });
ok("a refused Supabase key is red", L("auth").light === "red" && /SUPABASE_ANON_KEY/.test(L("auth").say), L("auth").say);
ok("an invalid Resend key is red", L("mail").light === "red");
ok("a TEST-mode Stripe key in production is amber", L("billing").light === "amber" && /TEST/.test(L("billing").say));
ok("a suspended Twilio account is red", L("sms").light === "red" && /suspended/.test(L("sms").say));
ok("Access with no keys is red", L("staff").light === "red");

replies = { "sb.test/auth/v1/health": ["throw", "getaddrinfo ENOTFOUND"] };
ih = await integrationHealth(ENV, groups(["auth"]), { fetchImpl: stub, now: () => Date.now() });
ok("a provider that cannot be reached is red", L("auth").light === "red" && L("auth").word === "Not answering");

calls.length = 0;
ih = await integrationHealth(ENV, [{ id: "auth", state: "partial" }, { id: "mail", state: "off" }], { fetchImpl: stub, now: () => Date.now() });
ok("half or no settings: nobody is asked", calls.length === 0 && Object.keys(ih.probes).length === 0);

const routeIH = worker.slice(worker.indexOf('app.get("/api/platform/integration-health"'));
ok("the integration route is staff and superadmin",
  /requireStaff\(c\)/.test(routeIH.slice(0, 400)) && /requireSuperadmin\(c, staff\)/.test(routeIH.slice(0, 400)));
console.log(failed ? `\n${failed} failed` : "\nall passed");

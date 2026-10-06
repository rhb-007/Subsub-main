// The console's three system lights: what each answer turns into, and that
// the probes ask the right addresses the right way.
//
//   node scripts/syshealth-test.mjs
import { lightFor, looksBlocked, HEALTH_HOSTS, SLOW_MS } from "../shared/syshealth.js";
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

console.log(failed ? `\n${failed} failed` : "\nall passed");

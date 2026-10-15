// GMV in the staff console is in dollars, not a hundred times them.
//
// Reported with Sound Property Management's account window open and
// "$420,000 GMV to date" circled: "How is this GMV number getting
// calculated". The console bootstrap sends each work order's value as
// work_orders.value_cents, and the console ran it through moneyRaw and
// multiplied by 100, which is what a DOLLAR string needs. So $4,200 of
// accepted work drew as $420,000, on the account window, the dashboard's
// "GMV to date" line, the Revenue screen and every period tile.
//
// No test had ever drawn the figure, which is the whole of why it lived.
// What this pins, against a fixture the two readings disagree on:
//   accepted work orders count, at their value in cents;
//   a pending offer and a declined one do not;
//   the account window, the dashboard line and the MTD tile read one figure.
//
//   node scripts/console-gmv-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-gmv-test");
const WEB = 5505, API = 9107;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

const TODAY = new Date().toISOString().slice(0, 10);
const STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };
const acct = (id, name, kind) => ({ id, name, subdomain: id, kind, plan: "scale", billing: "annual",
  comped: false, compNote: null, trades: [], hostnameStatus: "active", subscriptionStatus: "active",
  createdAt: "2026-09-23", status: "active", lastActive: TODAY });
// Values are CENTS, exactly as the bootstrap sends them. Accepted: $3,000 +
// $1,200 = $4,200. The pending $9,000 offer and the declined $500 are not
// work anybody agreed to, so they are not GMV.
const wo = (status, cents) => ({ subId: "cmp_1", status, respondBy: null, value: cents });
const BOOT = {
  accounts: [acct("acc_pm", "Sound Property Management", "property_manager")],
  users: [{ id: "u_a", createdAt: "2026-09-23", name: "Sam Sound", email: "sam@sound.test", phone: null }],
  memberships: [{ userId: "u_a", accountId: "acc_pm", role: "admin" }],
  companies: [], engagements: [],
  jobs: [
    { id: "j1", accountId: "acc_pm", title: "Roof", status: "active", date: TODAY, createdAt: TODAY + "T09:00:00Z",
      assignments: { roofing: wo("accepted", 300000), gutters: wo("pending", 900000) } },
    { id: "j2", accountId: "acc_pm", title: "Sink", status: "active", date: TODAY, createdAt: TODAY + "T10:00:00Z",
      assignments: { plumbing: wo("accepted", 120000), painting: wo("declined", 50000) } },
  ],
  subEvents: [], activity: [], smsDaily: [],
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path === "/api/platform/stuck-subs") return [200, { rows: [] }];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path.startsWith("/api/platform/accounts/") && path.endsWith("/fee-terms"))
    return [200, { terms: { bps: 50, capCents: 50000, freeCents: 5_000_000 },
      defaults: { bps: 50, capCents: 50000, freeCents: 5_000_000 }, custom: false, note: null, processedCents: 0 }];
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 1400 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));
const nav = (label) => page.evaluate((l) => [...document.querySelectorAll(".pf-nav button")]
  .find((b) => b.innerText.trim() === l)?.click(), label);
const kpi = (root, label) => page.evaluate((root, label) => {
  const scope = root ? document.querySelector(root) : document;
  const k = [...(scope?.querySelectorAll(".kpi") || [])]
    .find((x) => x.querySelector(".kpi-l")?.innerText.trim() === label);
  return k ? k.querySelector(".kpi-v")?.innerText.trim() : null;
}, root, label);

try {
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  const gotIn = await page.evaluate(() => !!document.querySelector(".pf-main"));
  t.ck("the console loaded", gotIn);
  if (!gotIn) throw new Error("console never opened");

  console.log("\n-- the dashboard --");
  const line = await page.evaluate(() => (document.body.innerText.match(/\$[\d,]+ GMV to date/) || [""])[0]);
  t.ck("the dashboard's GMV line is the accepted work in dollars ($4,200)", line === "$4,200 GMV to date", line);
  t.ck("the MTD GMV tile agrees", (await kpi(null, "GMV")) === "$4,200", await kpi(null, "GMV"));

  console.log("\n-- the account window --");
  await nav("Accounts"); await wait(600);
  await page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row")]
    .find((r) => /Sound Property/.test(r.innerText))?.click());
  await wait(900);
  const v = await kpi(".modal.modal-acct", "GMV to date");
  t.ck("the account window's GMV to date is $4,200, not $420,000", v === "$4,200", v);
  t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();

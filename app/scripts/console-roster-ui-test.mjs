// The subcontractor panel, on the admin console, in a real browser.
//
// "Why isn't my users' subcontractors in the admin console? I need to see
// everything from the admin." They were not there: the account screen showed
// a KPI reading "Subcontractors 4" and no list, and the Team panel filters
// contractors out on purpose. So this opens the console, opens an account,
// and checks that its roster is on the screen with the things support
// actually needs -- who to call, what state the engagement is in, and a way
// into the contractor's own portal.
//
// It is also the console's first self-contained browser test. The one that
// existed needed a hand-started local stack and the platform bundle built by
// hand first, so it did not get run -- which is how a KPI that could only
// ever read zero survived on this screen.
//
//   node scripts/console-roster-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-test");
const WEB = 5213, API = 8925;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

const STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };

const BOOT = {
  accounts: [
    { id: "acc1", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
      plan: "scale", billing: "monthly", comped: false, compNote: null, trades: [],
      hostnameStatus: "active", subscriptionStatus: "active", createdAt: "2026-01-04", status: "active" },
    { id: "acc2", name: "Sound PM", subdomain: "sound", kind: "property_manager",
      plan: "basic", billing: "monthly", comped: false, compNote: null, trades: [],
      hostnameStatus: "active", subscriptionStatus: "active", createdAt: "2026-02-01", status: "active" },
  ],
  users: [
    { id: "u_admin", name: "Account Admin", email: "admin@cascade.test", phone: null },
    { id: "u_sj", name: "Richard Braun", email: "rb@sanjuan.test", phone: null },
    // Deliberately NOT the name on the company row: the company's contact is
    // "Jo Skagit", which Cascade typed in and is theirs to see. The person
    // holding the seat on Sound PM is somebody else, and that name is Sound
    // PM's, not Cascade's.
    { id: "u_jo", name: "Josephine Reyes", email: "jo@skagit.test", phone: null },
  ],
  memberships: [
    { userId: "u_admin", accountId: "acc1", role: "admin", companyId: null },
    { userId: "u_sj", accountId: "acc1", role: "contractor", companyId: "cmp_sj" },
    // Jo's seat is on Sound PM, not Cascade. Cascade typed Skagit in
    // themselves and nobody there has ever signed in.
    { userId: "u_jo", accountId: "acc2", role: "contractor", companyId: "cmp_far" },
  ],
  companies: [
    { id: "cmp_sj", company: "San Juan Exteriors", contact: "Richard Braun",
      phone: "2065550100", email: "rb@sanjuan.test", license: "SJ123", ubi: null,
      city: "Seattle", state: "WA", zip: "98101", warranty: null },
    { id: "cmp_ace", company: "Ace Gutters", contact: "Danny Ace",
      phone: "2065550200", email: "danny@ace.test", license: null, ubi: null,
      city: "Tacoma", state: "WA", zip: "98402", warranty: null },
    { id: "cmp_far", company: "Skagit Framing", contact: "Jo Skagit",
      phone: "2065550300", email: "jo@skagit.test", license: null, ubi: null,
      city: "Burlington", state: "WA", zip: "98233", warranty: null },
  ],
  engagements: [
    { id: "en_sj", accountId: "acc1", companyId: "cmp_sj", status: "active",
      categories: ["roofing"], rating: 4.6, ratedJobs: 5,
      docReview: { insurance: { status: "pending" }, bond: { status: "verified" } } },
    { id: "en_ace", accountId: "acc1", companyId: "cmp_ace", status: "paused",
      categories: ["gutters"], rating: 0, ratedJobs: 0,
      docReview: { contract: { status: "rejected" } } },
    { id: "en_far", accountId: "acc1", companyId: "cmp_far", status: "active",
      categories: [], rating: 0, ratedJobs: 0, docReview: {} },
    { id: "en_far2", accountId: "acc2", companyId: "cmp_far", status: "active",
      categories: [], rating: 0, ratedJobs: 0, docReview: {} },
  ],
  jobs: [], subEvents: [], activity: [], smsDaily: [],
};

const impersonated = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path.startsWith("/api/platform/impersonate/") && method === "POST") {
    impersonated.push({ path, body });
    return [200, { token: "imp-stub", accountId: "acc1", actAsUserId: body?.userId || "u_admin" }];
  }
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1400, height: 1600 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

try {
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);

  console.log("\n-- the console lets staff in and lists the account --");
  const gotIn = await page.evaluate(() =>
    !/checking your access/i.test(document.body.innerText)
    && !!document.querySelector(".pf-company-card, .pf-account-card, .pf-shell, .pf-main"));
  t.ck("the console loaded past its sign-in", gotIn,
    await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\s+/g, " ")));

  // Accounts screen, then open Cascade.
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("button, a")]
      .find((b) => /^\s*accounts\s*$/i.test(b.innerText || ""));
    if (nav) nav.click();
  });
  await wait(700);
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".pfc-top")]
      .find((c) => /Cascade Management/.test(c.innerText));
    if (!card) return false;
    card.click();
    return true;
  });
  t.ck("an account opens", opened, String(opened));
  await wait(900);

  console.log("\n-- and the account screen now has its roster on it --");
  const panel = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".pf-fold-btn, h3")];
    const h = heads.find((x) => /^\s*subcontractors\s*$/i.test(
      (x.innerText || "").split("\n")[0].trim()));
    if (!h) return null;
    const rows = [...document.querySelectorAll(".pf-roster-row")].map((r) => ({
      text: r.innerText.replace(/\s+/g, " ").trim(),
      buttons: [...r.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    }));
    return { found: true, rows };
  });
  t.ck("there is a Subcontractors panel", !!panel, panel ? `${panel.rows.length} rows` : "no panel with that heading");
  if (!panel) { t.ck("...so nothing below could be checked", false); await ctx.close(); await browser.close(); web.close(); api.close(); t.done(); }

  t.ck("it is open without being clicked", panel.rows.length === 3,
    `${panel.rows.length} rows`);
  const all = panel.rows.map((r) => r.text).join(" || ");
  console.log("    [panel] " + all);
  t.ck("both of this account's contractors are listed",
    /San Juan Exteriors/.test(all) && /Ace Gutters/.test(all));
  t.ck("each names who to call", /Richard Braun/.test(all) && /Danny Ace/.test(all));
  t.ck("and where they are", /Seattle/.test(all) && /Tacoma/.test(all));
  t.ck("the trades are shown", /Roofing/i.test(all) && /Gutters/i.test(all));
  t.ck("a paused engagement says so", /paused/i.test(all));
  t.ck("the rating rides along", /4\.6/.test(all));

  console.log("\n-- the document state that used to be invisible --");
  t.ck("a pending document is reported", /1 doc pending/i.test(all));
  t.ck("so is a rejected one", /1 rejected/i.test(all));

  console.log("\n-- and support can stand in the contractor's own portal --");
  {
    const sj = panel.rows.find((r) => /San Juan/.test(r.text));
    const ace = panel.rows.find((r) => /Ace Gutters/.test(r.text));
    t.ck("the one with a seat offers Open as them",
      sj.buttons.some((b) => /open as them/i.test(b)), JSON.stringify(sj.buttons));
    t.ck("and names the person whose seat it is", /Richard Braun/.test(sj.text), sj.text);
    // Ace was typed in by the account and never claimed. Offering a button
    // there would open nothing.
    t.ck("the one nobody claimed says so instead",
      /no login/i.test(ace.text) && !ace.buttons.some((b) => /open as them/i.test(b)),
      `${ace.text} :: ${JSON.stringify(ace.buttons)}`);

    // Skagit has a SubSub login, but their seat is on Sound PM. Offering it
    // here would put a button on Cascade's screen that opens another
    // customer's seat -- so this row must read as unclaimed, same as Ace.
    const far = panel.rows.find((r) => /Skagit Framing/.test(r.text));
    t.ck("a seat held on another customer's account is not offered here",
      /no login/i.test(far.text) && !far.buttons.some((b) => /open as them/i.test(b)),
      `${far.text} :: ${JSON.stringify(far.buttons)}`);
    t.ck("and the person holding that seat is not named on this screen",
      !/Josephine Reyes/.test(far.text), far.text);

    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".pf-roster-row")]
        .find((r) => /San Juan/.test(r.innerText));
      [...row.querySelectorAll("button")].find((b) => /open as them/i.test(b.innerText))?.click();
    });
    await wait(1200);
    t.ck("pressing it asks for that person's seat, not an admin's",
      impersonated.length === 1 && impersonated[0].body?.userId === "u_sj",
      JSON.stringify(impersonated));
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();

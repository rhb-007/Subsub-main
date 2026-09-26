// Landing in the account you switched to, with that account's data.
//
// Outerhome accepted Cascade Management's request to connect, which seats
// Outerhome's team in CASCADE as contractors. Switching to Cascade from the
// drawer then showed:
//
//   "This contractor login isn't linked to a contractor record yet."
//
// Nothing was wrong on the server. The drawer's switch set currentAccountId and
// stopped -- no re-fetch -- so the app rendered Cascade with OUTERHOME's roster
// still in state. mySub looks for the seat's own company in `subs`, and
// Outerhome's roster does not contain Outerhome, so it found nothing and drew
// the empty state. The header and the branding had already followed the switch,
// which is what made it look like a broken account rather than stale data.
//
// What this covers:
//
//   THE SWITCH REFETCHES. Landing in an account renders THAT account's roster,
//   jobs and people -- not the previous account's.
//
//   THE CONTRACTOR PORTAL FINDS ITS RECORD, which is the screen in the report.
//
//   IT LANDS ON A SCREEN THE NEW SEAT HAS. An admin seat switching to a
//   contractor seat kept the old tab, which that role may not be allowed.
//
//   node scripts/switch-land-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-switchland-test");
const WEB = 5237, API = 8949;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const USER = { id: "u_sam", name: "Sam Ridge", email: "sam@outerhome.test" };

// Outerhome: a general contractor. Sam is its admin. Since 031 it is a company
// of its own, cmp_outerhome.
const HOME = {
  id: "acc_home", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active", user: { ...USER, role: "admin" },
};
// Cascade Management: a property manager that asked Outerhome to connect, and
// Outerhome said yes. Sam holds a CONTRACTOR seat here, for cmp_outerhome.
const AWAY = {
  id: "acc_cascade", name: "Cascade Management", subdomain: "cascadeexteriors",
  kind: "property_manager", plan: "basic", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { ...USER, role: "contractor" },
};

const sub = (id, company, accountId, engagementId) => ({
  id, company, engagementId, accountId, contact: "Sam Ridge",
  email: "sam@outerhome.test", phone: null, categories: ["roofing"], caps: [],
  crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "OUTER001QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, autoSchedule: false,
});

// Outerhome's OWN roster: the subcontractors it hires. It does not contain
// Outerhome -- which is the whole reason the stale copy drew an empty state.
const HOME_SUBS = [
  sub("cmp_ridge", "Ridge Roofing", "acc_home", "en_ridge"),
  sub("cmp_emerald", "Emerald Exteriors", "acc_home", "en_em"),
];
// Cascade's roster, which DOES contain Outerhome.
const AWAY_SUBS = [sub("cmp_outerhome", "Outerhome", "acc_cascade", "en_out")];

const acctOf = (headers) => String(headers["x-account-id"] || "");
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  const at = acctOf(headers);
  const away = at === "acc_cascade";
  if (path === "/api/auth/me") return [200, { user: USER, memberships: [
    { accountId: "acc_home", accountName: "Outerhome", subdomain: "outerhome",
      kind: "general_contractor", role: "admin", companyId: null, plan: "scale",
      billing: "monthly", theme: null, trades: [], logoKey: null, useDefaultMark: true },
    { accountId: "acc_cascade", accountName: "Cascade Management",
      subdomain: "cascadeexteriors", kind: "property_manager", role: "contractor",
      companyId: "cmp_outerhome", plan: "basic", billing: "monthly", theme: null,
      trades: [], logoKey: null, useDefaultMark: true },
  ] }];
  // The seat, per account. Sam is an admin at Outerhome and a contractor for
  // cmp_outerhome at Cascade -- the same person, two different seats.
  if (path === "/api/account-users") return [200, [
    { ...USER, phone: null, role: away ? "contractor" : "admin",
      subId: away ? "cmp_outerhome" : null, propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/account") return [200, away ? AWAY : HOME];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, HOME];
  if (path === "/api/subs") return [200, away ? AWAY_SUBS : HOME_SUBS];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/doc-shares" || path === "/api/clients"
    || path === "/api/property-transfers") return [200, []];
  return undefined;
} });

const browser = await launch();
const text = (page) => page.evaluate(() =>
  document.body.innerText.replace(/\s+/g, " ").trim());

try {
  console.log("\n-- switching into the account that hires you --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_sam", accountId: "acc_home" }, viewport: { width: 1200, height: 1400 } });
    await wait(3000);

    const home = await text(page);
    t.ck("we start in Outerhome, running it", /Outerhome/.test(home), home.slice(0, 90));
    t.ck("with our own roster loaded",
      await page.evaluate(() => document.body.innerText.includes("Ridge Roofing")
        || document.body.innerText.includes("Emerald Exteriors")));

    const rows = await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("Cascade is offered in the switcher",
      rows.some((r) => /Cascade Management/.test(r)), JSON.stringify(rows));
    t.ck("named as what we are over there",
      rows.some((r) => /Cascade Management/.test(r) && /subcontractor/.test(r)),
      JSON.stringify(rows));

    await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")]
      .find((b) => /Cascade Management/.test(b.innerText))?.click());
    await wait(2600);

    const after = await text(page);
    // THE BUG. The account's name and branding followed the switch while its
    // data did not, so this read as a broken account rather than stale state.
    t.ck("we are not told the login is unlinked",
      !/isn't linked to a contractor record/.test(after), after.slice(0, 180));
    t.ck("we have landed in Cascade", /Cascade Management/.test(after), after.slice(0, 90));
    t.ck("the portal knows which company we are",
      /Outerhome/.test(after), after.slice(0, 200));

    // Cascade's data, not Outerhome's.
    t.ck("the previous account's roster is gone",
      !/Ridge Roofing/.test(after) && !/Emerald Exteriors/.test(after),
      after.slice(0, 200));

    // An admin seat's first tab is the dashboard, which a contractor seat has
    // no right to. Keeping it lands them on a screen their role cannot see.
    const nav = await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("the nav is the contractor's, not the admin's",
      nav.some((n) => /^My Jobs/.test(n)), JSON.stringify(nav));
    t.ck("with no dashboard on it", !nav.some((n) => /^Dashboard/.test(n)),
      JSON.stringify(nav));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and switching back --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_sam", accountId: "acc_cascade" }, viewport: { width: 1200, height: 1400 } });
    await wait(3000);
    t.ck("starting in Cascade shows the contractor portal",
      !/isn't linked to a contractor record/.test(await text(page)),
      (await text(page)).slice(0, 140));

    await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")]
      .find((b) => /Outerhome/.test(b.innerText))?.click());
    await wait(2600);
    const back = await text(page);
    t.ck("our own roster is back", /Ridge Roofing|Emerald Exteriors/.test(back),
      back.slice(0, 200));
    t.ck("and we are running the account again",
      await page.evaluate(() => [...document.querySelectorAll("nav button")]
        .some((b) => /^Dashboard/.test(b.innerText))));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();

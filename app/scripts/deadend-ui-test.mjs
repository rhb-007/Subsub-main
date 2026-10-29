// A note that names another screen carries the press that gets there.
//
// Reported from Inspections on an account with no buildings: "Add a building
// first -- an inspection is of a unit in one." and nothing to press. Tenants
// said the same about tenants. Both now carry Add a building, which opens the
// same property form the Properties screen and the Add menu open.
//
//   THE PRESS LANDS ON THE FORM, not on a list with a button somewhere on it.
//   Asserted by the New property heading being on screen afterwards.
//
//   A SEAT THE ROUTE REFUSES IS NOT OFFERED IT. POST /api/properties is admin
//   or pm, so a pm gets the button too; a seat outside that is told who can.
//
//   node --no-warnings scripts/deadend-ui-test.mjs

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-deadend-test");
const WEB = 5597, API = 8811;
const t = tally();

const PM = {
  id: "acc_pm", name: "Rudd Properties", subdomain: "ruddprops",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@rudd.test", role: "admin" },
};
let SEAT = { userId: "u_mgr", accountId: "acc_pm", role: "admin" };
const USERS = [
  { id: "u_mgr", name: "Richard Braun", email: "rb@rudd.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_pm", name: "Pat Lee", email: "pat@rudd.test", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  // A manager narrowed to a building the account no longer has: the server
  // would take a new building from them, and they could not see it after.
  { id: "u_npm", name: "Nora Quinn", email: "nora@rudd.test", phone: null, role: "pm",
    subId: null, propertyIds: ["prop_gone"], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, { ...PM, user: { ...PM.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/inspections") return [200, []];
  if (["/api/jobs", "/api/visits", "/api/properties", "/api/tenants", "/api/subs", "/api/invites",
    "/api/connect-requests", "/api/my-connect-requests", "/api/clients", "/api/notices"].includes(path))
    return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const navLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => (b.innerText || "").trim().split("\n")[0]));
const go = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button")]
    .find((b) => (b.innerText || "").trim().split("\n")[0] === l)?.click(), label);
  for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".no-building")) break; }
};
const empty = (page) => page.evaluate(() => {
  const e = document.querySelector(".ss-main .no-building");
  if (!e) return null;
  return { text: e.innerText, btn: [...e.querySelectorAll("button")].map((b) => b.innerText.trim()) };
});
const pressAdd = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll(".no-building button")]
    .find((b) => /Add a building/.test(b.innerText))?.click());
  for (let n = 0; n < 20; n++) { await wait(200); if (await formUp(page)) break; }
};
const formUp = (page) => page.evaluate(() =>
  [...document.querySelectorAll("h4")].some((h) => /^new property$/i.test(h.innerText.trim())));

try {
  for (const role of ["admin", "pm"]) {
    SEAT = { userId: role === "admin" ? "u_mgr" : "u_pm", accountId: "acc_pm", role };
    console.log(`\n-- a ${role} on an account with no buildings --`);
    const { ctx, page, crashes } = await visitApp(browser, { host: "ruddprops", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 30; n++) { await wait(200); if ((await navLabels(page)).includes("Inspections")) break; }

    for (const [screen, word] of [["Properties", /propert/i], ["Inspections", /inspection/i], ["Tenants", /tenant/i]]) {
      await go(page, screen);
      const e = await empty(page);
      t.ck(`${role}: ${screen} says why there is nothing`, e && word.test(e.text), JSON.stringify(e));
      t.ck(`${role}: and offers Add a building`, e?.btn?.some((b) => /Add a building/.test(b)), JSON.stringify(e));
      t.ck(`${role}: the form is not already open`, !(await formUp(page)));
      await pressAdd(page);
      t.ck(`${role}: pressing it from ${screen} opens the New property form`, await formUp(page));
    }
    t.ck(`${role}: nothing crashed`, crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a pm narrowed to named buildings --");
  {
    SEAT = { userId: "u_npm", accountId: "acc_pm", role: "pm" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "ruddprops", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 30; n++) { await wait(200); if ((await navLabels(page)).includes("Inspections")) break; }
    for (const screen of ["Properties", "Inspections", "Tenants"]) {
      await go(page, screen);
      const e = await page.evaluate(() => {
        const x = document.querySelector(".ss-main .no-building");
        return x && { text: x.innerText, btn: [...x.querySelectorAll("button")].map((b) => b.innerText.trim()),
          ask: [...x.querySelectorAll("a[href^='mailto:']")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href") })) };
      });
      t.ck(`narrowed: ${screen} has an empty state`, !!e, String(e));
      t.ck(`narrowed: ${screen} offers no Add a building it cannot use`, e && !e.btn.some((b) => /Add a building/.test(b)), JSON.stringify(e));
      t.ck(`narrowed: ${screen} names the admin with an email link`,
        e?.ask?.length === 1 && e.ask[0].text === "Richard Braun" && /^mailto:rb@rudd\.test\?subject=/.test(e.ask[0].href),
        JSON.stringify(e?.ask));
    }
    t.ck("narrowed: nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the other notes point somewhere too (static) --");
  const src = readFileSync(join(app, "src/App.tsx"), "utf8");
  const fn = (name) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf("\nfunction ", i + 10)); };
  t.ck("the map's HQ note opens Company", /goAccount\("company"\)/.test(fn("MapHqNote")));
  t.ck("a Scale-only hint opens Subscription", /goAccount\("billing"\)/.test(fn("ScaleHint")));
  t.ck("no hint still sends people to a Billing tab that does not exist", !/on the Billing tab/.test(src));
  t.ck("the lien waiver plan note goes through it", /<ScaleHint className="wv-plan">/.test(src));
  t.ck("the billing unit notes open Properties",
    (fn("UnitPrice").match(/nav\.goProperties/g) || []).length >= 2);
  t.ck("the Passport's gaps open where they are filled in", /nav\.goAccount\(g\.where\)/.test(fn("PassportPanel")));
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();

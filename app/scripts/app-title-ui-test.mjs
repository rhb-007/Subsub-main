// The browser tab inside the signed-in app.
//
// Branding -> Page titles named the sign-in page and the application form
// and nothing else, so every page once somebody was signed in read the same
// thing. Asked for as a page title editor on every signed-in page.
//
// What is asserted: with nothing set, each page names itself and the company
// ("Jobs · Outerhome Roofing · SubSub"); the Signed-in pages field changes
// the company half and the page half stays; SubSub is on the end once
// whatever is typed; and the field's own preview says what the tab will read.
//
//   node --no-warnings scripts/app-title-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-apptitle-test");
const WEB = 5589, API = 9289;
const t = tally();

let theme = null;
const acct = () => ({
  id: "acc_gc", name: "Outerhome Roofing", subdomain: "outerhome",
  kind: "general_contractor", plan: "scale", billing: "monthly", useDefaultMark: true, theme,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
});
const saves = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "PATCH" && path === "/api/account") {
    const b = typeof body === "string" ? JSON.parse(body || "{}") : (body || {});
    saves.push(b);
    if (b.theme) theme = b.theme;
    return [200, acct()];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const nav = (page, re) => page.evaluate((src) => {
  const r = new RegExp(src);
  [...document.querySelectorAll("nav.tabs button")].find((b) => r.test(b.innerText.trim()))?.click();
}, re.source);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_r", accountId: "acc_gc" }, viewport: { width: 1180, height: 820 } });
  await wait(2200);

  console.log("\n-- with nothing set --");
  t.ck("the dashboard tab names the page and the company", (await page.title()) === "Dashboard · Outerhome Roofing · SubSub", await page.title());
  await nav(page, /^Jobs/); await wait(500);
  t.ck("Jobs names itself", (await page.title()) === "Jobs · Outerhome Roofing · SubSub", await page.title());
  await nav(page, /^Subcontractors/); await wait(500);
  t.ck("the roster names itself in the account's own word", (await page.title()) === "Subcontractors · Outerhome Roofing · SubSub", await page.title());

  console.log("\n-- the field on Branding --");
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(700);
  t.ck("My account names itself", (await page.title()) === "My account · Outerhome Roofing · SubSub", await page.title());
  await page.evaluate(() => [...document.querySelectorAll(".acct-tabs button")].find((b) => b.innerText.trim() === "Branding")?.click());
  await wait(700);
  const fld = await page.evaluate(() => {
    const l = document.querySelector("[data-app-title]");
    return l && { ph: l.querySelector("input")?.placeholder, preview: l.querySelector("[data-app-title-preview]")?.innerText };
  });
  t.ck("Branding has a Signed-in pages title field", !!fld, JSON.stringify(fld));
  t.ck("it starts from the company name", fld?.ph === "Outerhome Roofing", JSON.stringify(fld));
  t.ck("its preview says what the tab will read", fld?.preview === "Jobs · Outerhome Roofing · SubSub", JSON.stringify(fld));

  await page.click("[data-app-title] input");
  await page.keyboard.type("Outerhome Ops · SubSub");
  await wait(200);
  const prev = await page.evaluate(() => document.querySelector("[data-app-title-preview]")?.innerText);
  t.ck("typing SubSub does not double it", prev === "Jobs · Outerhome Ops · SubSub", prev);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Save branding/.test(b.innerText.trim()))?.click());
  await wait(1200);
  const sent = saves.at(-1)?.theme?.appTitle;
  t.ck("Save sends the title", typeof sent === "string" && /Outerhome Ops/.test(sent), JSON.stringify(saves.at(-1)?.theme));

  console.log("\n-- and every page uses it --");
  await nav(page, /^Jobs/); await wait(600);
  t.ck("Jobs reads the new title", (await page.title()) === "Jobs · Outerhome Ops · SubSub", await page.title());
  await nav(page, /^Dashboard/); await wait(500);
  t.ck("so does the dashboard", (await page.title()) === "Dashboard · Outerhome Ops · SubSub", await page.title());

  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();

// Every boxed section on My account has space between it and the next one.
//
// Reported with Account -> Company on screen: "Your other business" sat
// directly on "Your subcontractor agreement", border on border, so the two
// panels read as one. Asked for as: all sections need separation between
// them, in user accounts and the console. This walks every My account tab
// (and both halves of the merged ones) for a hiring account with a second
// business and for a property manager, and measures every pair of sibling
// boxed sections with touchingSections. The console half is in
// test:consolelists, inside the account window.
//
//   node --no-warnings scripts/section-gap-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, touchingSections } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-sectiongap-test");
const WEB = 5967, API = 9967;
const t = tally();

const ACCTS = {
  acc_gc: { id: "acc_gc", name: "Outerhome Roofing", subdomain: "outerhome", kind: "general_contractor" },
  acc_pm: { id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager" },
};
let CUR = "acc_gc";
const acct = () => ({ ...ACCTS[CUR], plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" } });
const MY_COMPANY = {
  companyId: "cmp_gc", company: "Outerhome Roofing", contact: "Richard Braun",
  email: "rb@outerhome.test", phone: "2067778888", license: "OUTERHR881QT", ubi: "",
  city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_gc", openToHire: true, openAnswered: true, url: null, sharesSent: 0,
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return CUR === "acc_gc" ? [200, MY_COMPANY] : [404, { error: "not_found" }];
  if (path === "/api/account/second-business") return [200, {
    allowed: ["property_manager"], discountPercent: 50,
    linked: CUR === "acc_gc"
      ? { other: { id: "acc_pm", name: "Sound Property Management", kind: "property_manager", subdomain: "soundpm", mySeat: true }, discountOn: null }
      : { other: { id: "acc_gc", name: "Outerhome Roofing", kind: "general_contractor", subdomain: "outerhome", mySeat: true }, discountOn: null } }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", phone: null, role: "admin", subId: null,
      propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections" || path === "/api/tenants"
    || path === "/api/change-orders" || path === "/api/api-tokens") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const clickText = (page, sel, text) => page.evaluate((sel, text) => {
  const b = [...document.querySelectorAll(sel)].find((x) => x.innerText.trim() === text);
  b?.click(); return !!b;
}, sel, text);

try {
  for (const [id, host] of [["acc_gc", "outerhome"], ["acc_pm", "soundpm"]]) {
    CUR = id;
    for (const [w, h] of [[1180, 820], [390, 844]]) {
      const { ctx, page, crashes } = await visitApp(browser, { host, webPort: WEB,
        seat: { userId: "u_r", accountId: id }, viewport: { width: w, height: h } });
      await wait(2000);
      await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
      await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(800);
      const tabs = await page.evaluate(() => [...document.querySelectorAll(".ss-main .acct-tabs button")].map((b) => b.innerText.trim()));
      t.ck(`${ACCTS[id].kind} at ${w}px: My account opened`, tabs.length >= 4, JSON.stringify(tabs));
      let seenCompany = false;
      for (const tab of tabs) {
        await clickText(page, ".ss-main .acct-tabs button", tab); await wait(900);
        const halves = await page.evaluate(() => [...document.querySelectorAll(".acct-subtabs button")].map((b) => b.innerText.trim()));
        for (const half of halves.length ? halves : [null]) {
          if (half) { await clickText(page, ".acct-subtabs button", half); await wait(800); }
          const where = `${ACCTS[id].kind} ${w}px ${tab}${half ? " / " + half : ""}`;
          const touch = await touchingSections(page, ".ss-main");
          t.ck(`${where}: no two sections touch`, touch.length === 0, JSON.stringify(touch));
          if (tab === "Company" && id === "acc_gc") {
            seenCompany = await page.evaluate(() => !!document.querySelector(".sb-panel") && !!document.querySelector(".agr-terms"));
            const g = await page.evaluate(() => {
              const a = document.querySelector(".sb-panel")?.getBoundingClientRect(), b = document.querySelector(".agr-terms")?.getBoundingClientRect();
              return a && b ? Math.round(b.top - a.bottom) : null;
            });
            t.ck(`${w}px: the reported pair, Your other business over the agreement, has space between`, g !== null && g >= 12, String(g));
          }
        }
      }
      if (id === "acc_gc") t.ck(`${w}px: the Company tab drew both reported panels`, seenCompany);
      t.ck(`${ACCTS[id].kind} ${w}px: no page error`, crashes.length === 0, crashes.join(" | "));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();

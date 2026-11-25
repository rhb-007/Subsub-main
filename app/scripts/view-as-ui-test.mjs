// 112. "VIEW AS" A TEAMMATE HAS A WAY BACK, like the staff console's banner.
//
// What is pinned in a browser, against a stubbed API:
//
//   Pressing View as on a teammate's row draws a banner naming them and saying
//   the admin is still signed in as themselves, with Back to your admin view.
//   Pressing it takes them back to their own view, on the page they left, and
//   the banner goes.
//
//   node --no-warnings scripts/view-as-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-viewas-test");
const WEB = 5291, API = 8919;
const t = tally();

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_p", name: "Pat Lee", email: "pat@outerhome.co", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/subs" || path === "/api/jobs" || path === "/api/invites" || path === "/api/properties"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests" || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1200 } });
  await wait(2200);
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Users")?.click());
  await wait(800);
  t.ck("the users screen opened, so the rest of this can fail", !!(await page.$(".login-as-btn")));
  t.ck("there is no banner before anybody is viewed as", !(await page.$("[data-viewas]")));

  await page.evaluate(() => [...document.querySelectorAll(".user-row")].find((r) => /Pat Lee/.test(r.innerText))
    ?.querySelector(".login-as-btn")?.click());
  await wait(800);
  const banner = await page.evaluate(() => document.querySelector("[data-viewas]")?.innerText || "");
  t.ck("View as draws a banner naming who", /viewing as Pat Lee/.test(banner), banner);
  t.ck("and that you are still signed in as yourself", /still signed in as yourself/.test(banner), banner);
  t.ck("with a way back", /Back to your admin view/.test(banner), banner);

  await page.evaluate(() => [...document.querySelectorAll("[data-viewas] button")]
    .find((b) => /Back to your admin view/.test(b.innerText))?.click());
  await wait(800);
  t.ck("Back takes the banner away", !(await page.$("[data-viewas]")));
  t.ck("and lands back on My account, where they left", !!(await page.$(".login-as-btn")));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();

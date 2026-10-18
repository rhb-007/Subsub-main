// Connect and Passport were two nav entries for one page. The Passport
// carries the QR code a GC scans and is where a GC connects from, so the
// Connect entry is gone and who has asked to work with you sits at the top
// of the Passport, with the amber count on the Passport entry.
//
//   node scripts/passport-connect-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-passportconnect-test");
const WEB = 5527, API = 9227;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", role: "contractor" },
};
const SUB = {
  id: "cmp_ridge", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_gc",
  contact: "Sam Ridge", email: "sam@ridge.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "RIDGERR891QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
let REQS = [];
const answered = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/account-users") return [200, [
    { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", phone: null, role: "contractor",
      subId: "cmp_ridge", propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/my-connect-requests") return [200, REQS];
  const rq = /^\/api\/my-connect-requests\/([^/]+)\/respond$/.exec(path);
  if (rq && method === "POST") {
    answered.push({ id: rq[1], accept: body.accept });
    REQS = REQS.map((r) => (r.id === rq[1] ? { ...r, status: body.accept ? "accepted" : "declined",
      respondedAt: "2026-10-18 10:00:00" } : r));
    return [200, { ok: true }];
  }
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/doc-shares") return [200, []];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/my-quotes") return [200, []];
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const v = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_sam", accountId: "acc_gc" }, viewport: { width: 820, height: 1100 } });
  await wait(2900);
  await v.page.evaluate(() => document.querySelector(".menu-btn, .hamburger, [aria-label='Menu']")?.click());
  await wait(500);
  return v;
};
const navItems = (page) => page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((b) => b.closest("nav, .drawer, .side, aside"))
  .map((b) => b.innerText.replace(/\s+/g, " ").trim()));

try {
  console.log("\n-- one entry, and the requests are on it --");
  {
    REQS = [
      { id: "cr1", account: "Cascade Management", status: "pending", via: "code", createdAt: "2026-10-17 09:00:00" },
      { id: "cr0", account: "Pine Builders", status: "declined", via: "lookup",
        createdAt: "2026-10-01 09:00:00", respondedAt: "2026-10-02 09:00:00" },
    ];
    const { ctx, page, crashes } = await open();
    const items = await navItems(page);
    t.ck("the nav has a Passport entry", items.some((i) => /^Passport/.test(i)), JSON.stringify(items));
    t.ck("and no Connect entry", !items.some((i) => /^Connect\b/.test(i)), JSON.stringify(items));
    t.ck("the Passport entry carries the waiting count",
      items.some((i) => /^Passport\s*1$/.test(i)), JSON.stringify(items));

    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.closest("nav, .drawer, .side, aside") && /^Passport/.test(b.innerText.trim()))?.click());
    await wait(900);
    const r = await page.evaluate(() => ({
      head: [...document.querySelectorAll(".dash-hello")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).find((x) => /^Passport/.test(x)) || "",
      asks: document.querySelector(".connect-asks")?.innerText.replace(/\s+/g, " ").trim() || null,
      past: !!document.querySelector(".connect-asks .cx-past"),
      pastOpen: !!document.querySelector(".connect-asks .cx-past")?.open,
    }));
    t.ck("the page is the Passport", /^Passport/.test(r.head), r.head);
    t.ck("and says somebody is waiting", /1 waiting on your answer/.test(r.head), r.head);
    t.ck("the request is on the Passport page", /Cascade Management/.test(r.asks || ""), String(r.asks));
    t.ck("past answers are folded away", r.past && !r.pastOpen, JSON.stringify(r));

    await page.evaluate(() => [...document.querySelectorAll(".connect-asks button")]
      .find((b) => /^Accept/.test(b.innerText.trim()))?.click());
    await wait(900);
    t.ck("Accept answers it from here", answered.length === 1 && answered[0].id === "cr1" && answered[0].accept === true,
      JSON.stringify(answered));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- nobody asking: no empty box --");
  {
    REQS = [];
    const { ctx, page } = await open();
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.closest("nav, .drawer, .side, aside") && /^Passport/.test(b.innerText.trim()))?.click());
    await wait(900);
    const r = await page.evaluate(() => ({
      head: [...document.querySelectorAll(".dash-hello")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).find((x) => /^Passport/.test(x)) || "",
      asks: !!document.querySelector(".connect-asks"),
    }));
    t.ck("the Passport opened", /^Passport/.test(r.head), r.head);
    t.ck("and draws no requests section", !r.asks, JSON.stringify(r));
    await ctx.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();

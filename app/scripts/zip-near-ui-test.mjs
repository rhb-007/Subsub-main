// THE MARKET FORM FILLS ITS ZIPS FROM A PLACE AND A DISTANCE.
//
// Asked for as "automate adding all zip codes to where you sell based on a
// proximity of a city when creating a market". Driven on My markets: the
// center is typed, a distance picked, and the ZIPs that come back are added
// INTO what is listed, nearest first, with what happened said in words.
//
//   node --no-warnings scripts/zip-near-ui-test.mjs
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-zipnear-test");
const WEB = 5747, API = 9447;
const t = tally();

const acct = () => ({
  id: "acc_gc", name: "Outerhome Roofing", subdomain: "outerhome",
  kind: "general_contractor", plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
});
const MY_COMPANY = { companyId: "cmp_gc", company: "Outerhome Roofing", city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] }, docs: {}, openToHire: true, openAnswered: true };
const asks = [];
let posted = null;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, _h, url) => {
  if (path.startsWith("/api/markets/zips-near")) {
    const q = new URL(`http://x${url}`).searchParams;
    asks.push({ center: q.get("center"), miles: q.get("miles") });
    if (q.get("center") === "Nowhere, WA") return [404, { error: "place_not_found" }];
    return [200, { center: { lat: 47.25, lng: -122.44, label: "Tacoma, WA", city: "Tacoma", state: "WA" }, miles: Number(q.get("miles")),
      zips: [{ zip: "98402", miles: 0 }, { zip: "98403", miles: 1.1 }, { zip: "98405", miles: 1.4 }, { zip: "98406", miles: 2.6 }] }];
  }
  if (path === "/api/markets" && method === "POST") { posted = typeof body === "string" ? JSON.parse(body) : body; return [201, { market: { id: "mk_n", ...posted } }]; }
  if (path === "/api/markets") return [200, { markets: [] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return [200, MY_COMPANY];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [{ id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", phone: null,
    role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits", "/api/my-connect-requests",
    "/api/connect-requests", "/api/property-transfers", "/api/my-quotes", "/api/doc-shares", "/api/inspections", "/api/change-orders"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, sel, v);
try {
  for (const [w, h] of [[1024, 1366], [390, 844]]) {
    console.log(`\n-- ${w}px --`);
    asks.length = 0;
    const { page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_r", accountId: "acc_gc" }, viewport: { width: w, height: h } });
    await wait(2000);
    await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
    await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(700);
    await page.evaluate(() => [...document.querySelectorAll(".acct-tabs button")].find((b) => b.innerText.trim() === "My markets")?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$("[data-add-market]")) break; }
    await page.evaluate(() => document.querySelector("[data-add-market]")?.click()); await wait(400);
    t.ck(`the form carries the ZIP fill at ${w}px`, !!(await page.$("[data-market-form] [data-zipfill]")));
    t.ck("it sits above the ZIP box", await page.evaluate(() => {
      const f = document.querySelector("[data-zipfill]")?.getBoundingClientRect(), z = document.querySelector("[data-market-zips]")?.getBoundingClientRect();
      return !!f && !!z && f.bottom <= z.top;
    }));
    const box = await page.evaluate(() => {
      const r = document.querySelector("[data-zipfill-center]").getBoundingClientRect();
      const g = document.querySelector("[data-zipfill-go]").getBoundingClientRect();
      const card = document.querySelector("[data-zipfill]").getBoundingClientRect();
      return { w: r.width, h: r.height, goRight: g.right, cardRight: card.right, page: document.documentElement.scrollWidth > innerWidth };
    });
    t.ck("the place box is a full-size field, and nothing runs off", box.h >= 44 && box.w >= 150 && box.goRight <= box.cardRight + 1 && !box.page, JSON.stringify(box));

    await setVal(page, "[data-market-zips]", "98499, 98402");
    await setVal(page, "[data-zipfill-center]", "Tacoma, WA");
    await setVal(page, "[data-zipfill-miles]", "10");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(700);
    t.ck("it asks with the place and the distance", asks.at(-1)?.center === "Tacoma, WA" && asks.at(-1)?.miles === "10", JSON.stringify(asks));
    const after = await page.evaluate(() => ({ zips: document.querySelector("[data-market-zips]").value,
      towns: document.querySelector("[data-market-cities]").value, name: document.querySelector("[data-market-name]").value,
      note: document.querySelector("[data-zipfill-note]")?.innerText || "" }));
    t.ck("the ZIPs are added into what was listed, nearest first, none twice", after.zips === "98499, 98402, 98403, 98405, 98406", after.zips);
    t.ck("what happened is said", /Added 3 ZIPs within 10 miles of Tacoma, WA/.test(after.note) && /1 was already listed/.test(after.note), after.note);
    t.ck("the town goes in the towns, and names an unnamed market", after.towns.trim() === "Tacoma, WA" && after.name === "Tacoma", JSON.stringify(after));

    await setVal(page, "[data-zipfill-center]", "Nowhere, WA");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(600);
    const miss = await page.evaluate(() => ({ note: document.querySelector("[data-zipfill-note]")?.innerText || "", zips: document.querySelector("[data-market-zips]").value }));
    t.ck("a town that cannot be found is named, and the list is untouched", /Couldn't find that town/.test(miss.note) && miss.zips === after.zips, JSON.stringify(miss));
    const before = asks.length;
    await setVal(page, "[data-zipfill-center]", "Tacoma");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(300);
    t.ck("a town with no state is answered on the form, not asked", asks.length === before
      && /Add the state/.test(await page.evaluate(() => document.querySelector("[data-zipfill-note]")?.innerText || "")));

    if (w === 1024) {
      await page.evaluate(() => [...document.querySelectorAll(".chip")].find((b) => b.dataset.marketSvc)?.click()); await wait(150);
      await page.evaluate(() => document.querySelector("[data-market-save]")?.click()); await wait(700);
      t.ck("the market is saved with the filled ZIPs", posted?.zips?.join() === "98499,98402,98403,98405,98406", JSON.stringify(posted));
    }
    t.ck("the screen did not crash", crashes.length === 0, JSON.stringify(crashes));
  }
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();

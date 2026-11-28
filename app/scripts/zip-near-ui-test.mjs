// THE MARKET FORM FILLS ITS ZIPS FROM A PLACE AND A DISTANCE.
//
// Asked for as "automate adding all zip codes to where you sell based on a
// proximity of a city when creating a market". Driven on My markets: the
// center is typed, a distance picked, and the ZIPs that come back are added
// INTO what is listed, nearest first, with what happened said in words.
//
// And the towns come with them (asked for as "when creating a new market it
// should automatically add all of the cities that correspond to the zip
// codes"): each ZIP carries the town it is in, typed ZIPs are looked up when
// the box is left, and by default a ZIP or town another market already has is
// left out and named.
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
const asks = [], townAsks = [], mirrorPuts = [];
const TOWN = { "98499": { city: "Lakewood", state: "WA" }, "98402": { city: "Tacoma", state: "WA" }, "98403": { city: "Tacoma", state: "WA" },
  "98405": { city: "Fife", state: "WA" }, "98406": { city: "Ruston", state: "WA" } };
// Another market already has 98405 and Fife: by default a new one leaves them out.
const SOUTH = { id: "mk_s", name: "South Sound", zips: ["98405"], cities: [{ city: "Fife", state: "WA" }], services: ["roofing"], active: true };
let posted = null, workSaved = null;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, _h, url) => {
  if (path.startsWith("/api/markets/zips-near")) {
    const q = new URL(`http://x${url}`).searchParams;
    asks.push({ center: q.get("center"), miles: q.get("miles") });
    if (q.get("center") === "Nowhere, WA") return [404, { error: "place_not_found" }];
    return [200, { center: { lat: 47.25, lng: -122.44, label: "Tacoma, WA", city: "Tacoma", state: "WA" }, miles: Number(q.get("miles")),
      zips: [{ zip: "98402", miles: 0, ...TOWN["98402"] }, { zip: "98403", miles: 1.1, ...TOWN["98403"] },
        { zip: "98405", miles: 1.4, ...TOWN["98405"] }, { zip: "98406", miles: 2.6, ...TOWN["98406"] }] }];
  }
  if (path.startsWith("/api/markets/zip-towns")) {
    const zs = new URL(`http://x${url}`).searchParams.get("zips").split(",");
    townAsks.push(zs);
    return [200, { towns: zs.map((zip) => ({ zip, ...(TOWN[zip] || {}) })) }];
  }
  if (path === "/api/markets/mirror" && method === "PUT") {
    mirrorPuts.push(typeof body === "string" ? JSON.parse(body) : body);
    return [200, { markets: [SOUTH, { id: "mir_acc_gc_tac001", name: "Tacoma area", zips: ["98402"], cities: [{ city: "Tacoma", state: "WA" }], services: ["roofing"], active: true }],
      mirror: { on: true, marketId: null } }];
  }
  if (path === "/api/markets" && method === "POST") { posted = typeof body === "string" ? JSON.parse(body) : body; return [201, { market: { id: "mk_n", ...posted } }]; }
  if (path === "/api/markets") return [200, { markets: [SOUTH], mirror: { on: false, marketId: null } }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company" && method === "PATCH") {
    workSaved = typeof body === "string" ? JSON.parse(body) : body;
    MY_COMPANY.coverage = workSaved.coverage;
    return [200, { ok: true }];
  }
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

    t.ck("leaving out what another market has is offered, ticked", await page.evaluate(() => document.querySelector("[data-market-skip] input")?.checked === true));
    await setVal(page, "[data-market-zips]", "98499, 98402");
    await page.focus("[data-market-zips]"); await page.evaluate(() => document.activeElement.blur()); await wait(500);
    const typed = await page.evaluate(() => ({ towns: document.querySelector("[data-market-cities]").value,
      note: document.querySelector("[data-typed-towns]")?.innerText || "" }));
    t.ck("typed ZIPs bring their towns when the box is left", typed.towns === "Lakewood, WA\nTacoma, WA" && /Lakewood, WA and Tacoma, WA/.test(typed.note), JSON.stringify(typed));
    await setVal(page, "[data-zipfill-center]", "Tacoma, WA");
    await setVal(page, "[data-zipfill-miles]", "10");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(700);
    t.ck("it asks with the place and the distance", asks.at(-1)?.center === "Tacoma, WA" && asks.at(-1)?.miles === "10", JSON.stringify(asks));
    const after = await page.evaluate(() => ({ zips: document.querySelector("[data-market-zips]").value,
      towns: document.querySelector("[data-market-cities]").value, name: document.querySelector("[data-market-name]").value,
      note: document.querySelector("[data-zipfill-note]")?.innerText || "" }));
    t.ck("the ZIPs are added into what was listed, nearest first, none twice, none another market has", after.zips === "98499, 98402, 98403, 98406", after.zips);
    t.ck("what happened is said, the left-out ZIP and town named", /Added 2 ZIPs within 10 miles of Tacoma, WA/.test(after.note) && /1 was already listed/.test(after.note)
      && /Left out 1 ZIP already in South Sound/.test(after.note) && /Added 1 town: Ruston, WA/.test(after.note), after.note);
    t.ck("the towns of the added ZIPs go in the towns, and the market is named", after.towns === "Lakewood, WA\nTacoma, WA\nRuston, WA" && after.name === "Tacoma", JSON.stringify(after));
    await page.evaluate(() => document.querySelector("[data-market-skip] input")?.click()); await wait(150);
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(700);
    const both = await page.evaluate(() => ({ zips: document.querySelector("[data-market-zips]").value, towns: document.querySelector("[data-market-cities]").value,
      warn: document.querySelector("[data-market-overlap]")?.innerText || "" }));
    t.ck("unticked, the overlap is taken, its town too, and said", both.zips === "98499, 98402, 98403, 98406, 98405" && /Fife, WA$/.test(both.towns)
      && /98405 is also in South Sound/.test(both.warn), JSON.stringify(both));

    await setVal(page, "[data-zipfill-center]", "Nowhere, WA");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(600);
    const miss = await page.evaluate(() => ({ note: document.querySelector("[data-zipfill-note]")?.innerText || "", zips: document.querySelector("[data-market-zips]").value }));
    t.ck("a town that cannot be found is named, and the list is untouched", /Couldn't find that town/.test(miss.note) && miss.zips === both.zips, JSON.stringify(miss));
    const before = asks.length;
    await setVal(page, "[data-zipfill-center]", "Tacoma");
    await page.evaluate(() => document.querySelector("[data-zipfill-go]")?.click()); await wait(300);
    t.ck("a town with no state is answered on the form, not asked", asks.length === before
      && /Add the state/.test(await page.evaluate(() => document.querySelector("[data-zipfill-note]")?.innerText || "")));

    if (w === 1024) {
      await page.evaluate(() => [...document.querySelectorAll(".chip")].find((b) => b.dataset.marketSvc)?.click()); await wait(150);
      await page.evaluate(() => document.querySelector("[data-market-save]")?.click()); await wait(700);
      // 116. Where you work is the same editor as Where you sell: named
      // areas, filled from a place, overlaps left out by default.
      const W = "[data-markets-work]";
      const leg = await page.evaluate((W) => document.querySelector(`${W} [data-work-legacy]`)?.innerText || "", W);
      t.ck("an older coverage says so, with the way to turn it into areas", /Seattle/.test(leg) && /Turn into areas/.test(leg), leg);
      await page.evaluate((W) => document.querySelector(`${W} [data-add-area]`)?.click(), W); await wait(200);
      await setVal(page, `${W} [data-area-name]`, "Tacoma area");
      await setVal(page, `${W} [data-zipfill-center]`, "Tacoma, WA");
      await page.evaluate((W) => document.querySelector(`${W} [data-zipfill-go]`)?.click(), W); await wait(700);
      const area = await page.evaluate((W) => ({ zips: document.querySelector(`${W} [data-area-zips]`)?.value, towns: document.querySelector(`${W} [data-area-cities]`)?.value,
        note: document.querySelector(`${W} [data-zipfill-note]`)?.innerText || "" }), W);
      t.ck("an area fills its ZIPs and their towns from a place, like a market", area.zips === "98402, 98403, 98405, 98406"
        && area.towns === "Tacoma, WA\nFife, WA\nRuston, WA" && /Added 4 ZIPs/.test(area.note), JSON.stringify(area));
      await page.evaluate((W) => document.querySelector(`${W} [data-area-save]`)?.click(), W); await wait(600);
      const a1 = workSaved?.coverage?.areas?.[0];
      t.ck("saving it saves the areas", workSaved?.coverage?.mode === "areas" && a1?.name === "Tacoma area" && a1.zips.join() === "98402,98403,98405,98406"
        && a1.cities.some((c) => c.city === "Ruston") && /^[a-z0-9]{6,24}$/.test(a1.id || ""), JSON.stringify(workSaved));
      const listed = await page.evaluate((W) => ({ rows: [...document.querySelectorAll(`${W} [data-area]`)].map((r) => r.innerText.replace(/\s+/g, " ")),
        legacy: !!document.querySelector(`${W} [data-work-legacy]`) }), W);
      t.ck("the area is listed like a market, and the older coverage note is gone", listed.rows.length === 1 && /Tacoma area/.test(listed.rows[0])
        && /4 ZIPs/.test(listed.rows[0]) && !listed.legacy, JSON.stringify(listed));
      await page.evaluate((W) => document.querySelector(`${W} [data-add-area]`)?.click(), W); await wait(200);
      await setVal(page, `${W} [data-area-name]`, "Again");
      await setVal(page, `${W} [data-zipfill-center]`, "Tacoma, WA");
      await page.evaluate((W) => document.querySelector(`${W} [data-zipfill-go]`)?.click(), W); await wait(700);
      const again = await page.evaluate((W) => ({ zips: document.querySelector(`${W} [data-area-zips]`)?.value,
        skip: !!document.querySelector(`${W} [data-area-skip]`), note: document.querySelector(`${W} [data-zipfill-note]`)?.innerText || "" }), W);
      t.ck("a second area leaves out what the first has, and says so", again.skip && again.zips === "" && /Left out 4 ZIPs already in Tacoma area/.test(again.note), JSON.stringify(again));
      await page.evaluate((W) => [...document.querySelectorAll(`${W} [data-area-form] button`)].find((b) => /Cancel/.test(b.innerText))?.click(), W); await wait(200);
      // The switch between the two cards.
      t.ck("\"We sell in the same places we work\" is offered, off", await page.evaluate(() => document.querySelector("[data-markets-same-box]")?.checked === false));
      await page.evaluate(() => document.querySelector("[data-markets-same-box]")?.click()); await wait(600);
      const same = await page.evaluate(() => ({ on: document.querySelector("[data-markets-same-box]")?.checked,
        chip: document.querySelector("[data-market=mir_acc_gc_tac001] [data-market-mirrored]")?.innerText || "" }));
      t.ck("on, it asks the server and the market says it follows Where you work", mirrorPuts.at(-1)?.on === true && same.on && /Follows Where you work/.test(same.chip), JSON.stringify({ same, mirrorPuts }));
      t.ck("the market is saved with the filled ZIPs", posted?.zips?.join() === "98499,98402,98403,98406,98405", JSON.stringify(posted));
    }
    t.ck("the screen did not crash", crashes.length === 0, JSON.stringify(crashes));
  }
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
